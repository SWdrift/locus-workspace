import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { z } from 'zod'
import {
  createApiRouter, createDispatcher, createEventBus, createLocusCore,
  createMemoryCredentialProvider, createMemorySecurityStore, defineComponent, defineCredential,
  defineOperation, DomainFailure, parseLocusUri,
} from '../lib/index.js'

const ROOT_PASSWORD = 'Root-仅供调用测试-2026'

function demoComponent() {
  const auth = defineCredential({
    id: 'demo-auth',
    fields: [
      { name: 'user', secret: false, required: true },
      { name: 'secret', secret: true, required: true },
    ],
  })
  const write = defineOperation({
    id: 'demo.write', method: 'PUT', scheme: 'demo', authority: 'items', path: '/:id', auth: 'root',
    input: z.object({ value: z.string() }),
    output: z.object({ reference: z.string() }),
    async run(_query, input, context) {
      const reference = await context.credential.write(auth, context.url.pathParams.id, {
        user: 'demo-user',
        secret: input.value,
      })
      return { reference }
    },
  })
  const read = defineOperation({
    id: 'demo.read', method: 'GET', scheme: 'demo', authority: 'items', path: '/:id', auth: 'user',
    input: z.undefined(),
    output: z.object({ secret: z.string() }),
    async run(_query, _input, context) {
      return context.credential.read(auth, context.url.pathParams.id, (values) => ({ secret: values.secret }))
    },
  })
  const tty = defineOperation({
    id: 'demo.tty', method: 'POST', scheme: 'demo', authority: 'items', path: '/:id/actions/tty', auth: 'user',
    input: z.object({ value: z.string(), prompted: z.string().optional() }),
    fields: { prompted: { secret: true, tty: true } },
    output: z.object({ value: z.string(), prompted: z.string().optional() }),
    run: (_query, input) => input,
  })
  const fail = defineOperation({
    id: 'demo.fail', method: 'GET', scheme: 'demo', authority: 'actions', path: '/fail', auth: 'user',
    input: z.undefined(), output: z.unknown(),
    run: () => { throw new DomainFailure('target-not-found', '目标不存在') },
  })
  return defineComponent({
    id: 'demo', version: '1', name: 'demo', summary: '调用协议测试组件', kind: 'locus',
    operations: [write, read, tty, fail], credentials: [auth],
  })
}

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'locus-invocation-'))
  let host
  const core = createLocusCore({
    dataDirectory: directory,
    components: [demoComponent()],
    security: {
      store: createMemorySecurityStore(),
      provider: createMemoryCredentialProvider(),
      receiveHost(value) { host = value },
    },
  })
  const session = host.createSession('human')
  const dispatcher = createDispatcher(
    core.router, host, session, core.events, core.dataDirectory,
    { get: () => undefined },
  )
  t.after(async () => {
    try { host.endSession(session) } catch { /* 已结束 */ }
    await core.dispose()
    rmSync(directory, { recursive: true, force: true })
  })
  const initialized = await dispatcher.invoke(
    { method: 'POST', uri: 'locus://security/actions/init' },
    { password: ROOT_PASSWORD, confirmation: ROOT_PASSWORD },
  )
  assert.equal(initialized.ok, true)
  return { core, host, session, dispatcher }
}

async function authorize(host, result) {
  if (result.ok) return result
  const challenge = result.error.details?.challenge
  assert.ok(challenge, `期望认证挑战，实际：${JSON.stringify(result.error)}`)
  const grant = await host.authenticate(challenge, ROOT_PASSWORD)
  return host.resume(grant)
}

test('schema 推导到 handler 与消费方，并拒绝错误输出和异步监听器', () => {
  execFileSync(process.execPath, [
    createRequire(import.meta.url).resolve('typescript/bin/tsc'),
    '--noEmit', '--strict', '--skipLibCheck', '--target', 'es2024', '--module', 'nodenext',
    fileURLToPath(new URL('./invocation.types.ts', import.meta.url)),
  ], { stdio: 'pipe' })
})

test('URI 接受标准 dot segment 规范化，并保留重复 query 值', () => {
  const url = parseLocusUri('rt://targets/a/%2e%2e/b?tag=x&tag=y')
  assert.equal(url.href, 'rt://targets/b?tag=x&tag=y')
  assert.deepEqual(url.query.tag, ['x', 'y'])
})

