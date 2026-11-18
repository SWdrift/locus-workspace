import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createLocusCore } from '@locus/core'
import { createDispatcher } from '@locus/core/invocation'
import { createMemoryCredentialProvider, createMemorySecurityStore, SecurityFailure } from '@locus/core/security'
import { component, operations } from '../lib/index.js'

const TOKEN = 'gitea-sentinel-token'
const ORIGIN = 'http://127.0.0.1:3000'

function operation(id) {
  const found = operations.find((candidate) => candidate.id === id)
  assert.ok(found, `缺少 operation：${id}`)
  return found
}

const register = operation('gitea.repository.register')
const request = operation('gitea.repository.request')

/**
 * 只实现被调用字段的 fake context：pathParams 提供仓库 id，
 * credential.read 用登记字段驱动消费回调，credential.write 捕获写入。
 */
function fakeContext({ id = 'local', values = { origin: ORIGIN, token: TOKEN }, onWrite } = {}) {
  const reads = []
  const writes = []
  return {
    reads,
    writes,
    url: { pathParams: { id } },
    dataDirectory: '',
    credential: {
      async read(credential, key, consume) {
        reads.push({ credential, key })
        return consume(values)
      },
      async write(credential, key, fields) {
        writes.push({ credential, key, fields })
        return onWrite === undefined ? `credential:${key}` : onWrite(credential, key, fields)
      },
    },
  }
}

/** 操作未暴露 fetcher 参数：替换全局实现，测试结束恢复，绝不触网。 */
function stubFetch(t, fetcher) {
  const original = globalThis.fetch
  globalThis.fetch = fetcher
  t.after(() => {
    globalThis.fetch = original
  })
}

test('Gitea 只暴露 operation 契约，不携带 capability 声明', () => {
  assert.deepEqual(component.operations.map((metadata) => metadata.id), [
    'gitea.repository.register',
    'gitea.repository.request',
  ])
  assert.equal('capabilities' in component, false)
  assert.equal('api' in component, false)
  assert.equal(register.auth, 'root')
  assert.equal(request.auth, 'user')
  assert.equal(register.path, '/:id')
  assert.equal(request.path, '/:id/requests')
  for (const item of operations) assert.match(item.summary, /[\u4e00-\u9fff]/)
  assert.equal(register.fields.token.required, true)
  assert.equal(register.fields.token.tty, true)
  assert.equal(register.fields.token.secret, true)
  assert.match(register.fields.token.description, /Gitea API 令牌/)
  assert.throws(() => register.input.parse({ origin: ORIGIN }))
  assert.throws(() => request.input.parse({}))
  assert.deepEqual(register.input.parse({ origin: ORIGIN, token: TOKEN, credential: 'credential:x' }), {
    origin: ORIGIN,
    token: TOKEN,
  })
  assert.deepEqual(
    request.input.parse({ path: '/api', method: 'GET', headers: {}, body: 'x', target: 'http://elsewhere' }),
    { path: '/api', method: 'GET', headers: {}, body: 'x' },
  )
})

test('gitea.repository.register 以仓库 id 写入 api-token，并规范化 origin', async () => {
  const context = fakeContext({ id: 'local', onWrite: () => 'credential:local' })
  const result = await register.run(
    undefined,
    { origin: 'HTTP://127.0.0.1:80/', token: TOKEN },
    context,
  )
  assert.deepEqual(result, { registered: true, reference: 'credential:local' })
  assert.equal(context.reads.length, 0)
  assert.equal(context.writes.length, 1)
  const [{ credential, key, fields }] = context.writes
  assert.equal(credential.id, 'api-token')
  assert.deepEqual(credential.secretFields, ['token'])
  assert.equal(credential.declaration.fields.find((field) => field.name === 'origin').secret, false)
  assert.equal(key, 'local')
  assert.deepEqual({ ...fields }, { origin: 'http://127.0.0.1', token: TOKEN })

  const missingId = fakeContext({ id: '' })
  const fallback = await register.run(undefined, { origin: `${ORIGIN}/`, token: TOKEN }, missingId)
  assert.deepEqual(fallback, { registered: true, reference: 'credential:' })
  assert.equal(missingId.writes[0].key, '')
  assert.equal(missingId.writes[0].fields.origin, ORIGIN)
})

test('gitea.repository.register 拒绝非 origin 目标且不写凭据', async () => {
  const invalid = [
    'not a url',
    'ftp://127.0.0.1',
    'http://user:pass@127.0.0.1',
    'http://user@127.0.0.1',
    'http://127.0.0.1/api',
    'http://127.0.0.1/?query=1',
    'http://127.0.0.1/#fragment',
  ]
  for (const origin of invalid) {
    const context = fakeContext()
    await assert.rejects(
      () => register.run(undefined, { origin, token: TOKEN }, context),
      (error) => error instanceof SecurityFailure &&
        error.code === 'access-denied' && error.reason === 'invalid-request',
      `origin 应被拒绝：${origin}`,
    )
    assert.equal(context.writes.length, 0, `不应写入凭据：${origin}`)
  }
})

