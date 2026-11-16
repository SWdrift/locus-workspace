import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createLocusCore,
  createMemoryCredentialProvider,
  CapabilityFailure,
  createMemorySecurityStore,
  defineComponent,
  SecurityFailure,
} from '../lib/index.js'

const ROOT_PASSWORD = 'Root-仅供隔离测试-2026'
const SECRET = 'credential-test-secret-不得出现在输出'
const DATABASE = Object.freeze({ type: 'database', id: 'local' })
const OTHER_DATABASE = Object.freeze({ type: 'database', id: 'secondary' })
const ROOT_RESOURCE = Object.freeze({ type: 'service', id: 'local' })
const DATABASE_SLOT = 'database-auth'
const DATABASE_REFERENCE = 'credential:postgres-local'
const DATABASE_VALUES = Object.freeze({ username: 'app', password: SECRET })

const readCredential = (context, input) =>
  context.withCredential(DATABASE_SLOT, input.credential, (values) => values)

const registerCredential = async (context, input) => {
  await context.registerCredential(DATABASE_SLOT, input.credential, input.values)
  return { registered: true }
}

const maintain = (context, input) => `maintained:${input.mode}`

function databaseComponent() {
  return defineComponent({
    id: 'postgres',
    version: '1',
    name: 'postgres',
    summary: '隔离安全测试组件',
    kind: 'locus',
    capabilities: [
      {
        id: 'connect',
        resourceType: 'database',
        defaultAuthLevel: 'user',
        secrets: [{ slot: DATABASE_SLOT, access: 'read' }],
        run: readCredential,
      },
      {
        id: 'register',
        resourceType: 'database',
        defaultAuthLevel: 'user',
        secrets: [{ slot: DATABASE_SLOT, access: 'write' }],
        run: registerCredential,
      },
      {
        id: 'admin',
        resourceType: 'database',
        defaultAuthLevel: 'root',
        secrets: [{ slot: DATABASE_SLOT, access: 'read' }],
        run: readCredential,
      },
      { id: 'maintenance', resourceType: 'database', defaultAuthLevel: 'root', run: maintain },
      {
        id: 'fail',
        resourceType: 'database',
        defaultAuthLevel: 'user',
        run: () => { throw new CapabilityFailure('demo-failure', '组件显式失败') },
      },
    ],
    credentials: [
      {
        id: DATABASE_SLOT,
        fields: [
          { name: 'username', secret: false, required: true },
          { name: 'password', secret: true, required: true },
          { name: 'remark', secret: false, required: false },
        ],
      },
    ],
  })
}

function emptyComponent() {
  return defineComponent({
    id: 'empty',
    version: '1',
    name: 'empty',
    summary: '没有能力的组件',
    kind: 'locus',
  })
}

function secondaryComponent() {
  return defineComponent({
    id: 'secondary',
    version: '1',
    name: 'secondary',
    summary: '跨组件引用隔离测试',
    kind: 'locus',
    capabilities: [
      {
        id: 'register',
        resourceType: 'thing',
        defaultAuthLevel: 'root',
        secrets: [{ slot: 'secondary-auth', access: 'write' }],
        run: async (context, input) => {
          await context.registerCredential('secondary-auth', input.credential, { value: input.value })
          return { registered: true }
        },
      },
      {
        id: 'read',
        resourceType: 'thing',
        defaultAuthLevel: 'user',
        secrets: [{ slot: 'secondary-auth', access: 'read' }],
        run: (context, input) => context.withCredential('secondary-auth', input.credential, (values) => values.value),
      },
    ],
    credentials: [
      {
        id: 'secondary-auth',
        fields: [{ name: 'value', secret: true, required: true }],
      },
    ],
  })
}

function connectRequest(overrides = {}) {
  return { capability: 'connect', resource: DATABASE, parameters: null, ...overrides }
}

function registerRequest(reference = DATABASE_REFERENCE, resource = DATABASE) {
  return { capability: 'register', resource, parameters: { reference } }
}

function adminRequest(overrides = {}) {
  return { capability: 'admin', resource: DATABASE, parameters: null, ...overrides }
}

function maintenanceRequest(parameters = { mode: 'restart' }) {
  return { capability: 'maintenance', resource: DATABASE, parameters }
}

function rootRequest(parameters = { service: 'example' }) {
  return { capability: 'system:service:manage', resource: ROOT_RESOURCE, parameters }
}

function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'locus-security-'))
  const defined = options.components ?? [databaseComponent()]
  const definitions = defined.map((entry) => entry.component)
  const store = options.store ?? createMemorySecurityStore()
  const provider = options.provider ?? createMemoryCredentialProvider()
  const profile = options.profile ?? 'default'
  let host
  const dataDirectory = join(root, 'data')
  const core = createLocusCore({
    dataDirectory,
    components: definitions,
    security: {
      store,
      provider,
      profile,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      receiveHost(value) { host = value },
    },
  })
  t.after(async () => {
    await core.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  return {
    core,
    host,
    store,
    provider,
    definitions,
    defined,
    definition: definitions[0],
    profile,
    dataDirectory,
    async initialize() {
      await host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD)
    },
    key(reference = DATABASE_REFERENCE) {
      const installation = store.transaction((transaction) => transaction.getInstallation())
      return {
        service: `locus:${installation.installationId}:${profile}`,
        account: reference.slice('credential:'.length),
      }
    },
  }
}

function failure(code, reason) {
  return (error) => {
    assert.equal(error instanceof SecurityFailure, true)
    assert.equal(error.code, code)
    if (reason !== undefined) assert.equal(error.reason, reason)
    return true
  }
}

async function challenge(action) {
  let result
  await assert.rejects(action, (error) => {
    failure('authentication-required')(error)
    assert.ok(error.challenge)
    result = error.challenge
    return true
  })
  return result
}

async function privileged(setup, action, password = ROOT_PASSWORD) {
  const pending = await challenge(action)
  const grant = await setup.host.authenticate(pending, password)
  return setup.host.resume(grant)
}

function databasePort(setup, source = 'human') {
  const session = setup.host.createSession(source)
  const port = setup.host.bindComponent(session, setup.definition)
  return { session, port, management: setup.host.forSession(session) }
}

async function registerWith(setup, options = {}) {
  const reference = options.reference ?? DATABASE_REFERENCE
  const values = options.values ?? DATABASE_VALUES
  const resource = options.resource ?? DATABASE
  const owned = options.session === undefined
  const session = options.session ?? setup.host.createSession('component')
  try {
    const port = setup.host.bindComponent(session, setup.definition)
    return await port.execute(
      registerRequest(reference, resource),
      (context) => setup.defined[0].api.register(context, { credential: reference, values }),
    )
  } finally {
    if (owned) setup.host.endSession(session)
  }
}