test('URI 拒绝身份注入、fragment 与解码后改变分段的路径', () => {
  for (const uri of ['rt://user@targets/a', 'rt://targets/a#x', 'rt://targets/a%2Fb', 'rt://targets/%00']) {
    assert.throws(() => parseLocusUri(uri), { code: 'invalid-uri' })
  }
})

test('建链对参数编码一次，并在路由匹配时恢复原值', () => {
  const target = defineOperation({
    id: 'rt.target.get', method: 'GET', scheme: 'rt', authority: 'targets', path: '/:id', auth: 'user',
    input: z.undefined(), output: z.object({ id: z.string() }),
    run: (_query, _input, context) => ({ id: context.url.pathParams.id }),
  })
  const router = createApiRouter()
  router.register('remote-targets', target)
  const uri = router.build(target.id, { id: '甲 乙' })
  assert.equal(router.resolve('GET', uri).url.pathParams.id, '甲 乙')
  assert.throws(() => router.resolve('POST', uri), { code: 'unsupported-method' })
})

test('注册期拒绝仅参数名不同的歧义路由', () => {
  const route = (id, path) => defineOperation({
    id, method: 'GET', scheme: 'rt', authority: 'targets', path, auth: 'user',
    input: z.undefined(), output: z.unknown(), run: () => undefined,
  })
  const router = createApiRouter()
  router.register('remote-targets', route('rt.one', '/:id'))
  assert.throws(() => router.register('remote-targets', route('rt.two', '/:name')), { code: 'conflict' })
})

test('Dispatcher 建链、结果信封与稳定错误映射', async (t) => {
  const { dispatcher } = await fixture(t)
  const info = await dispatcher.invoke({ method: 'GET', uri: 'locus://info' })
  assert.equal(info.ok, true)
  assert.equal(info.links.self, 'locus://info')
  assert.equal(info.meta.operation, 'locus.info.get')

  const missing = await dispatcher.invoke({ method: 'GET', uri: 'locus://missing' })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'not-found')

  const scheme = await dispatcher.invoke({ method: 'GET', uri: 'nope://x' })
  assert.equal(scheme.ok, false)
  assert.equal(scheme.error.code, 'unsupported-scheme')

  const media = await dispatcher.invoke({
    method: 'POST', uri: 'locus://workspaces', body: { name: 'x' }, contentType: 'text/plain',
  })
  assert.equal(media.ok, false)
  assert.equal(media.error.code, 'unsupported-media-type')
})

test('Body 中 tty 字段被拒绝；可信 Host 收集后直接交给 handler', async (t) => {
  const { dispatcher } = await fixture(t)
  const rejected = await dispatcher.invoke({
    method: 'POST', uri: 'demo://items/a/actions/tty',
    body: { value: 'v', prompted: 'secret' }, contentType: 'application/json',
  })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.code, 'invalid-body')

  const accepted = await dispatcher.invoke(
    { method: 'POST', uri: 'demo://items/a/actions/tty', body: { value: 'v' }, contentType: 'application/json' },
    { prompted: 'secret' },
  )
  assert.equal(accepted.ok, true)
  assert.equal(accepted.data.prompted, 'secret')
})

test('Root 写凭据、user 读取；缺失 key 在 consume 前失败', async (t) => {
  const { dispatcher, host } = await fixture(t)
  const pending = await dispatcher.invoke({
    method: 'PUT', uri: 'demo://items/alpha', body: { value: '秘密值' }, contentType: 'application/json',
  })
  assert.equal(pending.ok, false)
  assert.equal(pending.error.code, 'unauthorized')
  const written = await authorize(host, pending)
  assert.equal(written.ok, true)

  const read = await dispatcher.invoke({ method: 'GET', uri: 'demo://items/alpha' })
  assert.equal(read.ok, true)
  assert.equal(read.data.secret, '秘密值')

  let consumed = false
  const missing = await dispatcher.invoke({ method: 'GET', uri: 'demo://items/beta' })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'not-found')
  assert.equal(consumed, false)

  const pendingBeta = await dispatcher.invoke({
    method: 'PUT', uri: 'demo://items/beta', body: { value: '另一个' }, contentType: 'application/json',
  })
  await authorize(host, pendingBeta)
  const beta = await dispatcher.invoke({ method: 'GET', uri: 'demo://items/beta' })
  assert.equal(beta.data.secret, '另一个')
})

