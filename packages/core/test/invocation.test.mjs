import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { z } from 'zod'
import { createLocusCore } from '../lib/index.js'
import {
  createApiRouter, createDispatcher, defineCredential,
  defineOperation, describeOperation, DomainFailure, InvocationFailure, parseLocusUri,
} from '../lib/invocation/index.js'
import { defineComponent } from '../lib/components/index.js'
import { createEventBus } from '../lib/events/index.js'
import {
  createMemoryCredentialProvider, createMemorySecurityStore, SecurityFailure,
} from '../lib/security/index.js'

const ROOT_PASSWORD = 'Root-仅供调用测试-2026'
const INTERNAL_FAILURE_SECRET = 'internal-error-secret-sentinel'

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
    summary: '接收必填 value 与可选的可信 prompted 输入。',
    input: z.object({ value: z.string(), prompted: z.string().optional() }),
    // 故意反转必填提示，验证字段元数据不替代 input schema 的实际校验。
    fields: {
      value: { description: '普通 Body 中的必填值。', required: false },
      prompted: { description: '可选的可信输入。', required: true, secret: true, tty: true, file: true },
    },
    output: z.object({ value: z.string(), prompted: z.string().optional() }),
    run: (_query, input) => input,
  })
  const fail = defineOperation({
    id: 'demo.fail', method: 'GET', scheme: 'demo', authority: 'actions', path: '/fail', auth: 'user',
    input: z.undefined(), output: z.never(),
    run: () => {
      try {
        throw new DomainFailure('demo-missing', '对象不存在')
      } catch (error) {
        if (error instanceof DomainFailure && error.code === 'demo-missing') {
          throw new InvocationFailure('not-found', error.message, { details: { domain: error.code } })
        }
        throw error
      }
    },
  })
  const unclassified = defineOperation({
    id: 'demo.unclassified', method: 'GET', scheme: 'demo', authority: 'actions', path: '/unclassified', auth: 'user',
    input: z.undefined(), output: z.never(),
    run: () => { throw new DomainFailure('target-not-found', '未经 operation 分类的领域失败') },
  })
  const securityFailure = defineOperation({
    id: 'demo.security-failure', method: 'GET', scheme: 'demo', authority: 'actions', path: '/security/:code', auth: 'user',
    input: z.undefined(), output: z.never(),
    run: (_query, _input, context) => { throw new SecurityFailure(context.url.pathParams.code) },
  })
  const rootFailure = defineOperation({
    id: 'demo.root.failure', method: 'POST', scheme: 'demo', authority: 'actions', path: '/root-failure', auth: 'root',
    input: z.undefined(), output: z.never(),
    run: () => { throw new Error(INTERNAL_FAILURE_SECRET) },
  })
  const bareFailure = defineOperation({
    id: 'demo.bare.failure', method: 'GET', scheme: 'demo', authority: 'actions', path: '/bare-failure', auth: 'user',
    input: z.undefined(), output: z.never(),
    run: () => { throw new TypeError(INTERNAL_FAILURE_SECRET) },
  })
  return defineComponent({
    id: 'demo', version: '1', name: 'demo', summary: '调用协议测试组件', kind: 'locus',
    operations: [write, read, tty, fail, unclassified, securityFailure, rootFailure, bareFailure], credentials: [auth],
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

test('路由注册复制描述字段；发现、建链与查询不执行 schema 或 handler', () => {
  let parses = 0
  let runs = 0
  const schema = { parse(value) { parses += 1; return value } }
  const fields = { token: { description: '可信访问令牌。', required: false, secret: true, tty: true, file: true } }
  const source = defineOperation({
    id: 'demo.describe', summary: '发现声明而不执行业务。',
    method: 'POST', scheme: 'demo', authority: 'items', path: '/:id', auth: 'user',
    input: schema, output: schema, query: schema, fields,
    run() { runs += 1; return undefined },
  })
  const router = createApiRouter()
  router.register('demo', source)
  source.summary = '后来修改的说明。'
  fields.token.description = '后来修改的字段说明。'
  fields.token.required = true
  const uri = router.build(source.id, { id: '甲 乙' })
  const resolved = router.resolve('POST', uri)
  const description = describeOperation(router.operations[0].operation, 'demo')
  assert.equal(description.summary, '发现声明而不执行业务。')
  assert.deepEqual(description.fields, {
    token: { description: '可信访问令牌。', required: false, secret: true, tty: true, file: true },
  })
  assert.equal(resolved.operation.fields.token.description, '可信访问令牌。')
  assert.equal(Object.isFrozen(resolved.operation), true)
  assert.equal(Object.isFrozen(resolved.operation.fields.token), true)
  assert.equal(Object.isFrozen(description), true)
  assert.equal(Object.isFrozen(description.fields), true)
  assert.equal(Object.isFrozen(description.fields.token), true)
  assert.equal(resolved.operation.input, schema)
  assert.equal(Object.isFrozen(schema), false)
  assert.equal('run' in description, false)
  assert.equal('input' in description, false)
  assert.equal('output' in description, false)
  assert.equal('query' in description, false)
  assert.deepEqual(JSON.parse(JSON.stringify(description)), description)
  assert.equal(parses, 0)
  assert.equal(runs, 0)
})

test('直接注册路由仍拒绝非法公开描述与隐藏在字段中的值', () => {
  for (const extra of [
    { summary: { secret: '不得公开' } },
    { fields: { token: { description: 42 } } },
    { fields: { token: { required: 'true' } } },
    { fields: { token: { file: true } } },
    { fields: { token: { secret: true, value: '不得公开' } } },
    { fields: { 'bad-name': {} } },
  ]) {
    const router = createApiRouter()
    assert.throws(() => router.register('demo', defineOperation({
      id: 'demo.describe', method: 'POST', scheme: 'demo', authority: 'items', path: '', auth: 'user',
      input: z.undefined(), output: z.undefined(), run: () => undefined,
      ...extra,
    })), { code: 'invalid-argument' })
    assert.equal(router.operations.length, 0)
  }
})

test('Core 纯声明消费者发现全部路由且不物化组件、不创建数据目录', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'locus-declarations-'))
  const dataDirectory = join(root, 'unused-data')
  let runs = 0
  let parses = 0
  const schema = { parse(value) { parses += 1; return value } }
  const component = defineComponent({
    id: 'consumer', version: '1', name: '消费者', summary: '只读取声明的消费者。', kind: 'locus',
    operations: [defineOperation({
      id: 'consumer.get', summary: '读取消费者资源；无需 Body。',
      method: 'GET', scheme: 'consumer', authority: 'items', path: '/:id', auth: 'user',
      input: schema, output: schema,
      fields: { token: { description: '声明本身不包含令牌值。', required: false, secret: true, tty: true } },
      run() { runs += 1; return '不应执行' },
    })],
  })
  const core = createLocusCore({
    dataDirectory,
    components: [component],
    security: { provider: createMemoryCredentialProvider() },
  })
  t.after(async () => {
    await core.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  assert.equal(existsSync(dataDirectory), false)
  const descriptions = core.router.operations.map(({ namespace, operation }) => describeOperation(operation, namespace))
  const uri = core.router.build('consumer.get', { id: '资源' })
  assert.equal(core.router.resolve('GET', uri).operation.id, 'consumer.get')
  assert.ok(descriptions.some((item) => item.id === 'consumer.get'))
  assert.ok(descriptions.some((item) => item.id === 'locus.ws.create'))
  for (const item of descriptions.filter((item) => item.component === 'locus')) {
    assert.equal(typeof item.summary, 'string', item.id)
    assert.match(item.summary, /[\u3400-\u9fff]/, item.id)
    for (const field of Object.values(item.fields ?? {})) assert.equal(typeof field.description, 'string', item.id)
  }
  assert.equal(JSON.stringify(descriptions).includes('不应执行'), false)
  assert.equal(runs, 0)
  assert.equal(parses, 0)
  assert.equal(existsSync(dataDirectory), false)
})

test('注册期拒绝包组件 auth none，初始化例外同时绑定 Core namespace 与 operation id', () => {
  const declaration = {
    method: 'POST', scheme: 'demo', authority: 'actions', path: '/init', auth: 'none',
    input: z.undefined(), output: z.object({ initialized: z.literal(true) }),
    run: () => ({ initialized: true }),
  }
  const router = createApiRouter()
  for (const [namespace, id] of [
    ['demo', 'demo.initialize'],
    ['demo', 'locus.security.initialize'],
    ['locus', 'locus.other.initialize'],
  ]) {
    assert.throws(() => router.register(namespace, defineOperation({ ...declaration, id })), {
      code: 'invalid-argument',
    })
  }
  router.register('locus', defineOperation({ ...declaration, id: 'locus.security.initialize' }))
  assert.equal(router.resolve('POST', 'demo://actions/init').namespace, 'locus')
})

test('Core 初始化仍只接受 human Session', async (t) => {
  const { core, host } = await fixture(t)
  const session = host.createSession('agent')
  try {
    const dispatcher = createDispatcher(core.router, host, session, core.events)
    const result = await dispatcher.invoke(
      { method: 'POST', uri: 'locus://security/actions/init' },
      { password: ROOT_PASSWORD, confirmation: ROOT_PASSWORD },
    )
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'forbidden')
  } finally {
    host.endSession(session)
  }
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
    method: 'POST', uri: 'locus://ws', body: { name: 'x' }, contentType: 'text/plain',
  })
  assert.equal(media.ok, false)
  assert.equal(media.error.code, 'unsupported-media-type')
})

