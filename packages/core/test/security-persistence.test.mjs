import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  createLocusCore,
  createMemoryCredentialProvider,
  createSqliteSecurityStore,
  defineComponent,
  SecurityFailure,
} from '../lib/index.js'

const ROOT_PASSWORD = 'Root-持久化隔离测试-2026'
const REPLACEMENT_PASSWORD = 'Root-重置后的持久化隔离测试-2026'
const SECRET = 'SQLite-不得保存的资源秘密-2026'
const NOW = 1_000_000
const REFERENCE = 'credential:postgres-local'
const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111'
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222'
const DATABASE = Object.freeze({ type: 'database', id: 'local' })
const SLOT = 'database-auth'

const readDatabasePassword = (context, input) =>
  context.withCredential(SLOT, input.credential, (values) => values.password)

const registerDatabasePassword = async (context, input) => {
  await context.registerCredential(SLOT, input.credential, input.values)
  return { registered: true }
}

const DATABASE_COMPONENT = defineComponent({
  id: 'postgres',
  version: '1',
  name: 'postgres',
  summary: '持久化隔离消费者',
  kind: 'locus',
  capabilities: [
    {
      id: 'connect',
      resourceType: 'database',
      defaultAuthLevel: 'user',
      secrets: [{ slot: SLOT, access: 'read' }],
      run: readDatabasePassword,
    },
    {
      id: 'register',
      resourceType: 'database',
      defaultAuthLevel: 'user',
      secrets: [{ slot: SLOT, access: 'write' }],
      run: registerDatabasePassword,
    },
  ],
  credentials: [
    {
      id: SLOT,
      fields: [
        { name: 'username', secret: false, required: true },
        { name: 'password', secret: true, required: true },
      ],
    },
  ],
})
const DEFINITION = DATABASE_COMPONENT.component

function failure(code) {
  return (error) => {
    assert.equal(error instanceof SecurityFailure, true)
    assert.equal(error.code, code)
    return true
  }
}

function rootRequest() {
  return {
    capability: 'system:service:manage',
    resource: { type: 'service', id: 'local' },
    parameters: { service: 'test-service' },
  }
}

function registerRequest() {
  return { capability: 'register', resource: DATABASE, parameters: { reference: REFERENCE } }
}

function credentialRequest() {
  return { capability: 'connect', resource: DATABASE, parameters: null }
}

async function challenge(action) {
  let pending
  await assert.rejects(action, (error) => {
    failure('authentication-required')(error)
    assert.ok(error.challenge)
    pending = error.challenge
    return true
  })
  return pending
}

async function privileged(setup, action, password = ROOT_PASSWORD) {
  const pending = await challenge(action)
  return setup.host.resume(await setup.host.authenticate(pending, password))
}

function withDatabase(directory, operation) {
  const database = new DatabaseSync(join(directory, 'core.sqlite'))
  try { return operation(database) } finally { database.close() }
}

function normalizeMetadata(metadata) {
  return { ...metadata, fields: { ...metadata.fields } }
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-security-persistence-'))
  const dataDirectory = join(root, 'data')
  const cores = []
  const stores = []
  t.after(async () => {
    for (const core of cores) await core.dispose()
    for (const store of stores) store.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root,
    dataDirectory,
    store(directory = dataDirectory, profile = 'development') {
      const store = createSqliteSecurityStore(directory, profile)
      stores.push(store)
      return store
    },
    open({
      directory = dataDirectory,
      profile = 'development',
      provider = createMemoryCredentialProvider(),
      store,
      clock = () => NOW,
    } = {}) {
      let host
      const core = createLocusCore({
        dataDirectory: directory,
        components: [DEFINITION],
        security: {
          provider,
          profile,
          clock,
          ...(store === undefined ? {} : { store }),
          receiveHost(value) { host = value },
        },
      })
      cores.push(core)
      const session = host.createSession('human')
      const port = host.bindComponent(session, DEFINITION)
      return {
        core,
        host,
        provider,
        profile,
        management: host.forSession(session),
        port,
        initialize: () => host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD),
        register(reference = REFERENCE, values = { username: 'app', password: SECRET }) {
          return port.execute(
            registerRequest(),
            (context) => DATABASE_COMPONENT.api.register(context, { credential: reference, values }),
          )
        },
        read(reference = REFERENCE) {
          return port.execute(
            credentialRequest(),
            (context) => DATABASE_COMPONENT.api.connect(context, { credential: reference }),
          )
        },
      }
    },
  }
}