async function readWith(setup, options = {}) {
  const reference = options.reference ?? DATABASE_REFERENCE
  const resource = options.resource ?? DATABASE
  const owned = options.session === undefined
  const session = options.session ?? setup.host.createSession('component')
  try {
    const port = setup.host.bindComponent(session, setup.definition)
    return await port.execute(
      connectRequest({ resource }),
      (context) => setup.defined[0].api.connect(context, { credential: reference }),
    )
  } finally {
    if (owned) setup.host.endSession(session)
  }
}

test('默认安全装配使用惰性 SQLite，空目录状态读取不建库且 Provider 显式注入', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'locus-security-unconfigured-'))
  let host
  const core = createLocusCore({ dataDirectory: join(root, 'data'), security: {
    provider: createMemoryCredentialProvider(), receiveHost(value) { host = value },
  } })
  t.after(async () => { await core.dispose(); rmSync(root, { recursive: true, force: true }) })
  const security = core.security
  assert.equal(existsSync(core.dataDirectory), false)
  const status = await security.status()
  assert.equal(status.initialized, false)
  assert.equal(status.installationId, undefined)
  assert.deepEqual(status.identities, [{ id: 'root', level: 'root' }, { id: 'user', level: 'user' }])
  assert.equal(host.createSession('human').userId, 'user')
  assert.equal(existsSync(core.dataDirectory), false)
  assert.equal(core.workspaces.list().length, 0)
})

test('Root 使用真实随机 scrypt 验证值，初始化不覆盖已有身份且未初始化时拒绝执行', async (t) => {
  const setup = fixture(t)
  assert.equal(existsSync(setup.dataDirectory), false)
  assert.equal((await setup.core.security.status()).initialized, false)
  const { session, port } = databasePort(setup)
  await assert.rejects(
    () => port.execute(maintenanceRequest(), () => assert.fail()),
    failure('security-uninitialized'),
  )
  await assert.rejects(() => setup.host.initializeRoot(ROOT_PASSWORD, '不相同'), failure('authentication-failed'))
  await setup.initialize()
  const state = setup.store.transaction((transaction) => transaction.getRoot())
  assert.equal(state.verifier.algorithm, 'scrypt')
  assert.equal(state.verifier.N, 32768)
  assert.equal(state.verifier.r, 8)
  assert.equal(state.verifier.p, 1)
  assert.equal(state.verifier.maxmem, 64 * 1024 * 1024)
  assert.match(state.verifier.salt, /^[a-f0-9]{32}$/)
  assert.match(state.verifier.derivedKey, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(state).includes(ROOT_PASSWORD), false)
  await assert.rejects(() => setup.host.initializeRoot('不能覆盖', '不能覆盖'), failure('security-already-initialized'))
  assert.deepEqual(setup.store.transaction((transaction) => transaction.getRoot()), state)
  const status = await setup.core.security.status()
  assert.deepEqual(status.identities, [{ id: 'root', level: 'root' }, { id: 'user', level: 'user' }])
  assert.match(status.installationId, /^[0-9a-f-]{36}$/)
  assert.equal(session.userId, 'user')
  assert.equal(session.active, true)
  assert.equal('initializeRoot' in setup.core.security, false)
  assert.equal('authenticate' in setup.core.security, false)
})

test('Human、Agent 与 component 来源共用 User；用户级能力登记与读取不需要 Root', async (t) => {
  const setup = fixture(t)
  await setup.initialize()
  for (const source of ['human', 'agent', 'component']) {
    const current = databasePort(setup, source)
    assert.equal(current.session.userId, 'user')
    assert.equal(current.session.source, source)
    await registerWith(setup, { session: current.session })
    assert.deepEqual(await readWith(setup, { session: current.session }), {
      username: 'app',
      password: SECRET,
    })
  }
  const { management } = databasePort(setup)
  const metadata = (await management.listCredentials())[0]
  assert.deepEqual(metadata.fields, { username: 'app' })
  assert.equal('kind' in metadata, false)
  assert.equal('secret' in metadata, false)
  const raw = await setup.provider.get(setup.key())
  assert.deepEqual(JSON.parse(raw), { password: SECRET })
  assert.equal(raw.includes('username'), false)
  assert.throws(() => setup.host.createSession('root'), failure('access-denied', 'invalid-request'))
})

test('同名伪组件、动态组件与自造 Session 不能取得绑定身份', async (t) => {
  const setup = fixture(t)
  await setup.initialize()
  const session = setup.host.createSession('agent')
  const port = setup.host.bindComponent(session, setup.definition)
  assert.deepEqual(Object.keys(port), ['execute'])
  assert.equal('authorize' in port, false)
  assert.equal('withCredential' in port, false)
  assert.equal('bindComponent' in port, false)
  assert.throws(
    () => setup.host.bindComponent(session, databaseComponent().component),
    failure('access-denied', 'untrusted-component'),
  )
  assert.throws(
    () => setup.host.bindComponent({ ...session, userId: 'root' }, setup.definition),
    failure('access-denied', 'invalid-session'),
  )
  const dynamic = defineComponent({
    id: 'postgres',
    version: '1',
    name: '动态冒充',
    summary: '不可授权',
    kind: 'external',
    probe: { argv: ['postgres', '--version'] },
  })
  assert.throws(
    () => setup.host.bindComponent(session, dynamic.component),
    failure('access-denied', 'untrusted-component'),
  )
})

test('能力拒绝区分未声明、资源不匹配与宿主固定规则', async (t) => {
  const setup = fixture(t, { components: [databaseComponent(), emptyComponent()] })
  await setup.initialize()
  const session = setup.host.createSession('human')
  const port = setup.host.bindComponent(session, setup.definitions[0])
  const management = setup.host.forSession(session)
  await assert.rejects(
    () => port.execute({ capability: 'missing', resource: DATABASE, parameters: null }, () => assert.fail()),
    failure('access-denied', 'undeclared-capability'),
  )
  await assert.rejects(
    () => port.execute({ capability: 'maintenance', resource: ROOT_RESOURCE, parameters: null }, () => assert.fail()),
    failure('access-denied', 'resource-mismatch'),
  )
  await assert.rejects(
    () => management.execute({ capability: 'unknown:capability', resource: ROOT_RESOURCE, parameters: null }, () => assert.fail()),
    failure('access-denied', 'unsupported-capability'),
  )
  await assert.rejects(
    () => management.execute({ capability: 'system:service:manage', resource: DATABASE, parameters: null }, () => assert.fail()),
    failure('access-denied', 'resource-mismatch'),
  )
  const emptyPort = setup.host.bindComponent(session, setup.definitions[1])
  await assert.rejects(
    () => emptyPort.execute(connectRequest(), () => assert.fail()),
    failure('access-denied', 'undeclared-capability'),
  )
})