test('operation 等级可覆盖；降为 user 后凭据写入被拒，reset 恢复声明', async (t) => {
  const { dispatcher, host } = await fixture(t)
  const downgrade = await dispatcher.invoke({
    method: 'PUT', uri: 'locus://security/operations/demo/demo.write',
    body: { level: 'user' }, contentType: 'application/json',
  })
  await authorize(host, downgrade)
  const write = await dispatcher.invoke({
    method: 'PUT', uri: 'demo://items/gamma', body: { value: 'x' }, contentType: 'application/json',
  })
  assert.equal(write.ok, false)
  assert.equal(write.error.code, 'forbidden')
  assert.equal(write.error.details.reason, 'credential-write-requires-root')

  const reset = await dispatcher.invoke({
    method: 'DELETE', uri: 'locus://security/operations/demo/demo.write',
  })
  await authorize(host, reset)
  const pending = await dispatcher.invoke({
    method: 'PUT', uri: 'demo://items/gamma', body: { value: 'y' }, contentType: 'application/json',
  })
  assert.equal(pending.error.code, 'unauthorized')
  const written = await authorize(host, pending)
  assert.equal(written.ok, true)
})

test('Session Grant 复用同 operation 与参数，Root 重置撤销全部授权', async (t) => {
  const { dispatcher, host } = await fixture(t)
  const first = await dispatcher.invoke({ method: 'GET', uri: 'locus://security/operations' })
  const challenge = first.error.details.challenge
  const grant = await host.authenticate(challenge, ROOT_PASSWORD, 'session')
  assert.equal((await host.resume(grant)).ok, true)
  const second = await dispatcher.invoke({ method: 'GET', uri: 'locus://security/operations' })
  assert.equal(second.ok, true)

  const reset = await dispatcher.invoke({
    method: 'POST', uri: 'locus://security/actions/reset-root',
  }, { password: 'Root-新密码-2026', confirmation: 'Root-新密码-2026', confirm: 'RESET ROOT' })
  assert.equal(reset.ok, true)
  const afterReset = await dispatcher.invoke({ method: 'GET', uri: 'locus://security/operations' })
  assert.equal(afterReset.ok, false)
  assert.equal(afterReset.error.code, 'unauthorized')
})

test('批量 GET 保序并保留部分失败；非 GET 批量被拒绝', async (t) => {
  const { dispatcher } = await fixture(t)
  const results = await dispatcher.invokeAll([
    { method: 'GET', uri: 'locus://info' },
    { method: 'GET', uri: 'locus://missing' },
  ])
  assert.equal(results.length, 2)
  assert.equal(results[0].ok, true)
  assert.equal(results[1].ok, false)

  const rejected = await dispatcher.invokeAll([
    { method: 'POST', uri: 'locus://workspaces' },
  ])
  assert.equal(rejected[0].ok, false)
  assert.equal(rejected[0].error.code, 'unsupported-method')
})

test('请求不能设置 principal；body 中的 principal 不提升权限', async (t) => {
  const { dispatcher } = await fixture(t)
  const result = await dispatcher.invoke({
    method: 'PUT', uri: 'demo://items/principal', body: { value: 'x', principal: 'root' },
    contentType: 'application/json',
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'unauthorized')
})

test('领域失败在协议边界映射为稳定错误码', async (t) => {
  const { dispatcher } = await fixture(t)
  const result = await dispatcher.invoke({ method: 'GET', uri: 'demo://actions/fail' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'not-found')
  assert.equal(result.error.details.domain, 'target-not-found')
})

test('同步监听器抛错不阻断其余监听器；异步返回值不被接受为契约', () => {
  const bus = createEventBus()
  const received = []
  bus.subscribe('demo.event', () => { throw new Error('listener failure') })
  bus.subscribe('demo.event', (event) => { received.push(event.id) })
  bus.publish({
    specversion: '1.0', id: 'one', type: 'demo.event', source: 'locus://demo',
    time: new Date().toISOString(), data: {},
  })
  assert.deepEqual(received, ['one'])
  assert.equal(bus.list({ type: 'demo.event' }).length, 1)
})