// 子进程的固定测试输入只在测试源码的 stdin 中，不把密码放进 argv、环境或输出协议。
const CHILD_SOURCE = `
  import { createLocusCore, createMemoryCredentialProvider } from ${JSON.stringify(new URL('../lib/index.js', import.meta.url).href)};
  const password = 'Root-持久化隔离测试-2026';
  const replacement = 'Root-重置后的持久化隔离测试-2026';
  const now = Number(process.argv[4]);
  let host;
  const core = createLocusCore({ dataDirectory: process.argv[2], security: {
    profile: 'development', provider: createMemoryCredentialProvider(), clock: () => now,
    receiveHost(value) { host = value; },
  }});
  try {
    const mode = process.argv[3];
    if (mode === 'reset') {
      await host.resetRoot(replacement, replacement);
    } else {
      const management = host.forSession(host.createSession('human'));
      let challenge;
      try {
        await management.execute({ capability: 'system:service:manage',
          resource: { type: 'service', id: 'local' }, parameters: null }, () => undefined);
        throw new Error('未要求认证');
      } catch (error) {
        if (error.code !== 'authentication-required') throw error;
        challenge = error.challenge;
      }
      const authenticating = host.authenticate(challenge, mode === 'wrong' ? '错误的隔离测试密码' : password);
      if (mode === 'interrupt') process.exit(17);
      await host.resume(await authenticating);
    }
    console.log(JSON.stringify({ code: 'ok' }));
  } catch (error) {
    console.log(JSON.stringify({ code: error.code ?? 'unexpected' }));
  } finally {
    await core.dispose();
  }
`