test('缺失 read 绑定不触发 Root 认证，也不调用 Provider', async (t) => {
  const memory = createMemoryCredentialProvider()
  let reads = 0
  const provider = {
    ...memory,
    async get(key) { reads++; return memory.get(key) },
  }
  const setup = fixture(t, { provider })
  await setup.initialize()
  const { port, management } = databasePort(setup)
  await privileged(setup, () => management.setCapabilityLevel({
    componentId: 'postgres', capability: 'connect', level: 'root',
  }))
  await assert.rejects(
    () => port.execute(connectRequest(), () => assert.fail()),
    failure('access-denied', 'credential-binding-mismatch'),
  )
  assert.equal(reads, 0)
  await registerWith(setup, { resource: OTHER_DATABASE })
  reads = 0
  const pending = await challenge(() => port.execute(
    connectRequest({ resource: OTHER_DATABASE }),
    (context) => setup.defined[0].api.connect(context, { credential: DATABASE_REFERENCE }),
  ))
  const grant = await setup.host.authenticate(pending, ROOT_PASSWORD)
  assert.deepEqual(await setup.host.resume(grant), { username: 'app', password: SECRET })
  assert.equal(reads, 1)
})

test('Root 能力创建一次 Challenge，resume 后 execute 内交付凭据不再认证', async (t) => {
  const memory = createMemoryCredentialProvider()
  let reads = 0
  const provider = {
    ...memory,
    async get(key) { reads++; return memory.get(key) },
  }
  const setup = fixture(t, { provider })
  await setup.initialize()
  await registerWith(setup)
  const { session, port } = databasePort(setup)
  reads = 0
  const pending = await challenge(() => port.execute(
    adminRequest(),
    (context) => setup.defined[0].api.admin(context, { credential: DATABASE_REFERENCE }),
  ))
  assert.deepEqual(Object.keys(pending).sort(), [
    'capability', 'challengeId', 'componentId', 'expiresAt',
    'operationId', 'resource', 'sessionId', 'subject',
  ])
  assert.equal(pending.capability, 'admin')
  assert.equal(pending.componentId, 'postgres')
  assert.equal(pending.sessionId, session.sessionId)
  assert.equal(pending.subject, 'user')
  assert.deepEqual(pending.resource, DATABASE)
  assert.equal('parameters' in pending, false)
  assert.equal('action' in pending, false)
  assert.equal('operation' in pending, false)
  assert.equal(JSON.stringify(pending).includes(SECRET), false)
  await assert.rejects(() => setup.host.authenticate(pending, '错误密码'), failure('authentication-failed'))
  const grant = await setup.host.authenticate(pending, ROOT_PASSWORD)
  assert.deepEqual(Object.keys(grant).sort(), [
    'authorizedBy', 'capability', 'componentId', 'expiresAt',
    'grantId', 'operationId', 'resource', 'scope', 'sessionId', 'subject',
  ])
  assert.equal(grant.subject, 'user')
  assert.equal(grant.authorizedBy, 'root')
  assert.equal(grant.scope, 'operation')
  assert.equal(typeof grant.expiresAt, 'number')
  assert.equal(reads, 0)
  assert.deepEqual(await setup.host.resume(grant), { username: 'app', password: SECRET })
  assert.equal(reads, 1)
  await assert.rejects(() => setup.host.resume(grant), failure('grant-consumed'))
  await challenge(() => port.execute(adminRequest(), () => assert.fail()))
})

test('Session Grant 在同一 Session 内复用，结束或 Root 重置后失效', async (t) => {
  const setup = fixture(t)
  await setup.initialize()
  await registerWith(setup)
  const { session, port } = databasePort(setup)
  const pending = await challenge(() => port.execute(
    adminRequest(),
    (context) => setup.defined[0].api.admin(context, { credential: DATABASE_REFERENCE }),
  ))
  const grant = await setup.host.authenticate(pending, ROOT_PASSWORD, 'session')
  assert.equal(grant.scope, 'session')
  assert.equal(grant.expiresAt, null)
  assert.deepEqual(await setup.host.resume(grant), { username: 'app', password: SECRET })
  await assert.rejects(() => setup.host.resume(grant), failure('grant-consumed'))

  // 同一 Session、同组件/能力/精确资源：不再 Challenge。
  assert.deepEqual(
    await port.execute(adminRequest(), (context) => setup.defined[0].api.admin(context, { credential: DATABASE_REFERENCE })),
    { username: 'app', password: SECRET },
  )

  // 不同资源仍需新的授权；这里只创建挑战，随后结束会话撤销。
  await registerWith(setup, { resource: OTHER_DATABASE })
  await challenge(() => port.execute(
    adminRequest({ resource: OTHER_DATABASE }),
    () => assert.fail(),
  ))

  setup.host.endSession(session)
  await assert.rejects(() => setup.host.resume(grant), failure('grant-revoked'))
  const next = databasePort(setup)
  const nextPending = await challenge(() => next.port.execute(
    adminRequest(),
    (context) => setup.defined[0].api.admin(context, { credential: DATABASE_REFERENCE }),
  ))
  const nextGrant = await setup.host.authenticate(nextPending, ROOT_PASSWORD, 'session')
  assert.deepEqual(await setup.host.resume(nextGrant), { username: 'app', password: SECRET })
  await setup.host.resetRoot('重置后的隔离测试密码', '重置后的隔离测试密码')
  await challenge(() => next.port.execute(adminRequest(), () => assert.fail()))
  await assert.rejects(() => setup.host.resume(nextGrant), failure('grant-revoked'))
})