test('gitea.repository.request 只向绑定 origin 交付 Authorization，重定向不跟随', async (t) => {
  const calls = []
  let delivered
  let sent
  let accept
  stubFetch(t, async (url, init) => {
    calls.push({ url, init })
    delivered = init.headers
    const headers = new Headers(init.headers)
    sent = headers.get('authorization')
    accept = headers.get('accept')
    return new Response('ok')
  })
  const context = fakeContext({ id: 'repo-1' })
  const result = await request.run(
    undefined,
    { path: '/api/v1/version', method: 'POST', headers: { accept: 'application/json' }, body: 'payload' },
    context,
  )

  assert.equal(result.kind, 'response')
  assert.equal(result.response.body, 'ok')
  assert.deepEqual(request.output.parse(result), result)
  assert.equal(calls.length, 1)
  const [{ url, init }] = calls
  assert.equal(url.href, `${ORIGIN}/api/v1/version`)
  assert.equal(init.method, 'POST')
  assert.equal(init.body, 'payload')
  assert.equal(init.redirect, 'manual')
  assert.equal(sent, `Bearer ${TOKEN}`)
  assert.equal(accept, 'application/json')
  assert.equal(context.reads.length, 1)
  assert.equal(context.reads[0].credential.id, 'api-token')
  assert.equal(context.reads[0].key, 'repo-1')
  assert.equal(context.writes.length, 0)

  // 交付后同一 Headers 实例中的 Authorization 已被清除。
  assert.equal(delivered.has('authorization'), false)
})

test('gitea.repository.request 拒绝其他 origin 与调用方 Authorization，且不发请求', async (t) => {
  let calls = 0
  stubFetch(t, async () => {
    calls += 1
    return new Response('ok')
  })
  const mismatch = (error) => error instanceof SecurityFailure &&
    error.code === 'access-denied' && error.reason === 'resource-mismatch'

  await assert.rejects(
    () => request.run(undefined, { path: 'http://127.0.0.1:1/api' }, fakeContext()),
    mismatch,
  )
  await assert.rejects(
    () => request.run(undefined, { path: '//127.0.0.1:1/api' }, fakeContext()),
    mismatch,
  )
  await assert.rejects(
    () => request.run(undefined, { path: `http://user@127.0.0.1:3000/api` }, fakeContext()),
    mismatch,
  )
  await assert.rejects(
    () => request.run(
      undefined,
      { path: '/api', headers: { Authorization: 'Bearer caller-supplied' } },
      fakeContext(),
    ),
    mismatch,
  )
  await assert.rejects(
    () => request.run(
      undefined,
      { path: '/api', headers: { authorization: 'Bearer caller-supplied' } },
      fakeContext(),
    ),
    mismatch,
  )
  assert.equal(calls, 0)
})

test('gitea.repository.request 把 401/403 与网络失败分开', async (t) => {
  let handler = async () => new Response('denied', { status: 401 })
  stubFetch(t, (url, init) => handler(url, init))

  assert.deepEqual(
    await request.run(undefined, { path: '/api' }, fakeContext()),
    { kind: 'authentication-failed', status: 401 },
  )
  handler = async () => new Response('forbidden', { status: 403 })
  assert.deepEqual(
    await request.run(undefined, { path: '/api' }, fakeContext()),
    { kind: 'authentication-failed', status: 403 },
  )
  handler = async () => {
    throw new Error('network down')
  }
  assert.deepEqual(
    await request.run(undefined, { path: '/api' }, fakeContext()),
    { kind: 'network-failed' },
  )
  handler = async () => new Response('ok', { status: 500 })
  const serverError = await request.run(undefined, { path: '/api' }, fakeContext())
  assert.equal(serverError.kind, 'response')
  assert.equal(serverError.response.status, 500)
  assert.equal(serverError.response.body, 'ok')
})

test('gitea.repository.request 在凭据字段缺失时交付失败', async (t) => {
  stubFetch(t, async () => new Response('should not be reached'))
  for (const values of [{ origin: ORIGIN }, { token: TOKEN }, {}]) {
    await assert.rejects(
      () => request.run(undefined, { path: '/api' }, fakeContext({ values })),
      (error) => error instanceof SecurityFailure && error.code === 'delivery-failed',
    )
  }
})