test('真实 operation 发现返回 summary 与 fields，并与组件视图及调用表一致', async (t) => {
  const { core, dispatcher } = await fixture(t)
  const result = await dispatcher.invoke({ method: 'GET', uri: 'locus://operations' })
  assert.equal(result.ok, true, JSON.stringify(result))
  const expected = core.router.operations.map(({ namespace, operation }) => describeOperation(operation, namespace))
  assert.deepEqual(result.data, expected)
  const discovery = core.router.resolve('GET', 'locus://operations').operation
  assert.deepEqual(discovery.output.parse(result.data), result.data)
  const tty = result.data.find((item) => item.id === 'demo.tty')
  assert.equal(tty.summary, '接收必填 value 与可选的可信 prompted 输入。')
  assert.deepEqual(tty.fields.prompted, {
    description: '可选的可信输入。', required: true, secret: true, tty: true, file: true,
  })
  const initialize = result.data.find((item) => item.id === 'locus.security.initialize')
  assert.equal(initialize.fields.password.required, true)
  assert.equal(initialize.fields.password.tty, true)
  assert.equal(initialize.fields.password.secret, true)
  assert.equal(initialize.fields.password.file, undefined)
  assert.equal(typeof initialize.fields.password.description, 'string')
  for (const id of ['locus.security.initialize', 'locus.security.reset-root', 'locus.security.change-root-password']) {
    const operation = result.data.find((item) => item.id === id)
    for (const field of Object.values(operation.fields)) {
      assert.equal(field.tty, true)
      assert.equal(field.file, undefined)
    }
  }
  for (const item of result.data) {
    for (const name of ['run', 'input', 'query', 'output']) assert.equal(name in item, false)
  }
  assert.equal(JSON.stringify(result).includes(ROOT_PASSWORD), false)

  const view = await dispatcher.invoke({ method: 'GET', uri: 'locus://components/demo' })
  assert.equal(view.ok, true, JSON.stringify(view))
  const componentOperation = core.router.resolve('GET', 'locus://components/demo').operation
  assert.deepEqual(componentOperation.output.parse(view.data), view.data)
  assert.deepEqual(view.data.operations, result.data.filter((item) => item.component === 'demo').map((item) => {
    const { component, ...metadata } = item
    assert.equal(component, 'demo')
    return metadata
  }))
})