test('user 级写能力不能覆盖其他组件的 CredentialRef', async (t) => {
  const setup = fixture(t, { components: [databaseComponent(), secondaryComponent()] })
  await setup.initialize()
  const session = setup.host.createSession('agent')
  const secondaryPort = setup.host.bindComponent(session, setup.defined[1].component)
  const secondaryResource = { type: 'thing', id: 'secondary' }
  let challenge
  try {
    await secondaryPort.execute(
      { capability: 'register', resource: secondaryResource, parameters: null },
      (context) => setup.defined[1].api.register(context, {
        credential: 'credential:secondary-auth',
        value: 'original-secondary',
      }),
    )
  } catch (error) {
    assert.equal(error.code, 'authentication-required')
    challenge = error.challenge
  }
  assert.ok(challenge)
  await setup.host.resume(await setup.host.authenticate(challenge, ROOT_PASSWORD))

  const databasePort = setup.host.bindComponent(session, setup.defined[0].component)
  await assert.rejects(
    () => databasePort.execute(registerRequest('credential:secondary-auth', DATABASE), (context) => (
      setup.defined[0].api.register(context, {
        credential: 'credential:secondary-auth',
        values: { username: 'attacker', password: 'attacker-secret' },
      })
    )),
    failure('access-denied', 'credential-reference-owned'),
  )
  const value = await secondaryPort.execute(
    { capability: 'read', resource: secondaryResource, parameters: null },
    (context) => setup.defined[1].api.read(context, { credential: 'credential:secondary-auth' }),
  )
  assert.equal(value, 'original-secondary')

  // 删除所有绑定后 owner 仍保留；不能靠解绑把引用“变成无主”。
  const management = setup.host.forSession(session)
  for (const capability of ['register', 'read']) {
    await privileged(setup, () => management.unbindCredential({
      componentId: 'secondary',
      capability,
      resource: secondaryResource,
      slot: 'secondary-auth',
    }))
  }
  await assert.rejects(
    () => databasePort.execute(registerRequest('credential:secondary-auth', DATABASE), (context) => (
      setup.defined[0].api.register(context, {
        credential: 'credential:secondary-auth',
        values: { username: 'attacker', password: 'attacker-secret' },
      })
    )),
    failure('access-denied', 'credential-reference-owned'),
  )
  const metadata = (await management.listCredentials()).find((item) => item.reference === 'credential:secondary-auth')
  assert.equal(metadata?.owner, 'secondary')
})

test('公开字段进入元数据，秘密字段只进入 Provider，并在交付时合并', async (t) => {
  const setup = fixture(t)
  await setup.initialize()
  await registerWith(setup, { values: { username: 'app', password: SECRET, remark: '' } })
  const { management } = databasePort(setup)
  const metadata = (await management.listCredentials())[0]
  assert.deepEqual(metadata.fields, { username: 'app' })
  assert.equal('kind' in metadata, false)
  const raw = await setup.provider.get(setup.key())
  assert.deepEqual(JSON.parse(raw), { password: SECRET })
  assert.deepEqual(await readWith(setup), { username: 'app', password: SECRET })

  const createdAt = metadata.createdAt
  await registerWith(setup, { values: { username: 'next', password: '替换后的秘密' } })
  const updated = (await management.listCredentials())[0]
  assert.equal(updated.createdAt, createdAt)
  assert.equal(updated.updatedAt >= updated.createdAt, true)
  assert.deepEqual(updated.fields, { username: 'next' })
  assert.deepEqual(await readWith(setup), { username: 'next', password: '替换后的秘密' })
})

test('字段结构严格校验，未知字段、缺失必填与错误槽访问均被拒绝', async (t) => {
  const setup = fixture(t)
  await setup.initialize()
  await registerWith(setup)
  const { port, management } = databasePort(setup)
  const before = (await management.listCredentials())[0]

  for (const values of [
    { username: 'app', password: SECRET, extra: 'x' },
    { username: 'app' },
    { username: 'app', password: '' },
    { username: 'app', password: SECRET, remark: 1 },
  ]) {
    await assert.rejects(
      () => registerWith(setup, { values }),
      failure('access-denied', 'invalid-request'),
    )
  }

  await assert.rejects(
    () => port.execute(
      connectRequest(),
      (context) => setup.defined[0].api.register(context, {
        credential: DATABASE_REFERENCE,
        values: { username: 'app', password: '不允许替换' },
      }),
    ),
    failure('access-denied', 'credential-declaration-mismatch'),
  )
  await assert.rejects(
    () => port.execute(
      registerRequest(),
      (context) => setup.defined[0].api.connect(context, { credential: DATABASE_REFERENCE }),
    ),
    failure('access-denied', 'credential-declaration-mismatch'),
  )
  assert.deepEqual((await management.listCredentials())[0], before)
})

test('Root 认证只在可信 Host 入口，公开面与组件端口不能自报通过', async (t) => {
  const setup = fixture(t)
  await setup.initialize()
  const { session, port } = databasePort(setup)
  const management = setup.host.forSession(session)
  assert.equal('authenticate' in setup.core.security, false)
  assert.equal('initializeRoot' in setup.core.security, false)
  assert.equal('authenticate' in management, false)
  assert.equal('resume' in management, false)
  assert.equal('authenticate' in port, false)
  assert.equal('forSession' in port, false)
  let calls = 0
  const pending = await challenge(() => management.execute(rootRequest(), () => ++calls))
  await assert.rejects(
    () => setup.host.authenticate({ ...pending, authenticated: true }, ROOT_PASSWORD),
    failure('access-denied', 'invalid-challenge'),
  )
  await assert.rejects(
    () => setup.host.authenticate(pending, { authenticated: true }),
    failure('authentication-failed'),
  )
  await assert.rejects(() => setup.host.authenticate(pending, '错误密码'), failure('authentication-failed'))
  assert.equal(calls, 0)
  const grant = await setup.host.authenticate(pending, ROOT_PASSWORD)
  assert.equal(session.userId, 'user')
  assert.equal(await setup.host.resume(grant), 1)
  assert.equal(calls, 1)
})

test('Root 恢复只运行原 callback，冻结请求不能被调用方修改', async (t) => {
  const setup = fixture(t)
  await setup.initialize()
  await registerWith(setup)
  const { port } = databasePort(setup)
  const parameters = { mode: 'original', options: { restart: true } }
  let captured
  const pending = await challenge(() => port.execute(
    maintenanceRequest(parameters),
    (context, snapshot) => {
      captured = snapshot
      return snapshot.parameters.mode
    },
  ))
  parameters.mode = 'mutated'
  parameters.options.restart = false
  const serialized = JSON.stringify(pending)
  assert.equal(serialized.includes('parameters'), false)
  assert.equal(serialized.includes('mutated'), false)
  const grant = await setup.host.authenticate(pending, ROOT_PASSWORD)
  assert.equal(JSON.stringify(grant).includes('parameters'), false)
  assert.equal(await setup.host.resume(grant), 'original')
  assert.equal(captured.parameters.mode, 'original')
  assert.equal(captured.parameters.options.restart, true)
  assert.equal(Object.isFrozen(captured), true)
  assert.equal(Object.isFrozen(captured.resource), true)
  assert.equal(Object.isFrozen(captured.parameters), true)
  assert.equal(Object.isFrozen(captured.parameters.options), true)

  const request = {
    capability: 'connect',
    resource: DATABASE,
    parameters: { note: { value: 'original' } },
  }
  let userSnapshot
  const execution = port.execute(request, (context, snapshot) => {
    userSnapshot = snapshot
    return setup.defined[0].api.connect(context, { credential: DATABASE_REFERENCE })
  })
  request.parameters.note.value = 'changed'
  request.capability = 'admin'
  assert.deepEqual(await execution, { username: 'app', password: SECRET })
  assert.equal(userSnapshot.capability, 'connect')
  assert.equal(userSnapshot.parameters.note.value, 'original')
})

