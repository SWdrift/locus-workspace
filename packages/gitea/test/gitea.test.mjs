import assert from 'node:assert/strict'
import test from 'node:test'
import { SecurityFailure } from '@locus/core'
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
  assert.equal(await result.response.text(), 'ok')
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
  await serverError.response.body?.cancel()
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