test('Workspace 与事件 operation 的输出结构完整且可由公开 schema 解析', async (t) => {
  const { core, dispatcher } = await fixture(t)
  async function invoke(request) {
    const result = await dispatcher.invoke(request)
    assert.equal(result.ok, true, JSON.stringify(result))
    const { operation } = core.router.resolve(request.method, request.uri)
    assert.deepEqual(operation.output.parse(result.data), result.data)
    return result.data
  }
  const workspace = await invoke({
    method: 'POST', uri: 'locus://ws', body: { name: '契约 Workspace' }, contentType: 'application/json',
  })
  const uri = `locus://ws/${workspace.id}`
  await invoke({ method: 'GET', uri: 'locus://ws' })
  await invoke({ method: 'GET', uri })
  await invoke({ method: 'PATCH', uri, body: { name: '已改名' }, contentType: 'application/json' })
  const mount = await invoke({
    method: 'POST', uri: `${uri}/mounts`, body: { path: core.dataDirectory, name: 'data' }, contentType: 'application/json',
  })
  await invoke({ method: 'GET', uri: `${uri}/mounts` })
  const relation = await invoke({
    method: 'POST', uri: `${uri}/relations`,
    body: { kind: 'member', namespace: 'demo.item', id: 'one' }, contentType: 'application/json',
  })
  assert.equal(relation.source.kind, 'manual')
  assert.equal(typeof relation.source.detail, 'string')
  const explicitSource = { kind: 'discovery', detail: '测试客户端确认' }
  const explicit = await invoke({
    method: 'POST', uri: `${uri}/relations`,
    body: { kind: 'association', namespace: 'demo.item', id: 'two', source: explicitSource }, contentType: 'application/json',
  })
  assert.deepEqual(explicit.source, explicitSource)
  await invoke({ method: 'GET', uri: `${uri}/relations` })
  await invoke({ method: 'DELETE', uri: `${uri}/relations/${relation.id}` })
  await invoke({ method: 'DELETE', uri: `${uri}/mounts/${mount.id}` })
  await invoke({ method: 'GET', uri: 'locus://events?type=locus.request.succeeded&limit=10' })
  await invoke({ method: 'DELETE', uri })
})