test('单次 Grant 并发只能消费一次，操作失败也不返还消费次数', async (t) => {
  const setup = fixture(t)
  await setup.initialize()
  const { port } = databasePort(setup)
  let calls = 0
  const pending = await challenge(() => port.execute(maintenanceRequest(), async () => {
    calls++
    await Promise.resolve()
    return '已执行'
  }))
  const grant = await setup.host.authenticate(pending, ROOT_PASSWORD)
  await assert.rejects(() => setup.host.resume({ ...grant }), failure('access-denied', 'invalid-grant'))
  const settled = await Promise.allSettled([setup.host.resume(grant), setup.host.resume(grant)])
  assert.equal(settled.filter((result) => result.status === 'fulfilled').length, 1)
  failure('grant-consumed')(settled.find((result) => result.status === 'rejected').reason)
  assert.equal(calls, 1)

  const failed = await challenge(() => port.execute(
    maintenanceRequest({ mode: 'second' }),
    () => { throw new Error('业务失败') },
  ))
  const failedGrant = await setup.host.authenticate(failed, ROOT_PASSWORD)
  await assert.rejects(() => setup.host.resume(failedGrant), failure('operation-failed'))
  await assert.rejects(() => setup.host.resume(failedGrant), failure('grant-consumed'))
})

test('Challenge 五分钟与 Grant 六十秒按注入时钟在边界失效', async (t) => {
  let now = 1_000_000
  const setup = fixture(t, { clock: () => now })
  await setup.initialize()
  const { port } = databasePort(setup)
  const expired = await challenge(() => port.execute(maintenanceRequest(), () => assert.fail()))
  assert.equal(expired.expiresAt, now + 300_000)
  now += 300_000
  await assert.rejects(() => setup.host.authenticate(expired, ROOT_PASSWORD), failure('challenge-expired'))
  const pending = await challenge(() => port.execute(maintenanceRequest(), () => '可执行'))
  now += 299_999
  const grant = await setup.host.authenticate(pending, ROOT_PASSWORD)
  assert.equal(grant.expiresAt, now + 60_000)
  now += 60_000
  await assert.rejects(() => setup.host.resume(grant), failure('grant-expired'))
})

test('取消、Session 结束、Host 退出与 dispose 都使未消费操作失效', async (t) => {
  const setup = fixture(t)
  await setup.initialize()
  const { session, port, management } = databasePort(setup)
  const cancelled = await challenge(() => management.execute(rootRequest(), () => assert.fail()))
  setup.host.cancelChallenge(cancelled)
  await assert.rejects(() => setup.host.authenticate(cancelled, ROOT_PASSWORD), failure('authentication-cancelled'))
  assert.equal(setup.store.transaction((transaction) => transaction.getRoot().failedAttempts), 0)

  const ended = await challenge(() => management.execute(rootRequest(), () => assert.fail()))
  const endedGrant = await setup.host.authenticate(ended, ROOT_PASSWORD)
  setup.host.endSession(session)
  assert.equal(session.active, false)
  assert.equal(typeof session.endedAt, 'number')
  await assert.rejects(() => setup.host.resume(endedGrant), failure('grant-revoked'))
  await assert.rejects(
    () => port.execute(connectRequest(), () => assert.fail()),
    failure('access-denied', 'session-ended'),
  )

  const second = databasePort(setup)
  const closing = await challenge(() => second.management.execute(rootRequest(), () => assert.fail()))
  const closingGrant = await setup.host.authenticate(closing, ROOT_PASSWORD)
  setup.host.close()
  await assert.rejects(() => setup.host.resume(closingGrant), failure('authentication-unavailable'))
  assert.throws(() => setup.host.createSession('human'), failure('authentication-unavailable'))

  const capturedSecurity = setup.core.security
  const disposedPort = second.port
  await setup.core.dispose()
  await assert.rejects(() => capturedSecurity.status(), failure('security-disposed'))
  await assert.rejects(
    () => disposedPort.execute(maintenanceRequest(), () => assert.fail()),
    failure('security-disposed'),
  )
})

test('五次错误锁定六十秒，锁定不运行 KDF，成功清零并可继续认证', async (t) => {
  let now = 5000
  const setup = fixture(t, { clock: () => now })
  await setup.initialize()
  const { management } = databasePort(setup)
  const pending = await challenge(() => management.execute(rootRequest(), () => undefined))
  for (let attempt = 0; attempt < 5; attempt++) {
    await assert.rejects(() => setup.host.authenticate(pending, '错误密码'), failure('authentication-failed'))
  }
  const locked = setup.store.transaction((transaction) => transaction.getRoot())
  assert.equal(locked.failedAttempts, 5)
  assert.equal(locked.lockedUntil, now + 60_000)
  // 损坏验证格式也仍先命中限流，证明锁定入口没有运行验证器。
  setup.store.transaction((transaction) => transaction.setRoot({
    ...locked,
    verifier: { ...locked.verifier, N: 1 },
  }))
  await assert.rejects(() => setup.host.authenticate(pending, ROOT_PASSWORD), failure('authentication-rate-limited'))
  setup.store.transaction((transaction) => transaction.setRoot(locked))
  now += 60_000
  const grant = await setup.host.authenticate(pending, ROOT_PASSWORD)
  await setup.host.resume(grant)
  assert.equal(setup.store.transaction((transaction) => transaction.getRoot().failedAttempts), 0)
})