test('真实 HTTP 与 Dispatcher 返回可 JSON 消费的响应，并隔离认证、重定向与网络失败', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'locus-gitea-http-'))
  const received = []
  const redirected = []
  const other = createServer((incoming, outgoing) => {
    redirected.push(incoming.url)
    outgoing.end('不应跟随重定向')
  })
  const listen = (server) => new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const close = async (server) => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
  const server = createServer(async (incoming, outgoing) => {
    let body = ''
    for await (const chunk of incoming) body += chunk
    received.push({
      path: incoming.url,
      method: incoming.method,
      authorization: incoming.headers.authorization,
      accept: incoming.headers.accept,
      body,
    })
    if (incoming.url === '/network-failure') {
      incoming.socket.destroy()
      return
    }
    if (incoming.url === '/redirect') {
      outgoing.writeHead(302, { location: `http://127.0.0.1:${other.address().port}/secret` })
      outgoing.end('moved')
      return
    }
    if (incoming.url === '/unauthorized' || incoming.url === '/forbidden') {
      outgoing.writeHead(incoming.url === '/unauthorized' ? 401 : 403)
      outgoing.end('拒绝正文不应成为响应数据')
      return
    }
    if (incoming.url === '/echo-authorization') {
      outgoing.writeHead(200, { 'content-type': 'application/json', etag: TOKEN })
      outgoing.end(JSON.stringify({ authorization: incoming.headers.authorization }))
      return
    }
    outgoing.writeHead(200, {
      'content-type': 'application/json',
      etag: '"version-1"',
      authorization: 'Bearer unsafe-response-header',
      'set-cookie': 'unsafe-cookie',
    })
    outgoing.end(JSON.stringify({ version: '1.0', payload: body }))
  })
  let core
  let host
  let session
  t.after(async () => {
    if (session !== undefined) host.endSession(session)
    await core?.dispose()
    await close(server)
    await close(other)
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  await listen(other)
  await listen(server)
  core = createLocusCore({
    dataDirectory: directory,
    components: [{ component, operations }],
    security: {
      store: createMemorySecurityStore(),
      provider: createMemoryCredentialProvider(),
      receiveHost(value) { host = value },
    },
  })
  const password = 'gitea-http-test-root'
  await host.initializeRoot(password, password)
  session = host.createSession('human')
  const dispatcher = createDispatcher(core.router, host, session, core.events, core.dataDirectory)
  const origin = `http://127.0.0.1:${server.address().port}`
  const pending = await dispatcher.invoke({
    method: 'PUT',
    uri: 'gitea://repositories/local',
    contentType: 'application/json',
    body: { origin },
  }, { token: TOKEN })
  assert.equal(pending.ok, false)
  const challenge = pending.error.details.challenge
  assert.ok(challenge)
  const registered = await host.resume(await host.authenticate(challenge, password))
  assert.equal(registered.ok, true)

  const invoke = (body) => dispatcher.invoke({
    method: 'POST',
    uri: 'gitea://repositories/local/requests',
    contentType: 'application/json',
    body,
  })
  const result = await invoke({
    path: '/api/v1/version',
    method: 'POST',
    headers: { accept: 'application/json' },
    body: 'payload',
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.kind, 'response')
  assert.equal(result.data.response.status, 200)
  assert.deepEqual(request.output.parse(result.data), result.data)
  const json = JSON.parse(JSON.stringify(result))
  assert.deepEqual(JSON.parse(json.data.response.body), { version: '1.0', payload: 'payload' })
  assert.equal(json.data.response.headers['content-type'], 'application/json')
  assert.equal(json.data.response.headers.etag, '"version-1"')
  assert.equal('authorization' in json.data.response.headers, false)
  assert.equal('set-cookie' in json.data.response.headers, false)
  assert.equal(JSON.stringify(result).includes(TOKEN), false)
  assert.equal(JSON.stringify(result).includes('unsafe-response-header'), false)
  assert.deepEqual(received[0], {
    path: '/api/v1/version',
    method: 'POST',
    authorization: `Bearer ${TOKEN}`,
    accept: 'application/json',
    body: 'payload',
  })
  const echoed = await invoke({ path: '/echo-authorization' })
  assert.equal(echoed.ok, true)
  assert.equal(JSON.stringify(echoed).includes(TOKEN), false)
  assert.equal(echoed.data.response.headers.etag, '[已脱敏]')
  assert.deepEqual(JSON.parse(echoed.data.response.body), { authorization: 'Bearer [已脱敏]' })

  const moved = await invoke({ path: '/redirect' })
  assert.equal(moved.ok, true)
  assert.equal(moved.data.response.status, 302)
  assert.equal(moved.data.response.body, 'moved')
  assert.equal(moved.data.response.headers.location, `http://127.0.0.1:${other.address().port}/secret`)
  assert.deepEqual(redirected, [])
  for (const [path, status] of [['/unauthorized', 401], ['/forbidden', 403]]) {
    const denied = await invoke({ path })
    assert.equal(denied.ok, true)
    assert.deepEqual(denied.data, { kind: 'authentication-failed', status })
  }
  const network = await invoke({ path: '/network-failure' })
  assert.equal(network.ok, true)
  assert.deepEqual(network.data, { kind: 'network-failed' })

  const before = received.length
  for (const body of [
    { path: `http://127.0.0.1:${other.address().port}/external` },
    { path: '/api', headers: { Authorization: 'Bearer injected-secret' } },
  ]) {
    const denied = await invoke(body)
    assert.equal(denied.ok, false)
    assert.equal(denied.error.code, 'forbidden')
    assert.equal(JSON.stringify(denied).includes(TOKEN), false)
    assert.equal(JSON.stringify(denied).includes('injected-secret'), false)
  }
  assert.equal(received.length, before)
  assert.deepEqual(redirected, [])
})