test('Workspace 数据库损坏在调用边界归为内部故障，不伪装成参数错误', async (t) => {
  const { core, dispatcher } = await fixture(t)
  const filename = join(core.dataDirectory, 'core.sqlite')
  const damaged = Buffer.from('保留损坏库供恢复，不重建')
  writeFileSync(filename, damaged)
  const result = await dispatcher.invoke({
    method: 'POST', uri: 'locus://ws', body: { name: '有效名称' }, contentType: 'application/json',
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'internal')
  assert.deepEqual(readFileSync(filename), damaged)
})

test('Workspace 写锁故障不归为参数错误且不修改已确认对象', async (t) => {
  const { core, dispatcher } = await fixture(t)
  const workspace = core.workspaces.create('保留对象')
  const locker = new DatabaseSync(join(core.dataDirectory, 'core.sqlite'))
  try {
    locker.exec('BEGIN IMMEDIATE')
    const result = await dispatcher.invoke({
      method: 'PATCH', uri: `locus://ws/${workspace.id}`,
      body: { name: '不能提交' }, contentType: 'application/json',
    })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'internal')
    locker.exec('ROLLBACK')
  } finally {
    locker.close()
  }
  assert.deepEqual(core.workspaces.get(workspace.id), workspace)
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

  const collision = await dispatcher.invoke(
    {
      method: 'POST', uri: 'demo://items/a/actions/tty',
      body: { value: 'v', prompted: '外部值' }, contentType: 'application/json',
    },
    { prompted: '可信值' },
  )
  assert.equal(collision.ok, false)
  assert.equal(collision.error.code, 'invalid-body')

  const wrongType = await dispatcher.invoke(
    { method: 'POST', uri: 'demo://items/a/actions/tty', body: { value: 'v' }, contentType: 'application/json' },
    { prompted: 42 },
  )
  assert.equal(wrongType.ok, false)
  assert.equal(wrongType.error.code, 'invalid-argument')

  const undeclared = await dispatcher.invoke(
    { method: 'POST', uri: 'demo://items/a/actions/tty', body: { value: 'v' }, contentType: 'application/json' },
    { unknown: '可信来源也不能绕过声明' },
  )
  assert.equal(undeclared.ok, false)
  assert.equal(undeclared.error.code, 'invalid-argument')

  const missingBodyField = await dispatcher.invoke(
    { method: 'POST', uri: 'demo://items/a/actions/tty', body: {}, contentType: 'application/json' },
    { prompted: '可信值' },
  )
  assert.equal(missingBodyField.ok, false)
  assert.equal(missingBodyField.error.code, 'invalid-argument')

  const metadataIsNotValidation = await dispatcher.invoke({
    method: 'POST', uri: 'demo://items/a/actions/tty', body: { value: 'v' }, contentType: 'application/json',
  })
  assert.equal(metadataIsNotValidation.ok, true)
  assert.deepEqual(metadataIsNotValidation.data, { value: 'v' })
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
    { method: 'POST', uri: 'locus://ws' },
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

test('Root 恢复后的 handler 失败仍返回信封、记录失败事件且不泄漏原始异常', async (t) => {
  const { dispatcher, host, core } = await fixture(t)
  const failures = []
  core.events.subscribe('locus.request.failed', (event) => {
    failures.push(event)
    return undefined
  })
  const challenge = await dispatcher.invoke({ method: 'POST', uri: 'demo://actions/root-failure' })
  const result = await authorize(host, challenge)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'internal')
  assert.equal(result.requestId, challenge.requestId)
  assert.equal(JSON.stringify(result).includes(INTERNAL_FAILURE_SECRET), false)
  assert.ok(failures.some((event) => (
    event.data.requestId === result.requestId && event.data.code === 'internal'
  )))
})

test('领域 operation 自己将领域失败映射为稳定协议错误', async (t) => {
  const { dispatcher } = await fixture(t)
  const result = await dispatcher.invoke({ method: 'GET', uri: 'demo://actions/fail' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'not-found')
  assert.equal(result.error.details.domain, 'demo-missing')
})

test('Dispatcher 不解释能力包的领域错误码', async (t) => {
  const { core, dispatcher } = await fixture(t)
  const failures = []
  core.events.subscribe('locus.request.failed', event => {
    failures.push(event)
    return undefined
  })
  const result = await dispatcher.invoke({ method: 'GET', uri: 'demo://actions/unclassified' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'internal')
  assert.equal(result.error.details.domain, 'target-not-found')
  assert.equal(result.error.details.stack, undefined)
  assert.equal(result.meta.operation, 'demo.unclassified')
  assert.ok(failures.some(event => (
    event.data.requestId === result.requestId &&
    event.data.code === 'internal' &&
    event.data.operation === 'demo.unclassified' &&
    event.data.domain === 'target-not-found'
  )))
})

test('debug 开关只追加源帧，不改变分类与消息', async (t) => {
  const { core, host, session } = await fixture(t)
  const dispatcher = createDispatcher(
    core.router, host, session, core.events, core.dataDirectory,
    { get: () => undefined },
    { debug: true },
  )
  const result = await dispatcher.invoke({ method: 'GET', uri: 'demo://actions/unclassified' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'internal')
  assert.equal(result.error.message, '内部操作失败')
  const frames = result.error.details.stack
  assert.ok(Array.isArray(frames) && frames.length > 0)
  assert.equal(frames.some(line => line.includes('未经 operation 分类的领域失败')), false)

  const bare = await dispatcher.invoke({ method: 'GET', uri: 'demo://actions/bare-failure' })
  assert.equal(bare.ok, false)
  assert.equal(bare.error.code, 'internal')
  assert.equal(bare.error.message, '内部操作失败')
  assert.equal(bare.error.details.domain, undefined)
  assert.ok(Array.isArray(bare.error.details.stack) && bare.error.details.stack.length > 0)
  assert.equal(bare.error.details.stack.some(line => line.includes(INTERNAL_FAILURE_SECRET)), false)
})

test('安全错误分类覆盖不可用、认证、授权、凭据与存储故障', async (t) => {
  const { dispatcher } = await fixture(t)
  const codes = {
    'security-unavailable': 'unavailable',
    'security-uninitialized': 'unauthorized',
    'security-already-initialized': 'conflict',
    'security-disposed': 'unavailable',
    'access-denied': 'forbidden',
    'authentication-required': 'unauthorized',
    'authentication-failed': 'unauthorized',
    'authentication-cancelled': 'unauthorized',
    'authentication-unavailable': 'unavailable',
    'authentication-rate-limited': 'unavailable',
    'challenge-expired': 'unauthorized',
    'challenge-revoked': 'unauthorized',
    'grant-expired': 'unauthorized',
    'grant-consumed': 'unauthorized',
    'grant-revoked': 'unauthorized',
    'credential-missing': 'not-found',
    'credential-fields-mismatch': 'invalid-argument',
    'provider-unavailable': 'unavailable',
    'credential-too-large': 'unavailable',
    'delivery-failed': 'unavailable',
    'operation-failed': 'internal',
    io: 'internal',
  }
  for (const [code, expected] of Object.entries(codes)) {
    const result = await dispatcher.invoke({ method: 'GET', uri: `demo://actions/security/${code}` })
    assert.equal(result.ok, false, code)
    assert.equal(result.error.code, expected, code)
    assert.equal(result.error.details.security, code)
  }
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
  bus.dispose()
})

test('事件存储故障保留内存观察结果，dispose 后总线所有操作明确拒绝', () => {
  const bus = createEventBus({
    append() { throw new Error('写入故障') },
    list() { throw new Error('读取故障') },
  })
  const event = {
    specversion: '1.0', id: 'retained', type: 'demo.event', source: 'locus://demo',
    time: new Date().toISOString(), data: {},
  }
  const listener = () => undefined
  bus.subscribe(event.type, listener)
  bus.publish(event)
  assert.deepEqual(bus.list(), [event])
  bus.dispose()
  bus.dispose()
  for (const operation of [
    () => bus.publish(event),
    () => bus.list(),
    () => bus.subscribe(event.type, listener),
    () => bus.unsubscribe(event.type, listener),
  ]) {
    assert.throws(operation, { code: 'unavailable' })
  }
})