test('认证租约拒绝并发 KDF，取消正在验证的挑战不计密码错误', async (t) => {
  const setup = fixture(t)
  await setup.initialize()
  const { management } = databasePort(setup)
  const first = await challenge(() => management.execute(rootRequest(), () => assert.fail()))
  const second = await challenge(() => management.execute(rootRequest(), () => undefined))
  const authenticating = setup.host.authenticate(first, ROOT_PASSWORD)
  await assert.rejects(() => setup.host.authenticate(second, ROOT_PASSWORD), failure('authentication-unavailable'))
  setup.host.cancelChallenge(first)
  await assert.rejects(() => authenticating, failure('authentication-cancelled'))
  const state = setup.store.transaction((transaction) => transaction.getRoot())
  assert.equal(state.failedAttempts, 0)
  assert.equal(state.attempt, undefined)
  const grant = await setup.host.authenticate(second, ROOT_PASSWORD)
  await setup.host.resume(grant)
})

test('Root 覆盖等级改变默认授权，clear 后恢复组件声明', async (t) => {
  const setup = fixture(t)
  await setup.initialize()
  await registerWith(setup)
  const { port, management } = databasePort(setup)
  const authority = (capabilityId) => management.listCapabilityAuthorities().then((values) => values.find((value) => (
    value.componentId === 'postgres' && value.capability === capabilityId
  )))

  assert.deepEqual(await authority('connect'), {
    componentId: 'postgres',
    capability: 'connect',
    defaultAuthLevel: 'user',
    effectiveAuthLevel: 'user',
    source: 'component',
  })
  assert.deepEqual(await authority('admin'), {
    componentId: 'postgres',
    capability: 'admin',
    defaultAuthLevel: 'root',
    effectiveAuthLevel: 'root',
    source: 'component',
  })

  const overridden = await privileged(setup, () => management.setCapabilityLevel({
    componentId: 'postgres', capability: 'connect', level: 'root',
  }))
  assert.deepEqual(overridden, {
    componentId: 'postgres',
    capability: 'connect',
    defaultAuthLevel: 'user',
    effectiveAuthLevel: 'root',
    source: 'override',
  })
  assert.deepEqual(
    await privileged(setup, () => port.execute(
      connectRequest(),
      (context) => setup.defined[0].api.connect(context, { credential: DATABASE_REFERENCE }),
    )),
    { username: 'app', password: SECRET },
  )

  const cleared = await privileged(setup, () => management.clearCapabilityLevel({
    componentId: 'postgres', capability: 'connect',
  }))
  assert.equal(cleared.source, 'component')
  assert.equal(cleared.effectiveAuthLevel, 'user')
  assert.deepEqual(
    await port.execute(
      connectRequest(),
      (context) => setup.defined[0].api.connect(context, { credential: DATABASE_REFERENCE }),
    ),
    { username: 'app', password: SECRET },
  )

  await privileged(setup, () => management.setCapabilityLevel({
    componentId: 'postgres', capability: 'admin', level: 'user',
  }))
  assert.deepEqual(
    await port.execute(
      adminRequest(),
      (context) => setup.defined[0].api.admin(context, { credential: DATABASE_REFERENCE }),
    ),
    { username: 'app', password: SECRET },
  )
  await privileged(setup, () => management.clearCapabilityLevel({
    componentId: 'postgres', capability: 'admin',
  }))
  await challenge(() => port.execute(adminRequest(), () => assert.fail()))

  await assert.rejects(
    () => management.setCapabilityLevel({ componentId: 'missing', capability: 'connect', level: 'root' }),
    failure('access-denied', 'unsupported-capability'),
  )
  await assert.rejects(
    () => management.setCapabilityLevel({ componentId: 'postgres', capability: 'connect', level: 'admin' }),
    failure('access-denied', 'invalid-request'),
  )
})

test('Root 重置替换验证材料与世代，撤销旧授权但不删除凭据', async (t) => {
  const setup = fixture(t)
  await setup.initialize()
  await registerWith(setup)
  const { port, management } = databasePort(setup)
  const pending = await challenge(() => management.execute(rootRequest(), () => assert.fail()))
  const unverified = await challenge(() => management.execute(rootRequest(), () => assert.fail()))
  const grant = await setup.host.authenticate(pending, ROOT_PASSWORD)
  const before = setup.store.transaction((transaction) => transaction.getRoot())
  const replacement = '重置后的新 Root 密码'
  await setup.host.resetRoot(replacement, replacement)
  const after = setup.store.transaction((transaction) => transaction.getRoot())
  assert.equal(after.generation, before.generation + 1)
  assert.notEqual(after.verifier.salt, before.verifier.salt)
  assert.equal(after.failedAttempts, 0)
  await assert.rejects(() => setup.host.resume(grant), failure('grant-revoked'))
  await assert.rejects(() => setup.host.authenticate(unverified, ROOT_PASSWORD), failure('challenge-revoked'))
  assert.deepEqual(await readWith(setup), { username: 'app', password: SECRET })
  assert.equal((await management.listCredentials()).length, 1)
  const next = await challenge(() => management.execute(rootRequest(), () => '已使用新密码'))
  await assert.rejects(() => setup.host.authenticate(next, ROOT_PASSWORD), failure('authentication-failed'))
  assert.equal(await setup.host.resume(await setup.host.authenticate(next, replacement)), '已使用新密码')
})

test('每个 Root 操作都需要新的 Challenge，Grant 只消费一次', async (t) => {
  const setup = fixture(t)
  await setup.initialize()
  await registerWith(setup)
  const { port } = databasePort(setup)
  const first = await challenge(() => port.execute(adminRequest(), () => 'first'))
  const firstGrant = await setup.host.authenticate(first, ROOT_PASSWORD)
  assert.equal(await setup.host.resume(firstGrant), 'first')
  await challenge(() => port.execute(adminRequest(), () => assert.fail()))
  await challenge(() => port.execute(maintenanceRequest(), () => assert.fail()))
})

test('消费 Grant 时重新检查存储世代，外部重置不能被进程内缓存绕过', async (t) => {
  const setup = fixture(t)
  await setup.initialize()
  const { port } = databasePort(setup)
  const pending = await challenge(() => port.execute(maintenanceRequest(), () => assert.fail()))
  const grant = await setup.host.authenticate(pending, ROOT_PASSWORD)
  setup.store.transaction((transaction) => {
    const root = transaction.getRoot()
    transaction.setRoot({ ...root, generation: root.generation + 1 })
  })
  await assert.rejects(() => setup.host.resume(grant), failure('grant-revoked'))
})

