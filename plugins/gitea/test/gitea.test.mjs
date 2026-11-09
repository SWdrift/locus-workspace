import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createGiteaService } from '../lib/index.js'

function response(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  })
  res.end(JSON.stringify(body))
}

const sha = (character) => character.repeat(40)
const repository = {
  id: 7,
  full_name: 'acme/repo',
  default_branch: 'main',
  private: true,
  archived: false,
  has_actions: true,
  html_url: 'http://gitea.example/acme/repo',
}
const renamed = { ...repository, full_name: 'acme/renamed' }
const disabled = { ...repository, id: 8, full_name: 'acme/disabled', has_actions: false }

function run(id, overrides = {}) {
  return {
    id,
    run_number: id,
    display_title: `run ${id}`,
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    head_sha: sha('a'),
    head_branch: 'main',
    ...overrides,
  }
}

async function fixture(t) {
  const data = mkdtempSync(join(tmpdir(), 'locus-gitea-'))
  const requests = []
  let runsRequestCount = 0
  let disabledRunsRequestCount = 0
  const server = createServer((request, res) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    requests.push({ url: request.url, authorization: request.headers.authorization })
    if (url.pathname === '/redirect/api/v1/version' || url.pathname === '/redirect/api/v1/user') {
      res.writeHead(302, { location: `http://evil.invalid${url.pathname}` })
      res.end()
      return
    }
    if (url.pathname.endsWith('/api/v1/version')) {
      response(res, 200, { version: '1.25.5' })
      return
    }
    if (url.pathname.endsWith('/api/v1/user')) {
      if (request.headers.authorization !== 'token test-token') {
        response(res, 401, { message: 'unauthorized' })
        return
      }
      response(res, 200, { login: 'acme', is_admin: false })
      return
    }
    if (url.pathname === '/api/v1/repos/acme/repo') {
      response(res, 200, repository)
      return
    }
    if (url.pathname === '/api/v1/repositories/7') {
      response(res, 200, renamed)
      return
    }
    if (url.pathname === '/api/v1/repositories/8') {
      response(res, 200, disabled)
      return
    }
    if (url.pathname === '/api/v1/repositories/9') {
      response(res, 200, { ...repository, id: 9, full_name: 'acme/unsupported' })
      return
    }
    if (url.pathname === '/api/v1/repos/acme/disabled') {
      response(res, 200, disabled)
      return
    }
    if (url.pathname === '/api/v1/repos/acme/unsupported') {
      response(res, 200, { ...repository, id: 9, full_name: 'acme/unsupported' })
      return
    }
    if (url.pathname === '/api/v1/repos/acme/unsupported/actions/runs') {
      response(res, 404, { message: 'not found' })
      return
    }
    if (url.pathname === '/api/v1/repos/acme/denied') {
      response(res, 401, { message: 'unauthorized' })
      return
    }
    if (url.pathname === '/api/v1/repos/acme/forbidden') {
      response(res, 403, { message: 'forbidden' })
      return
    }
    if (url.pathname === '/api/v1/repos/acme/limited') {
      response(res, 429, { message: 'too many requests' })
      return
    }
    if (url.pathname === '/api/v1/repos/acme/missing') {
      response(res, 404, { message: 'not found' })
      return
    }
    if (url.pathname === '/api/v1/repos/acme/repo/actions/runs' ||
      url.pathname === '/api/v1/repos/acme/renamed/actions/runs') {
      runsRequestCount++
      const head = url.searchParams.get('head_sha')
      if (head === sha('f')) {
        response(res, 200, { total_count: 0, workflow_runs: [] })
        return
      }
      response(res, 200, {
        total_count: 3,
        workflow_runs: [
          run(101, { conclusion: 'success' }),
          run(102, { conclusion: 'failure' }),
          run(103, { status: 'in_progress', conclusion: null }),
        ],
      })
      return
    }
    if (url.pathname === '/api/v1/repos/acme/disabled/actions/runs') {
      disabledRunsRequestCount++
      response(res, 500, { message: 'should not be called' })
      return
    }
    if (url.pathname === '/api/v1/repos/acme/repo/actions/runs/101' ||
      url.pathname === '/api/v1/repos/acme/renamed/actions/runs/101') {
      response(res, 200, {
        ...run(101),
        path: 'ci.yaml@refs/heads/main',
        started_at: '2026-07-16T15:15:45+08:00',
        completed_at: '2026-07-16T15:16:19+08:00',
        html_url: 'http://gitea.example/acme/repo/actions/runs/1',
      })
      return
    }
    if (url.pathname === '/api/v1/repos/acme/repo/actions/runs/999' ||
      url.pathname === '/api/v1/repos/acme/renamed/actions/runs/999') {
      response(res, 404, { message: 'run not found' })
      return
    }
    response(res, 404, { message: 'not found' })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  const services = []
  const service = (options = {}) => {
    const instance = createGiteaService(
      { dataDirectory: data },
      { env: { GITEA_TOKEN: 'test-token' }, timeoutMs: 1000, ...options },
    )
    services.push(instance)
    return instance
  }
  t.after(async () => {
    await Promise.all(services.map((instance) => instance.dispose()))
    await new Promise((resolve) => server.close(resolve))
    rmSync(data, { recursive: true, force: true })
  })
  return {
    data,
    baseUrl,
    requests,
    service,
    get runsRequestCount() { return runsRequestCount },
    get disabledRunsRequestCount() { return disabledRunsRequestCount },
  }
}

test('实例配置持久化、地址与凭据引用校验', async (t) => {
  const f = await fixture(t)
  let service = f.service()
  const instance = service.addInstance({
    name: 'Local',
    baseUrl: `${f.baseUrl}/`,
    credentialRef: 'GITEA_TOKEN',
  })
  assert.match(instance.id, /^[0-9a-f-]{36}$/)
  assert.equal(instance.baseUrl, f.baseUrl)
  assert.equal(instance.credentialRef, 'GITEA_TOKEN')
  assert.equal(service.listInstances().length, 1)
  assert.equal(service.getInstance(instance.id).name, 'Local')

  assert.throws(
    () => service.addInstance({ name: 'Local', baseUrl: 'http://other.example' }),
    /同名/,
  )
  assert.throws(
    () => service.addInstance({ name: 'Duplicate URL', baseUrl: f.baseUrl }),
    /相同地址/,
  )
  assert.throws(
    () => service.addInstance({ name: 'Raw token', baseUrl: 'http://raw.example', credentialRef: 'secret-token' }),
    /POSIX/,
  )
  assert.throws(
    () => service.addInstance({ name: 'Credential URL', baseUrl: 'http://user:pass@host.example' }),
    /不能包含用户名或密码/,
  )
  assert.throws(
    () => service.addInstance({ name: 'Query URL', baseUrl: 'http://host.example?token=secret' }),
    /查询参数/,
  )
  assert.throws(
    () => service.addInstance({ name: 'FTP URL', baseUrl: 'ftp://host.example' }),
    /http 或 https/,
  )
  const changed = service.updateInstance(instance.id, { name: 'Local Renamed', credentialRef: null })
  assert.equal(changed.id, instance.id)
  assert.equal(changed.credentialRef, undefined)
  await service.dispose()
  service = f.service()
  assert.equal(service.getInstance(instance.id).name, 'Local Renamed')
  service.removeInstance(instance.id)
  assert.throws(() => service.getInstance(instance.id), /找不到 Gitea 实例/)
})

test('实例验证区分配置、认证、凭据缺失与重定向', async (t) => {
  const f = await fixture(t)
  const service = f.service()
  const instance = service.addInstance({
    name: 'Auth',
    baseUrl: f.baseUrl,
    credentialRef: 'GITEA_TOKEN',
  })
  const verified = await service.verifyInstance(instance.id)
  assert.equal(verified.state, 'ok')
  assert.equal(verified.version, '1.25.5')
  assert.equal(verified.authenticated, true)
  assert.equal(verified.login, 'acme')
  assert.equal(f.requests.some((request) => request.authorization === 'token test-token'), true)
  assert.equal(f.requests.some((request) => request.url.includes('test-token')), false)

  const noCredential = service.addInstance({ name: 'Public', baseUrl: `${f.baseUrl}/public` })
  const anonymous = await service.verifyInstance(noCredential.id)
  assert.equal(anonymous.state, 'ok')
  assert.equal(anonymous.authenticated, false)

  const missing = service.addInstance({
    name: 'Missing',
    baseUrl: `${f.baseUrl}/missing-env`,
    credentialRef: 'GITEA_MISSING_TOKEN',
  })
  const missingResult = await service.verifyInstance(missing.id)
  assert.equal(missingResult.state, 'credential-missing')
  assert.equal(JSON.stringify(missingResult).includes('GITEA_MISSING_TOKEN'), true)

  const redirect = service.addInstance({ name: 'Redirect', baseUrl: `${f.baseUrl}/redirect` })
  const redirected = await service.verifyInstance(redirect.id)
  assert.equal(redirected.state, 'redirect')
  assert.equal(f.requests.some((request) => request.url.includes('evil.invalid')), false)
})

test('优先经 DSH credentials seam 解析引用，环境变量仅作回退', async (t) => {
  const f = await fixture(t)
  const seen = []
  const service = f.service({
    env: {},
    credentials: {
      async resolve(reference) {
        seen.push(reference)
        return reference === 'GITEA_TOKEN' ? { value: 'test-token' } : undefined
      },
    },
  })
  const instance = service.addInstance({
    name: 'Credentials',
    baseUrl: f.baseUrl,
    credentialRef: 'GITEA_TOKEN',
  })
  const verified = await service.verifyInstance(instance.id)
  assert.equal(verified.state, 'ok')
  assert.equal(verified.login, 'acme')
  assert.deepEqual(seen, ['GITEA_TOKEN', 'GITEA_TOKEN'])
  assert.equal(f.requests.every((request) =>
    request.authorization === 'token test-token' || request.authorization === undefined), true)
})

test('仓库按 owner/repo 观察，并以来源限定数字 ID 保持引用', async (t) => {
  const f = await fixture(t)
  const service = f.service()
  const instance = service.addInstance({ name: 'Repo', baseUrl: f.baseUrl, credentialRef: 'GITEA_TOKEN' })
  const observed = await service.inspectRepository(instance.id, 'acme/repo')
  assert.equal(observed.state, 'available')
  assert.equal(observed.repository.id, 7)
  assert.equal(observed.repository.fullName, 'acme/repo')
  assert.equal(observed.repository.defaultBranch, 'main')
  assert.equal(observed.repository.hasActions, true)

  const reference = service.reference(instance.id, observed.repository.id)
  assert.deepEqual(reference, { namespace: 'locus.gitea.repository', id: `${instance.id}:7` })
  const renamedObservation = await service.inspectReference(reference)
  assert.equal(renamedObservation.state, 'available')
  assert.equal(renamedObservation.repository.fullName, 'acme/renamed')

  assert.equal((await service.inspectRepository(instance.id, 'acme/missing')).state, 'not-found')
  assert.equal((await service.inspectRepository(instance.id, 'acme/denied')).state, 'unauthorized')
  assert.equal((await service.inspectRepository(instance.id, 'acme/forbidden')).state, 'forbidden')
  assert.equal((await service.inspectRepository(instance.id, 'acme/limited')).state, 'rate-limited')
  assert.equal((await service.inspectReference({ namespace: 'locus.gitea.repository', id: 'missing:7' })).state, 'instance-missing')
  await assert.rejects(service.inspectRepository(instance.id, 'invalid'), /owner\/repo/)
})

test('Run 列表区分成功、失败、运行中、空、Actions 未启用与 API 不支持', async (t) => {
  const f = await fixture(t)
  const service = f.service()
  const instance = service.addInstance({ name: 'Runs', baseUrl: f.baseUrl, credentialRef: 'GITEA_TOKEN' })
  const reference = service.reference(instance.id, 7)
  const listed = await service.runs(reference, { limit: 2, headSha: sha('a') })
  assert.equal(listed.state, 'available')
  assert.equal(listed.totalCount, 3)
  assert.deepEqual(listed.runs.map((item) => item.outcome), ['success', 'failure'])
  assert.equal(listed.runs[0].startedAt, undefined)
  assert.equal(new URL(f.requests.at(-1).url, 'http://local').searchParams.get('limit'), '2')
  assert.equal(new URL(f.requests.at(-1).url, 'http://local').searchParams.get('head_sha'), sha('a'))

  const empty = await service.runs(reference, { headSha: sha('f') })
  assert.equal(empty.state, 'empty')
  assert.deepEqual(empty.runs, [])

  const disabledReference = service.reference(instance.id, 8)
  const disabledResult = await service.runs(disabledReference)
  assert.equal(disabledResult.state, 'actions-disabled')
  assert.equal(f.disabledRunsRequestCount, 0)

  const unsupported = await service.inspectRepository(instance.id, 'acme/unsupported')
  const unsupportedReference = service.reference(instance.id, unsupported.repository.id)
  const unsupportedResult = await service.runs(unsupportedReference)
  assert.equal(unsupportedResult.state, 'unsupported')
  assert.match(unsupportedResult.error, /Actions API 返回 404/)

  await assert.rejects(service.runs(reference, { limit: 0 }), /1–100/)
  await assert.rejects(service.runs(reference, { headSha: 'not-a-sha' }), /十六进制/)
  assert.ok(f.runsRequestCount > 0)
})

test('Run 详情保留状态、结论、提交、工作流与时间', async (t) => {
  const f = await fixture(t)
  const service = f.service()
  const instance = service.addInstance({ name: 'Run detail', baseUrl: f.baseUrl, credentialRef: 'GITEA_TOKEN' })
  const reference = service.reference(instance.id, 7)
  const detail = await service.run(reference, 101)
  assert.equal(detail.state, 'available')
  assert.equal(detail.run.outcome, 'success')
  assert.equal(detail.run.headSha, sha('a'))
  assert.equal(detail.run.workflowPath, 'ci.yaml@refs/heads/main')
  assert.equal(detail.run.startedAt, '2026-07-16T15:15:45+08:00')
  assert.equal(detail.run.completedAt, '2026-07-16T15:16:19+08:00')
  assert.equal(detail.run.htmlUrl, 'http://gitea.example/acme/repo/actions/runs/1')

  const missing = await service.run(reference, 999)
  assert.equal(missing.state, 'not-found')
})

test('Git Remote 只生成候选，不自动请求或写入', async (t) => {
  const f = await fixture(t)
  const service = f.service()
  const instance = service.addInstance({ name: 'Suggest', baseUrl: f.baseUrl })
  const before = f.requests.length
  const suggestions = service.suggest([
    { name: 'origin', url: 'https://user:secret@127.0.0.1:1/acme/repo.git?token=x' },
    { name: 'gitea', url: `${f.baseUrl}/acme/repo.git` },
    { name: 'renamed', url: `git@127.0.0.1:acme/repo.git` },
    { name: 'other', url: 'https://example.invalid/acme/repo.git' },
  ])
  assert.deepEqual(suggestions.map((item) => item.fullName), ['acme/repo', 'acme/repo'])
  assert.deepEqual(suggestions.map((item) => item.matchedBy), ['http', 'ssh'])
  assert.equal(suggestions.every((item) => item.instanceId === instance.id), true)
  assert.equal(f.requests.length, before)
  assert.equal(JSON.stringify(suggestions).includes('secret'), false)
})

test('释放后拒绝新请求，并关闭实例存储', async (t) => {
  const f = await fixture(t)
  const service = f.service()
  const instance = service.addInstance({ name: 'Dispose', baseUrl: f.baseUrl })
  await service.dispose()
  assert.throws(() => service.listInstances(), /已释放/)
  assert.throws(() => service.addInstance({ name: 'After', baseUrl: f.baseUrl }), /已释放/)
  await assert.rejects(service.verifyInstance(instance.id), /已释放/)
})