function child(directory, mode, now = NOW) {
  const argv = ['--input-type=module', '-', directory, mode, String(now)]
  const result = spawnSync(process.execPath, argv, {
    input: CHILD_SOURCE, encoding: 'utf8', timeout: 20_000,
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, mode === 'interrupt' ? 17 : 0, result.stderr)
  for (const secret of [ROOT_PASSWORD, REPLACEMENT_PASSWORD, SECRET]) {
    assert.equal(result.stdout.includes(secret), false)
    assert.equal(result.stderr.includes(secret), false)
    assert.equal(argv.join(' ').includes(secret), false)
  }
  return mode === 'interrupt' ? undefined : JSON.parse(result.stdout).code
}

test('SQLite Store 构造与空目录读取不 IO，首次 setter 建库而回滚不留下半份安装状态', async (t) => {
  const setup = fixture(t)
  const store = setup.store()
  let captured
  assert.equal(existsSync(setup.dataDirectory), false)
  store.transaction((transaction) => {
    captured = transaction
    assert.equal(transaction.getInstallation(), undefined)
    assert.equal(transaction.getRoot(), undefined)
    assert.deepEqual(transaction.listCredentials('development'), [])
    assert.deepEqual(transaction.listBindings('development'), [])
    assert.deepEqual(transaction.listCapabilityLevels('development'), [])
    assert.equal(transaction.getCredential('development', REFERENCE), undefined)
    transaction.deleteCredential('development', REFERENCE)
  })
  assert.equal(existsSync(setup.dataDirectory), false)
  assert.throws(() => captured.getRoot(), failure('io'))
  assert.throws(() => store.transaction((transaction) => {
    transaction.setInstallation({ installationId: INSTALLATION_ID })
    assert.equal(existsSync(join(setup.dataDirectory, 'core.sqlite')), true)
    throw new Error(SECRET)
  }), (error) => {
    failure('io')(error)
    assert.equal(String(error).includes(SECRET), false)
    assert.equal(error.cause, undefined)
    return true
  })
  assert.equal(store.transaction((transaction) => transaction.getInstallation()), undefined)
  assert.equal(store.transaction((transaction) => transaction.getRoot()), undefined)
  // 安装身份必须与 Root 一起提交；单独的安装写入不会留下可读状态。
  assert.throws(
    () => store.transaction((transaction) => transaction.setInstallation({ installationId: INSTALLATION_ID })),
    failure('security-unavailable'),
  )
  assert.equal(store.transaction((transaction) => transaction.getInstallation()), undefined)
  const opened = setup.open({ store })
  await opened.initialize()
  assert.equal(
    withDatabase(setup.dataDirectory, (database) => database.prepare('PRAGMA user_version').get().user_version),
    7,
  )
  const status = await opened.core.security.status()
  assert.equal(status.initialized, true)
  assert.match(status.installationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(status.installationId, INSTALLATION_ID)
})

test('SQLite 事务真实回滚所有安全字段，禁止异步与嵌套事务，重开只见已提交状态', async (t) => {
  const setup = fixture(t)
  const store = setup.store()
  const opened = setup.open({ store })
  await opened.initialize()
  const before = store.transaction((transaction) => ({
    installation: transaction.getInstallation(),
    root: transaction.getRoot(),
  }))
  const metadata = {
    reference: REFERENCE,
    profile: 'development',
    owner: 'postgres',
    providerId: 'memory',
    fields: { username: 'app' },
    createdAt: NOW,
    updatedAt: NOW,
  }
  const binding = {
    profile: 'development',
    componentId: 'postgres',
    capability: 'connect',
    slot: SLOT,
    resource: DATABASE,
    reference: REFERENCE,
    createdAt: NOW,
    updatedAt: NOW,
  }
  const level = {
    profile: 'development',
    componentId: 'postgres',
    capability: 'connect',
    level: 'root',
    updatedAt: NOW,
  }
  assert.throws(() => store.transaction((transaction) => {
    transaction.setRoot({ ...before.root, generation: before.root.generation + 1 })
    transaction.setCredential(metadata)
    transaction.setBinding(binding)
    transaction.setCapabilityLevel(level)
    throw new Error('必须回滚')
  }), failure('io'))
  assert.throws(() => store.transaction(async (transaction) => {
    transaction.setRoot({ ...before.root, generation: before.root.generation + 1 })
  }), failure('io'))
  assert.throws(() => store.transaction(() => store.transaction(() => undefined)), failure('io'))
  assert.throws(
    () => store.transaction((transaction) => transaction.setInstallation({ installationId: ATTEMPT_ID })),
    failure('security-unavailable'),
  )
  assert.deepEqual(store.transaction((transaction) => ({
    installation: transaction.getInstallation(),
    root: transaction.getRoot(),
  })), before)
  assert.deepEqual(store.transaction((transaction) => transaction.listCredentials('development')), [])
  assert.deepEqual(store.transaction((transaction) => transaction.listBindings('development')), [])
  assert.deepEqual(store.transaction((transaction) => transaction.listCapabilityLevels('development')), [])
  store.transaction((transaction) => {
    transaction.setCredential(metadata)
    transaction.setBinding(binding)
    transaction.setCapabilityLevel(level)
  })
  await opened.core.dispose()
  const reopened = setup.store()
  assert.deepEqual(reopened.transaction((transaction) => transaction.getRoot()), before.root)
  assert.deepEqual(
    normalizeMetadata(reopened.transaction((transaction) => transaction.getCredential('development', REFERENCE))),
    metadata,
  )
  const storedBinding = reopened.transaction((transaction) => transaction.getBinding(
    'development', 'postgres', 'connect', DATABASE, SLOT,
  ))
  assert.deepEqual({ ...storedBinding, resource: { ...storedBinding.resource } }, binding)
  assert.equal(
    reopened.transaction((transaction) => transaction.getCapabilityLevel('development', 'postgres', 'connect')),
    'root',
  )
  assert.deepEqual(reopened.transaction((transaction) => transaction.listCapabilityLevels('development')), [level])
})

test('Root 固定格式与失败租约边界在写入前校验，凭据、绑定与等级同样严格', async (t) => {
  const setup = fixture(t)
  const store = setup.store()
  const opened = setup.open({ store })
  await opened.initialize()
  const root = store.transaction((transaction) => transaction.getRoot())
  const invalidRoot = [
    { ...root, generation: 0 },
    { ...root, generation: Number.MAX_SAFE_INTEGER + 1 },
    ...[
      { version: 2 }, { algorithm: 'plaintext' }, { N: 16384 }, { r: 1 }, { p: 2 }, { maxmem: 32 * 1024 * 1024 },
      { salt: '00'.repeat(15) }, { salt: 'g'.repeat(32) }, { derivedKey: '00'.repeat(31) }, { derivedKey: 'G'.repeat(64) },
    ].map((verifier) => ({ ...root, verifier: { ...root.verifier, ...verifier } })),
    { ...root, failedAttempts: -1 },
    { ...root, failedAttempts: 6 },
    { ...root, failedAttempts: 1.5 },
    { ...root, failedAttempts: 5 },
    { ...root, failedAttempts: 4, lockedUntil: NOW + 60_000 },
    { ...root, failedAttempts: 5, lockedUntil: -1 },
    { ...root, attempt: { id: ATTEMPT_ID, expiresAt: NOW + 60_000 } },
    { ...root, failedAttempts: 1, attempt: { id: 'not-a-uuid', expiresAt: NOW + 60_000 } },
    { ...root, failedAttempts: 1, attempt: { id: ATTEMPT_ID, expiresAt: -1 } },
  ]
  for (const value of invalidRoot) {
    assert.throws(() => store.transaction((transaction) => transaction.setRoot(value)), failure('security-unavailable'))
  }
  assert.deepEqual(store.transaction((transaction) => transaction.getRoot()), root)

  const metadata = {
    reference: REFERENCE,
    profile: 'development',
    owner: 'postgres',
    providerId: 'memory',
    fields: { username: 'app' },
    createdAt: NOW,
    updatedAt: NOW,
  }
  const invalidMetadata = [
    { profile: 'Development' },
    { reference: 'credential:Invalid' },
    { reference: 'credential:postgres_local' },
    { owner: '' },
    { owner: 'postgres\0invalid' },
    { providerId: '' },
    { providerId: ' memory' },
    { providerId: 'memory\0invalid' },
    { createdAt: -1 },
    { updatedAt: NOW - 1 },
    { fields: null },
    { fields: 'text' },
    { fields: { Bad: 'x' } },
    { fields: { username: 1 } },
  ]
  for (const value of invalidMetadata) {
    assert.throws(
      () => store.transaction((transaction) => transaction.setCredential({ ...metadata, ...value })),
      failure('security-unavailable'),
    )
  }

  const binding = {
    profile: 'development',
    componentId: 'postgres',
    capability: 'connect',
    slot: SLOT,
    resource: DATABASE,
    reference: REFERENCE,
    createdAt: NOW,
    updatedAt: NOW,
  }
  const invalidBindings = [
    { profile: 'Development' },
    { componentId: 'Postgres' },
    { componentId: '' },
    { capability: 'connect:now' },
    { slot: 'Database' },
    { resource: { type: 'Database', id: 'local' } },
    { resource: { type: 'database', id: '' } },
    { reference: 'credential:Invalid' },
    { createdAt: -1 },
    { updatedAt: NOW - 1 },
  ]
  for (const value of invalidBindings) {
    assert.throws(
      () => store.transaction((transaction) => transaction.setBinding({ ...binding, ...value })),
      failure('security-unavailable'),
    )
  }

  const level = {
    profile: 'development',
    componentId: 'postgres',
    capability: 'connect',
    level: 'root',
    updatedAt: NOW,
  }
  const invalidLevels = [
    { profile: 'Development' },
    { componentId: 'Postgres' },
    { capability: 'connect:now' },
    { level: 'admin' },
    { updatedAt: -1 },
  ]
  for (const value of invalidLevels) {
    assert.throws(
      () => store.transaction((transaction) => transaction.setCapabilityLevel({ ...level, ...value })),
      failure('security-unavailable'),
    )
  }
  assert.deepEqual(store.transaction((transaction) => transaction.listCredentials('development')), [])
  assert.deepEqual(store.transaction((transaction) => transaction.listBindings('development')), [])
  assert.deepEqual(store.transaction((transaction) => transaction.listCapabilityLevels('development')), [])
})

test('持久化租约对应真实认证状态：第五次预记失败会锁定，取消 KDF 原子退回第四次', async (t) => {
  const setup = fixture(t)
  const store = setup.store()
  const opened = setup.open({ store })
  await opened.initialize()
  store.transaction((transaction) => transaction.setRoot({ ...transaction.getRoot(), failedAttempts: 4 }))
  const pending = await challenge(() => opened.management.execute(rootRequest(), () => assert.fail()))
  const authenticating = opened.host.authenticate(pending, ROOT_PASSWORD)
  const observer = setup.store()
  const active = observer.transaction((transaction) => transaction.getRoot())
  assert.equal(active.failedAttempts, 5)
  assert.equal(active.lockedUntil, NOW + 60_000)
  assert.match(active.attempt.id, /^[0-9a-f-]{36}$/)
  assert.equal(active.attempt.expiresAt, NOW + 60_000)
  const second = setup.open()
  const concurrent = await challenge(() => second.management.execute(rootRequest(), () => assert.fail()))
  await assert.rejects(() => second.host.authenticate(concurrent, ROOT_PASSWORD), failure('authentication-rate-limited'))
  opened.host.cancelChallenge(pending)
  await assert.rejects(() => authenticating, failure('authentication-cancelled'))
  const cancelled = observer.transaction((transaction) => transaction.getRoot())
  assert.equal(cancelled.failedAttempts, 4)
  assert.equal(cancelled.lockedUntil, undefined)
  assert.equal(cancelled.attempt, undefined)
})

test('五个独立 Node 进程错误验证共享失败计数，第六次被锁定，期限后成功清零', async (t) => {
  const setup = fixture(t)
  const opened = setup.open()
  await opened.initialize()
  const workspace = opened.core.workspaces.create('跨进程保留')
  const status = await opened.core.security.status()
  await opened.core.dispose()
  const observer = setup.store()
  for (let attempt = 1; attempt <= 5; attempt++) {
    assert.equal(child(setup.dataDirectory, 'wrong'), 'authentication-failed')
    const root = observer.transaction((transaction) => transaction.getRoot())
    assert.equal(root.failedAttempts, attempt)
    assert.equal(root.lockedUntil, attempt === 5 ? NOW + 60_000 : undefined)
    assert.equal(root.attempt, undefined)
  }
  assert.equal(child(setup.dataDirectory, 'correct'), 'authentication-rate-limited')
  assert.equal(child(setup.dataDirectory, 'correct', NOW + 60_000), 'ok')
  const root = observer.transaction((transaction) => transaction.getRoot())
  assert.equal(root.failedAttempts, 0)
  assert.equal(root.lockedUntil, undefined)
  assert.equal(root.attempt, undefined)
  const reopened = setup.open()
  assert.deepEqual(await reopened.core.security.status(), status)
  assert.deepEqual(reopened.core.workspaces.get(workspace.id), workspace)
})

test('KDF 期间进程退出保留预记失败与租约，重启不能清零或并发验证', async (t) => {
  const setup = fixture(t)
  const opened = setup.open()
  await opened.initialize()
  await opened.core.dispose()
  child(setup.dataDirectory, 'interrupt')
  const observer = setup.store()
  const interrupted = observer.transaction((transaction) => transaction.getRoot())
  assert.equal(interrupted.failedAttempts, 1)
  assert.equal(interrupted.lockedUntil, undefined)
  assert.equal(interrupted.attempt.expiresAt, NOW + 60_000)
  assert.equal(child(setup.dataDirectory, 'correct'), 'authentication-unavailable')
  assert.equal(child(setup.dataDirectory, 'wrong', NOW + 60_000), 'authentication-failed')
  const after = observer.transaction((transaction) => transaction.getRoot())
  assert.equal(after.failedAttempts, 2)
  assert.equal(after.attempt, undefined)
})

test('外部 Node 进程重置递增世代，原 Core 拒绝旧 Grant/Challenge 且保留 Workspace 与资源凭据', async (t) => {
  const setup = fixture(t)
  const opened = setup.open()
  await opened.initialize()
  const workspace = opened.core.workspaces.create('重置不删除')
  opened.core.workspaces.link(workspace.id, 'association', { namespace: 'example.resource', id: 'kept' }, { kind: 'manual', detail: '重置前确认' })
  opened.core.mounts.add(workspace.id, join(setup.root, 'native'), { name: 'native' })
  const expected = opened.core.workspaces.get(workspace.id)
  await opened.register()
  assert.equal(await opened.read(), SECRET)
  const observer = setup.store()
  const before = observer.transaction((transaction) => transaction.getRoot())
  const status = await opened.core.security.status()
  let calls = 0
  const pending = await challenge(() => opened.management.execute(rootRequest(), () => ++calls))
  const unverified = await challenge(() => opened.management.execute(rootRequest(), () => ++calls))
  const grant = await opened.host.authenticate(pending, ROOT_PASSWORD)
  assert.equal(child(setup.dataDirectory, 'reset'), 'ok')
  const after = observer.transaction((transaction) => transaction.getRoot())
  assert.equal(after.generation, before.generation + 1)
  assert.notEqual(after.verifier.salt, before.verifier.salt)
  assert.equal(after.failedAttempts, 0)
  assert.equal(after.lockedUntil, undefined)
  assert.equal(after.attempt, undefined)
  await assert.rejects(() => opened.host.resume(grant), failure('grant-revoked'))
  await assert.rejects(() => opened.host.authenticate(unverified, ROOT_PASSWORD), failure('challenge-revoked'))
  assert.equal(calls, 0)
  assert.deepEqual(opened.core.workspaces.get(workspace.id), expected)
  assert.deepEqual(await opened.core.security.status(), status)
  assert.equal(await opened.read(), SECRET)
  const next = await challenge(() => opened.management.execute(rootRequest(), () => '已恢复原操作'))
  await assert.rejects(() => opened.host.authenticate(next, ROOT_PASSWORD), failure('authentication-failed'))
  assert.equal(await opened.host.resume(await opened.host.authenticate(next, REPLACEMENT_PASSWORD)), '已恢复原操作')
  const bytes = readFileSync(join(setup.dataDirectory, 'core.sqlite'))
  for (const secret of [ROOT_PASSWORD, REPLACEMENT_PASSWORD, SECRET]) {
    assert.equal(bytes.includes(Buffer.from(secret)), false)
  }
  await opened.core.dispose()
  const reopened = setup.open()
  assert.equal((await reopened.management.listCredentials())[0].providerId, 'memory')
  await assert.rejects(() => reopened.read(), failure('credential-missing'))
})

test('安装 UUID 随目录移动保持稳定，Profile 隔离 metadata 与 Provider 命名空间，Provider ID 不可隐式切换', async (t) => {
  const setup = fixture(t)
  const memory = createMemoryCredentialProvider()
  const keys = []
  // 两个 Core 借用同一个测试保管器，生命周期由本用例统一释放。
  const provider = {
    id: memory.id,
    get: (key) => memory.get(key),
    async set(key, secret) { keys.push(key); await memory.set(key, secret) },
    delete: (key) => memory.delete(key),
  }
  t.after(() => memory.dispose())
  let now = NOW
  const development = setup.open({ provider, clock: () => now })
  await development.initialize()
  const production = setup.open({ profile: 'production', provider, clock: () => now })
  const installationId = (await development.core.security.status()).installationId
  assert.equal((await production.core.security.status()).installationId, installationId)
  await development.register()
  assert.deepEqual(await production.management.listCredentials(), [])
  assert.deepEqual(await production.management.listBindings(), [])
  await production.register(REFERENCE, { username: 'other', password: '另一个 Profile 的隔离秘密' })
  now += 1000
  await development.register()
  const metadata = (await development.management.listCredentials())[0]
  assert.deepEqual(normalizeMetadata(metadata), {
    reference: REFERENCE,
    profile: 'development',
    owner: 'postgres',
    providerId: 'memory',
    fields: { username: 'app' },
    createdAt: NOW,
    updatedAt: now,
  })
  assert.deepEqual(
    { ...(await production.management.listCredentials())[0].fields },
    { username: 'other' },
  )
  assert.equal(await development.read(), SECRET)
  assert.equal(await production.read(), '另一个 Profile 的隔离秘密')
  assert.deepEqual(keys.map((key) => key.service), [
    `locus:${installationId}:development`,
    `locus:${installationId}:production`,
    `locus:${installationId}:development`,
  ])
  assert.equal(keys.every((key) => key.account === 'postgres-local'), true)
  let wrongProviderReads = 0
  const wrong = setup.open({
    provider: {
      ...provider,
      id: 'different-provider',
      async get() { wrongProviderReads++; return SECRET },
    },
  })
  await assert.rejects(() => wrong.read(), failure('provider-unavailable'))
  assert.equal(wrongProviderReads, 0)
  await development.core.dispose()
  await production.core.dispose()
  await wrong.core.dispose()
  const moved = join(setup.root, 'moved-data')
  renameSync(setup.dataDirectory, moved)
  const reopened = setup.open({ directory: moved, provider })
  assert.equal((await reopened.core.security.status()).installationId, installationId)
  assert.deepEqual(
    (await reopened.management.listCredentials()).map(normalizeMetadata),
    [normalizeMetadata(metadata)],
  )
  assert.equal(await reopened.read(), SECRET)
})

test('凭据与组件绑定跨进程持久化，共享槽为每个能力建立精确绑定，删除凭据级联删除绑定', async (t) => {
  const setup = fixture(t)
  const memory = createMemoryCredentialProvider()
  const provider = { ...memory, dispose() {} }
  const opened = setup.open({ provider })
  await opened.initialize()
  await opened.register()
  const bindings = await opened.management.listBindings()
  assert.equal(bindings.length, 2)
  assert.deepEqual(bindings.map((binding) => binding.capability), ['connect', 'register'])
  for (const binding of bindings) {
    assert.equal(binding.componentId, 'postgres')
    assert.equal(binding.slot, SLOT)
    assert.equal(binding.reference, REFERENCE)
    assert.deepEqual(binding.resource, DATABASE)
  }
  await opened.core.dispose()

  const reopened = setup.open({ provider })
  assert.deepEqual(await reopened.management.listBindings(), bindings)
  assert.equal(await reopened.read(), SECRET)
  await privileged(reopened, () => reopened.management.deleteCredential(REFERENCE))
  assert.deepEqual(await reopened.management.listBindings(), [])
  await assert.rejects(
    () => reopened.read(),
    (error) => error.code === 'access-denied' && error.reason === 'credential-binding-mismatch',
  )
  memory.dispose()
})

test('未知版本与当前结构冲突被拒绝，原数据库字节不被覆盖', async (t) => {
  const setup = fixture(t)
  const cases = [
    ['unknown-version', (database) => database.exec('PRAGMA user_version = 99')],
    ['old-version', (database) => database.exec('PRAGMA user_version = 5')],
    ['missing-component-table', (database) => database.exec('DROP TABLE component_states')],
    ['security-table-conflict', (database) => {
      database.exec('ALTER TABLE security_root_authentication RENAME TO security_root_authentication_old')
      database.exec('CREATE TABLE security_root_authentication (unknown TEXT)')
    }],
    ['binding-column-conflict', (database) => database.exec(
      'ALTER TABLE security_credential_bindings RENAME COLUMN slot TO unknown_slot',
    )],
    ['workspace-column-conflict', (database) => database.exec('ALTER TABLE workspaces RENAME COLUMN name TO unknown_name')],
  ]
  for (const [name, corrupt] of cases) {
    const directory = join(setup.root, name)
    const opened = setup.open({ directory })
    opened.core.workspaces.create('冲突前数据')
    await opened.core.dispose()
    withDatabase(directory, corrupt)
    const before = readFileSync(join(directory, 'core.sqlite'))
    await assert.rejects(() => setup.open({ directory }).core.security.status(), failure('io'))
    assert.deepEqual(readFileSync(join(directory, 'core.sqlite')), before)
  }
  const current = setup.open()
  await current.initialize()
  await current.core.dispose()
  withDatabase(setup.dataDirectory, (database) => database.exec(
    'ALTER TABLE security_root_authentication ADD COLUMN unknown_column TEXT',
  ))
  const before = readFileSync(join(setup.dataDirectory, 'core.sqlite'))
  await assert.rejects(() => setup.open().core.security.status(), failure('io'))
  assert.deepEqual(readFileSync(join(setup.dataDirectory, 'core.sqlite')), before)
})

test('损坏 Root、安装、Profile、凭据、绑定与等级材料只显式失败，不重建、不泄露敏感验证材料', async (t) => {
  const setup = fixture(t)
  const opened = setup.open()
  await opened.initialize()
  const store = setup.store()
  const verifier = store.transaction((transaction) => transaction.getRoot().verifier)
  store.transaction((transaction) => {
    transaction.setCredential({
      reference: REFERENCE,
      profile: 'development',
      owner: 'postgres',
      providerId: 'memory',
      fields: { username: 'app' },
      createdAt: NOW,
      updatedAt: NOW,
    })
    transaction.setBinding({
      profile: 'development',
      componentId: 'postgres',
      capability: 'connect',
      slot: SLOT,
      resource: DATABASE,
      reference: REFERENCE,
      createdAt: NOW,
      updatedAt: NOW,
    })
    transaction.setCapabilityLevel({
      profile: 'development',
      componentId: 'postgres',
      capability: 'connect',
      level: 'root',
      updatedAt: NOW,
    })
  })
  await opened.core.dispose()
  store.dispose()
  const cases = [
    ['generation', 'UPDATE security_root_authentication SET generation = 0'],
    ['unsafe-generation', 'UPDATE security_root_authentication SET generation = 9007199254740992'],
    ['kdf-version', 'UPDATE security_root_authentication SET verifier_version = 2'],
    ['kdf-algorithm', "UPDATE security_root_authentication SET algorithm = 'plaintext'"],
    ['kdf-N', 'UPDATE security_root_authentication SET scrypt_n = 16384'],
    ['kdf-r', 'UPDATE security_root_authentication SET scrypt_r = 1'],
    ['kdf-p', 'UPDATE security_root_authentication SET scrypt_p = 2'],
    ['kdf-maxmem', 'UPDATE security_root_authentication SET scrypt_maxmem = 33554432'],
    ['salt-length', "UPDATE security_root_authentication SET salt = '00'"],
    ['salt-hex', `UPDATE security_root_authentication SET salt = '${'g'.repeat(32)}'`],
    ['hash-length', "UPDATE security_root_authentication SET derived_key = '00'"],
    ['hash-hex', `UPDATE security_root_authentication SET derived_key = '${'G'.repeat(64)}'`],
    ['failure-count', 'UPDATE security_root_authentication SET failed_attempts = 6'],
    ['missing-lock', 'UPDATE security_root_authentication SET failed_attempts = 5'],
    ['unexpected-lock', `UPDATE security_root_authentication SET locked_until = ${NOW + 60_000}`],
    ['half-attempt', `UPDATE security_root_authentication SET attempt_expires_at = ${NOW + 60_000}`],
    ['attempt-without-failure', `UPDATE security_root_authentication SET attempt_id = '${ATTEMPT_ID}', attempt_expires_at = ${NOW + 60_000}`],
    ['invalid-attempt', `UPDATE security_root_authentication SET failed_attempts = 1, attempt_id = 'invalid', attempt_expires_at = ${NOW + 60_000}`],
    ['installation', "UPDATE security_installation SET installation_id = 'invalid'"],
    ['missing-root', 'DELETE FROM security_root_authentication'],
    ['profile', "UPDATE security_profiles SET name = 'Development'"],
    ['provider-id', "UPDATE security_credentials SET provider_id = ' memory'"],
    ['credential-ref', "UPDATE security_credentials SET reference = 'credential:Invalid'"],
    ['credential-time', 'UPDATE security_credentials SET updated_at = created_at - 1'],
    ['fields-json', "UPDATE security_credentials SET fields = '{'"],
    ['fields-array', "UPDATE security_credentials SET fields = '[]'"],
    ['fields-name', `UPDATE security_credentials SET fields = '{"Bad":"x"}'`],
    ['binding-component', "UPDATE security_credential_bindings SET component_id = 'Postgres'"],
    ['binding-capability', "UPDATE security_credential_bindings SET capability = 'connect:now'"],
    ['binding-slot', "UPDATE security_credential_bindings SET slot = 'Database'"],
    ['binding-resource', "UPDATE security_credential_bindings SET resource_type = 'Database'"],
    ['binding-reference', "UPDATE security_credential_bindings SET reference = 'credential:Invalid'"],
    ['binding-time', 'UPDATE security_credential_bindings SET updated_at = created_at - 1'],
    ['level', "UPDATE security_capability_levels SET level = 'admin'"],
    ['level-component', "UPDATE security_capability_levels SET component_id = 'Postgres'"],
    ['level-time', 'UPDATE security_capability_levels SET updated_at = -1'],
  ]
  for (const [name, sql] of cases) await t.test(name, (t) => {
    const directory = join(setup.root, name)
    mkdirSync(directory)
    copyFileSync(join(setup.dataDirectory, 'core.sqlite'), join(directory, 'core.sqlite'))
    withDatabase(directory, (database) => {
      database.exec('PRAGMA foreign_keys = OFF; PRAGMA ignore_check_constraints = ON')
      database.exec(sql)
    })
    const before = readFileSync(join(directory, 'core.sqlite'))
    const corrupted = createSqliteSecurityStore(directory, 'development')
    t.after(() => corrupted.dispose())
    assert.throws(() => corrupted.transaction((transaction) => {
      transaction.getRoot()
      transaction.listCredentials('development')
      transaction.listBindings('development')
      transaction.listCapabilityLevels('development')
    }), (error) => {
      assert.equal(error instanceof SecurityFailure, true)
      assert.ok(error.code === 'security-unavailable' || error.code === 'io')
      assert.equal(error.cause, undefined)
      for (const sensitive of [ROOT_PASSWORD, SECRET, verifier.salt, verifier.derivedKey]) {
        assert.equal(String(error).includes(sensitive), false)
        assert.equal(JSON.stringify(error).includes(sensitive), false)
      }
      return true
    })
    assert.deepEqual(readFileSync(join(directory, 'core.sqlite')), before)
  })
})