test('Root 密码变更本身需要 Root 授权，新密码不进入 Challenge', async (t) => {
  const setup = fixture(t)
  await setup.initialize()
  const { management } = databasePort(setup)
  const password = '经过 Root step-up 后的新密码'
  await assert.rejects(() => management.changeRootPassword(password, '不相同'), failure('authentication-failed'))
  const pending = await challenge(() => management.changeRootPassword(password, password))
  assert.equal(pending.capability, 'root:password:manage')
  assert.deepEqual(pending.resource, { type: 'security', id: 'root' })
  assert.equal(JSON.stringify(pending).includes(password), false)
  const grant = await setup.host.authenticate(pending, ROOT_PASSWORD)
  await setup.host.resume(grant)
  const next = await challenge(() => management.execute(rootRequest(), () => '密码已改变'))
  await assert.rejects(() => setup.host.authenticate(next, ROOT_PASSWORD), failure('authentication-failed'))
  assert.equal(await setup.host.resume(await setup.host.authenticate(next, password)), '密码已改变')
})

test('异步 scrypt 初始化与重置在提交时检查世代，不覆盖并发结果', async (t) => {
  const setup = fixture(t)
  const results = await Promise.allSettled([
    setup.host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD),
    setup.host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  failure('security-already-initialized')(results.find((result) => result.status === 'rejected').reason)
  const before = setup.store.transaction((transaction) => transaction.getRoot())
  const reset = setup.host.resetRoot('不能覆盖并发世代', '不能覆盖并发世代')
  setup.store.transaction((transaction) => {
    transaction.setRoot({ ...before, generation: before.generation + 1 })
  })
  await assert.rejects(() => reset, failure('grant-revoked'))
  const after = setup.store.transaction((transaction) => transaction.getRoot())
  assert.deepEqual(after.verifier, before.verifier)
  assert.equal(after.generation, before.generation + 1)
})

test('凭据状态、解绑与删除使用精确绑定，Provider 切换不被静默接受', async (t) => {
  const setup = fixture(t)
  await setup.initialize()
  const { port, management } = databasePort(setup)
  await registerWith(setup)
  assert.deepEqual(await readWith(setup), { username: 'app', password: SECRET })
  assert.deepEqual(
    await privileged(setup, () => management.credentialStatus(DATABASE_REFERENCE)),
    { metadata: (await management.listCredentials())[0], present: true },
  )

  await setup.provider.delete(setup.key())
  assert.equal(
    (await privileged(setup, () => management.credentialStatus(DATABASE_REFERENCE))).present,
    false,
  )
  await assert.rejects(() => readWith(setup), failure('credential-missing'))

  await registerWith(setup)
  setup.store.transaction((transaction) => {
    const metadata = transaction.getCredential(setup.profile, DATABASE_REFERENCE)
    transaction.setCredential({ ...metadata, providerId: 'another-provider' })
  })
  await assert.rejects(() => readWith(setup), failure('provider-unavailable'))
  setup.store.transaction((transaction) => {
    const metadata = transaction.getCredential(setup.profile, DATABASE_REFERENCE)
    transaction.setCredential({ ...metadata, providerId: 'memory' })
  })

  assert.equal((await management.listBindings()).length, 3)
  assert.equal(
    await privileged(setup, () => management.unbindCredential({
      componentId: 'postgres',
      capability: 'connect',
      resource: DATABASE,
      slot: DATABASE_SLOT,
    })),
    true,
  )
  assert.equal((await management.listBindings()).length, 2)
  assert.equal(
    await privileged(setup, () => management.unbindCredential({
      componentId: 'postgres',
      capability: 'connect',
      resource: DATABASE,
      slot: DATABASE_SLOT,
    })),
    false,
  )
  await assert.rejects(() => readWith(setup), failure('access-denied', 'credential-binding-mismatch'))
  await registerWith(setup)
  assert.equal((await management.listBindings()).length, 3)

  await privileged(setup, () => management.deleteCredential(DATABASE_REFERENCE))
  assert.deepEqual(await management.listCredentials(), [])
  assert.deepEqual(await management.listBindings(), [])
  await assert.rejects(() => readWith(setup), failure('access-denied', 'credential-binding-mismatch'))
})

test('清理只删除当前 service 下未登记元数据的孤立条目', async (t) => {
  const setup = fixture(t)
  await setup.initialize()
  await registerWith(setup)
  const { management } = databasePort(setup)
  const key = setup.key()
  await setup.provider.set({ service: key.service, account: 'orphan-a' }, 'orphan-secret')
  await setup.provider.set({ service: 'locus:other:default', account: 'other-service' }, 'other-secret')
  await assert.rejects(
    () => management.cleanupCredentialOrphans(false),
    failure('authentication-required'),
  )
  const audit = await privileged(setup, () => management.cleanupCredentialOrphans(false))
  assert.equal(audit.service, key.service)
  assert.deepEqual(audit.orphans, ['orphan-a'])
  assert.equal(audit.removed, 0)
  assert.equal(audit.remaining, 1)
  const cleaned = await privileged(setup, () => management.cleanupCredentialOrphans(true))
  assert.equal(cleaned.removed, 1)
  assert.equal(cleaned.remaining, 0)
  assert.deepEqual(
    JSON.parse(await setup.provider.get({ service: key.service, account: 'postgres-local' })),
    { password: SECRET },
  )
  assert.equal(await setup.provider.get({ service: key.service, account: 'orphan-a' }), undefined)
  assert.equal(await setup.provider.get({ service: 'locus:other:default', account: 'other-service' }), 'other-secret')
  assert.equal((await management.listCredentials()).length, 1)
})

test('显式内存 Store 事务失败回滚，释放使捕获的服务与 Provider 失效', async (t) => {
  const setup = fixture(t)
  assert.throws(() => setup.store.transaction((transaction) => {
    transaction.setInstallation({ installationId: '未提交' })
    throw new Error('回滚')
  }), /回滚/)
  assert.equal(setup.store.transaction((transaction) => transaction.getInstallation()), undefined)
  await setup.initialize()
  const { port } = databasePort(setup)
  await setup.core.dispose()
  await assert.rejects(
    () => port.execute(maintenanceRequest(), () => assert.fail()),
    failure('security-disposed'),
  )
  await assert.rejects(
    () => setup.provider.get({ service: 'unused', account: 'unused' }),
    failure('provider-unavailable'),
  )
})

test('显式能力错误原样穿透，通用异常仍收为 operation-failed', async (t) => {
  const setup = fixture(t)
  await setup.initialize()
  const { port } = databasePort(setup)
  await assert.rejects(
    () => port.execute({ capability: 'fail', resource: DATABASE, parameters: null }, () => {
      throw new CapabilityFailure('demo-failure', '组件显式失败')
    }),
    (error) => {
      assert.equal(error instanceof CapabilityFailure, true)
      assert.equal(error.code, 'demo-failure')
      assert.equal(error.message, '组件显式失败')
      return true
    },
  )
  await assert.rejects(
    () => port.execute({ capability: 'fail', resource: DATABASE, parameters: null }, () => {
      throw new Error('通用异常')
    }),
    failure('operation-failed'),
  )
})

test('Provider 与消费者异常只暴露分类，不泄漏秘密或后端错误对象', async (t) => {
  let mode = 'normal'
  const memory = createMemoryCredentialProvider()
  const provider = {
    ...memory,
    async get(key) {
      if (mode === 'failed') throw new Error(`锁定后端 ${SECRET}`)
      if (mode === 'missing') return undefined
      return memory.get(key)
    },
  }
  const setup = fixture(t, { provider })
  await setup.initialize()
  await registerWith(setup)
  mode = 'failed'
  await assert.rejects(() => readWith(setup), (error) => {
    failure('provider-unavailable')(error)
    assert.equal(JSON.stringify(error).includes(SECRET), false)
    assert.equal(String(error).includes(SECRET), false)
    assert.equal(error.cause, undefined)
    return true
  })
  mode = 'missing'
  await assert.rejects(() => readWith(setup), failure('credential-missing'))
  mode = 'normal'
  const { port } = databasePort(setup)
  await assert.rejects(
    () => port.execute(
      connectRequest(),
      (context) => context.withCredential(DATABASE_SLOT, DATABASE_REFERENCE, (values) => {
        throw new Error(values.password)
      }),
    ),
    (error) => {
      failure('operation-failed')(error)
      assert.equal(String(error).includes(SECRET), false)
      return true
    },
  )
})

test('写入后无法读回的 Provider 不会登记可用凭据引用', async (t) => {
  const provider = {
    id: 'unreadable-provider',
    async get() { return undefined },
    async set() {},
    async delete() {},
  }
  const setup = fixture(t, { provider })
  await setup.initialize()
  const { management } = databasePort(setup)
  await assert.rejects(
    () => registerWith(setup),
    failure('provider-unavailable'),
  )
  assert.deepEqual(await management.listCredentials(), [])
  assert.deepEqual(await management.listBindings(), [])
})

test('未显式注入 Provider 时拒绝原生写入且不登记引用', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'locus-security-no-provider-'))
  let host
  const defined = databaseComponent()
  const core = createLocusCore({ dataDirectory: join(root, 'data'), components: [defined.component], security: {
    store: createMemorySecurityStore(), receiveHost(value) { host = value },
  } })
  t.after(async () => { await core.dispose(); rmSync(root, { recursive: true, force: true }) })
  await host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD)
  const session = host.createSession('human')
  const management = host.forSession(session)
  const port = host.bindComponent(session, defined.component)
  await assert.rejects(
    () => port.execute(
      registerRequest(),
      (context) => defined.api.register(context, {
        credential: DATABASE_REFERENCE,
        values: DATABASE_VALUES,
      }),
    ),
    failure('provider-unavailable'),
  )
  assert.deepEqual(await management.listCredentials(), [])
  assert.deepEqual(await management.listBindings(), [])
  assert.equal((await core.security.providerStatus()).nativeBinding, 'not-loaded')
})

test('释放时租约清理 IO 失败仍撤销本地授权并释放所有资源', async (t) => {
  const memory = createMemorySecurityStore()
  let unavailable = false
  let storeClosed = false
  let providerClosed = false
  const store = {
    transaction(operation) {
      if (unavailable) throw new Error('模拟存储暂不可用')
      return memory.transaction(operation)
    },
    dispose() { storeClosed = true; memory.dispose() },
  }
  const provider = { ...createMemoryCredentialProvider(), dispose() { providerClosed = true } }
  const setup = fixture(t, { store, provider })
  await setup.initialize()
  const session = setup.host.createSession('human')
  let executed = false
  const pending = await challenge(() => setup.host.forSession(session).execute(rootRequest(), () => {
    executed = true
  }))
  const authentication = setup.host.authenticate(pending, ROOT_PASSWORD)
  void authentication.catch(() => {})
  unavailable = true
  let disposalFailed = false
  try { await setup.core.dispose() } catch { disposalFailed = true }
  unavailable = false
  const result = await authentication.then(() => 'authorized', () => 'revoked')
  assert.deepEqual(
    { disposalFailed, result, executed, storeClosed, providerClosed },
    { disposalFailed: true, result: 'revoked', executed: false, storeClosed: true, providerClosed: true },
  )
})

test('Provider 释放错误不透传秘密或原始异常对象', async (t) => {
  const provider = {
    ...createMemoryCredentialProvider(),
    dispose() { throw new Error(SECRET) },
  }
  const setup = fixture(t, { provider })
  let observed
  try {
    await setup.core.dispose()
  } catch (error) {
    observed = {
      code: error.code,
      safe: !String(error).includes(SECRET) && !JSON.stringify(error).includes(SECRET),
      noCause: error.cause === undefined,
    }
  }
  assert.deepEqual(observed, { code: 'provider-unavailable', safe: true, noCause: true })
})

test('同一安装的生产 Profile 中登记的凭据可被同 Profile 组件读取，不落入其他命名空间', async (t) => {
  const production = fixture(t, { profile: 'production' })
  await production.initialize()
  await registerWith(production)
  assert.deepEqual(await readWith(production), { username: 'app', password: SECRET })
  let applicationHost
  const application = createLocusCore({
    dataDirectory: production.dataDirectory,
    components: production.definitions,
    security: {
      store: production.store,
      provider: production.provider,
      receiveHost(value) { applicationHost = value },
    },
  })
  t.after(async () => { await application.dispose() })
  const session = applicationHost.createSession('component')
  const port = applicationHost.bindComponent(session, production.definition)
  assert.deepEqual(
    await port.execute(
      connectRequest(),
      (context) => production.defined[0].api.connect(context, { credential: DATABASE_REFERENCE }),
    ),
    { username: 'app', password: SECRET },
  )

  let otherHost
  const other = createLocusCore({
    dataDirectory: production.dataDirectory,
    components: production.definitions,
    security: {
      profile: 'default',
      store: production.store,
      provider: production.provider,
      receiveHost(value) { otherHost = value },
    },
  })
  t.after(async () => { await other.dispose() })
  const otherManagement = otherHost.forSession(otherHost.createSession('human'))
  assert.deepEqual(await otherManagement.listCredentials(), [])
  assert.deepEqual(await otherManagement.listBindings(), [])
})
