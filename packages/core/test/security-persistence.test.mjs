import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createCoreEventStore } from '../lib/events/index.js'
import { CORE_SCHEMA_VERSION } from '../lib/storage/index.js'
import { createMemorySecurityStore, createSqliteSecurityStore, SecurityFailure } from '../lib/security/index.js'

const PROFILE = 'production'
const SECRET = 'SQLite-不得保存的资源秘密-2026'
const ROOT = Object.freeze({
  generation: 1,
  verifier: Object.freeze({
    version: 1,
    algorithm: 'scrypt',
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 67108864,
    salt: 'a'.repeat(32),
    derivedKey: 'b'.repeat(64),
  }),
  failedAttempts: 0,
  lockedUntil: undefined,
  attempt: undefined,
})
const INSTALLATION = Object.freeze({ installationId: '11111111-1111-4111-8111-111111111111' })
const METADATA = Object.freeze({
  reference: 'credential:alpha',
  profile: PROFILE,
  owner: 'postgres',
  providerId: 'memory',
  fields: Object.freeze({ host: 'localhost', database: 'app' }),
  createdAt: 10,
  updatedAt: 20,
})
const BINDING = Object.freeze({
  profile: PROFILE,
  componentId: 'postgres',
  slot: 'database-auth',
  resourceKey: 'app',
  reference: 'credential:alpha',
  createdAt: 10,
  updatedAt: 20,
})
const LEVEL = Object.freeze({
  profile: PROFILE,
  componentId: 'postgres',
  operation: 'pg.database.register',
  level: 'user',
  updatedAt: 10,
})

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'locus-security-store-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

function failure(error) {
  return error instanceof SecurityFailure
}

test('空目录读取不建库，首次安装写入创建当前 schema', (t) => {
  const directory = fixture(t)
  const store = createSqliteSecurityStore(directory)
  assert.equal(existsSync(join(directory, 'core.sqlite')), false)
  assert.equal(store.transaction((transaction) => transaction.getRoot()), undefined)
  assert.equal(existsSync(join(directory, 'core.sqlite')), false)
  store.transaction((transaction) => {
    transaction.setInstallation(INSTALLATION)
    transaction.setRoot(ROOT)
  })
  store.dispose()
  assert.equal(existsSync(join(directory, 'core.sqlite')), true)

  const database = new DatabaseSync(join(directory, 'core.sqlite'))
  assert.equal(database.prepare('PRAGMA user_version').get().user_version, CORE_SCHEMA_VERSION)
  const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all()
    .map((row) => row.name)
  assert.equal(tables.includes('security_operation_levels'), true)
  assert.equal(tables.includes('security_credential_bindings'), true)
  assert.equal(tables.includes('events'), true)
  assert.equal(tables.includes('security_capability_levels'), false)
  database.close()
})

test('事务真实回滚，禁止嵌套与异步，重开只见已提交状态', (t) => {
  const directory = fixture(t)
  const store = createSqliteSecurityStore(directory)
  assert.throws(() => store.transaction(() => {
    throw new SecurityFailure('io')
  }), failure)
  assert.equal(existsSync(join(directory, 'core.sqlite')), false)

  store.transaction((transaction) => {
    transaction.setInstallation(INSTALLATION)
    transaction.setRoot(ROOT)
    transaction.setCredential(METADATA)
    transaction.setBinding(BINDING)
    transaction.setOperationLevel(LEVEL)
  })
  assert.throws(() => store.transaction((transaction) => {
    transaction.setCredential({ ...METADATA, reference: 'credential:beta', updatedAt: 30 })
    throw new Error('rollback')
  }), failure)
  assert.equal(store.transaction((transaction) => transaction.getCredential(PROFILE, 'credential:beta')), undefined)
  assert.throws(() => store.transaction(() => store.transaction(() => 1)), failure)
  assert.throws(() => store.transaction(() => Promise.resolve(1)), failure)
  store.dispose()

  const reopened = createSqliteSecurityStore(directory)
  assert.equal(reopened.transaction((transaction) => transaction.getCredential(PROFILE, 'credential:alpha')).fields.database, 'app')
  assert.equal(reopened.transaction((transaction) => transaction.getBinding(PROFILE, 'postgres', 'database-auth', 'app')).reference, 'credential:alpha')
  assert.equal(reopened.transaction((transaction) => transaction.getOperationLevel(PROFILE, 'postgres', 'pg.database.register')), 'user')
  reopened.dispose()
})

test('同一 slot 的不同 resourceKey 独立绑定，删除凭据级联绑定', (t) => {
  const directory = fixture(t)
  const store = createSqliteSecurityStore(directory)
  store.transaction((transaction) => {
    transaction.setInstallation(INSTALLATION)
    transaction.setRoot(ROOT)
    transaction.setCredential(METADATA)
    transaction.setBinding(BINDING)
    transaction.setBinding({ ...BINDING, resourceKey: 'reporting', reference: 'credential:alpha' })
  })
  assert.equal(store.transaction((transaction) => transaction.listBindings(PROFILE)).length, 2)
  store.transaction((transaction) => transaction.deleteCredential(PROFILE, 'credential:alpha'))
  assert.equal(store.transaction((transaction) => transaction.listBindings(PROFILE)).length, 0)
  store.dispose()
})

test('Profile 隔离凭据、绑定与 operation 等级', (t) => {
  const directory = fixture(t)
  const store = createSqliteSecurityStore(directory)
  store.transaction((transaction) => {
    transaction.setInstallation(INSTALLATION)
    transaction.setRoot(ROOT)
    transaction.setCredential(METADATA)
    transaction.setCredential({ ...METADATA, profile: 'development' })
    transaction.setBinding(BINDING)
    transaction.setOperationLevel(LEVEL)
  })
  assert.equal(store.transaction((transaction) => transaction.listCredentials('development')).length, 1)
  assert.equal(store.transaction((transaction) => transaction.listCredentials(PROFILE)).length, 1)
  assert.equal(store.transaction((transaction) => transaction.listBindings('development')).length, 0)
  assert.equal(store.transaction((transaction) => transaction.listOperationLevels('development')).length, 0)
  store.dispose()
})

test('未知 schema 版本拒绝打开且不改写原库', (t) => {
  const directory = fixture(t)
  const store = createSqliteSecurityStore(directory)
  store.transaction((transaction) => {
    transaction.setInstallation(INSTALLATION)
    transaction.setRoot(ROOT)
  })
  store.dispose()
  const filename = join(directory, 'core.sqlite')
  const database = new DatabaseSync(filename)
  database.exec('PRAGMA user_version = 99')
  database.close()
  const before = readFileSync(filename)
  assert.throws(() => createSqliteSecurityStore(directory).transaction((transaction) => transaction.getRoot()), failure)
  assert.deepEqual(readFileSync(filename), before)
})

test('损坏的安全行只显式失败，不重建、不泄露秘密', (t) => {
  const directory = fixture(t)
  const store = createSqliteSecurityStore(directory)
  store.transaction((transaction) => {
    transaction.setInstallation(INSTALLATION)
    transaction.setRoot(ROOT)
    transaction.setCredential(METADATA)
  })
  store.dispose()
  const database = new DatabaseSync(join(directory, 'core.sqlite'))
  database.prepare("UPDATE security_credentials SET fields = '{\"host\":42}'").run()
  database.close()
  const reopened = createSqliteSecurityStore(directory)
  assert.throws(() => reopened.transaction((transaction) => transaction.listCredentials(PROFILE)), failure)
  reopened.dispose()
})

test('SQLite 不保存秘密值；公开字段与绑定可重开读取', (t) => {
  const directory = fixture(t)
  const store = createSqliteSecurityStore(directory)
  store.transaction((transaction) => {
    transaction.setInstallation(INSTALLATION)
    transaction.setRoot(ROOT)
    transaction.setCredential({ ...METADATA, fields: { host: 'localhost' } })
    transaction.setBinding(BINDING)
  })
  store.dispose()
  const bytes = readFileSync(join(directory, 'core.sqlite'))
  assert.equal(bytes.includes(Buffer.from(SECRET)), false)
  const reopened = createSqliteSecurityStore(directory)
  assert.equal(reopened.transaction((transaction) => transaction.getCredential(PROFILE, 'credential:alpha')).fields.host, 'localhost')
  reopened.dispose()
})

test('事件表只持久化 CloudEvents 子集，best-effort 查询按 type 与 subject 过滤', (t) => {
  const directory = fixture(t)
  const security = createSqliteSecurityStore(directory)
  security.transaction((transaction) => {
    transaction.setInstallation(INSTALLATION)
    transaction.setRoot(ROOT)
  })
  security.dispose()
  const events = createCoreEventStore(directory)
  const event = {
    specversion: '1.0',
    id: 'one',
    type: 'locus.rt.target.registered',
    source: 'locus://remote-targets',
    subject: 'rt://targets/demo',
    time: new Date().toISOString(),
    data: { target: 'demo' },
  }
  events.append(event)
  events.append({ ...event, id: 'two', type: 'locus.request.succeeded', subject: 'locus://info' })
  assert.equal(events.list({ type: 'locus.rt.target.registered' }).length, 1)
  assert.equal(events.list({ subject: 'locus://info' }).length, 1)
  events.dispose()

  const reopened = createCoreEventStore(directory)
  assert.equal(reopened.list().length, 2)
  assert.deepEqual(reopened.list({ type: 'locus.rt.target.registered' })[0].data, { target: 'demo' })
  reopened.dispose()
  assert.ok(statSync(join(directory, 'core.sqlite')).size > 0)
})

for (const backend of ['memory', 'sqlite']) {
  const openStore = (t) => {
    const directory = backend === 'sqlite' ? mkdtempSync(join(tmpdir(), 'locus-security-parity-')) : undefined
    const store = directory === undefined ? createMemorySecurityStore() : createSqliteSecurityStore(directory)
    t.after(() => {
      store.dispose()
      if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
    })
    return store
  }

  test(`${backend} Store 的资源 key 读写删校验一致，非法记录归存储损坏`, (t) => {
    const store = openStore(t)
    store.transaction((transaction) => {
      transaction.setInstallation(INSTALLATION)
      transaction.setRoot(ROOT)
      transaction.setCredential(METADATA)
    })
    const corrupt = (error) => (
      error instanceof SecurityFailure && error.code === 'security-unavailable' &&
      error.reason === undefined && error.cause === undefined
    )
    for (const resourceKey of ['', ' leading', 'trailing ', 'nul\0key', 'control\nkey', '\u007f', 'x'.repeat(2049)]) {
      for (const action of [
        (transaction) => transaction.setBinding({ ...BINDING, resourceKey }),
        (transaction) => transaction.getBinding(PROFILE, BINDING.componentId, BINDING.slot, resourceKey),
        (transaction) => transaction.deleteBinding(PROFILE, BINDING.componentId, BINDING.slot, resourceKey),
      ]) {
        assert.throws(() => store.transaction(action), corrupt)
      }
    }
    assert.deepEqual(store.transaction((transaction) => transaction.listBindings(PROFILE)), [])
    const boundary = 'x'.repeat(2048)
    store.transaction((transaction) => transaction.setBinding({ ...BINDING, resourceKey: boundary }))
    assert.equal(store.transaction((transaction) => (
      transaction.getBinding(PROFILE, BINDING.componentId, BINDING.slot, boundary)
    )).reference, BINDING.reference)
    store.transaction((transaction) => transaction.deleteBinding(PROFILE, BINDING.componentId, BINDING.slot, boundary))
    assert.deepEqual(store.transaction((transaction) => transaction.listBindings(PROFILE)), [])
  })

  test(`${backend} Store 保持事务寿命、回滚、关联与释放行为一致`, (t) => {
    const store = openStore(t)
    store.transaction((transaction) => {
      transaction.setInstallation(INSTALLATION)
      transaction.setRoot(ROOT)
      transaction.setCredential({ ...METADATA, reference: 'credential:zeta' })
      transaction.setCredential(METADATA)
      for (const resourceKey of ['z', '界', 'a', '😀']) transaction.setBinding({ ...BINDING, resourceKey })
      transaction.setOperationLevel(LEVEL)
    })
    const snapshot = store.transaction((transaction) => ({
      credentials: transaction.listCredentials(PROFILE),
      bindings: transaction.listBindings(PROFILE),
      levels: transaction.listOperationLevels(PROFILE),
    }))
    assert.deepEqual(store.transaction((transaction) => transaction.getRoot()), ROOT)
    assert.deepEqual(store.transaction((transaction) => transaction.getCredential(PROFILE, METADATA.reference)), METADATA)
    assert.deepEqual(snapshot.levels, [LEVEL])
    assert.deepEqual(snapshot.credentials.map((value) => value.reference), ['credential:alpha', 'credential:zeta'])
    assert.deepEqual(snapshot.bindings.map((value) => value.resourceKey), ['a', 'z', '界', '😀'])
    assert.equal(Object.isFrozen(snapshot.credentials[0].fields), true)
    assert.throws(() => store.transaction((transaction) => {
      transaction.deleteCredential(PROFILE, METADATA.reference)
      transaction.setOperationLevel({ ...LEVEL, level: 'root' })
      throw new Error('不得泄露的事务错误')
    }), (error) => error instanceof SecurityFailure && error.code === 'io' && !String(error).includes('不得泄露'))
    assert.deepEqual(store.transaction((transaction) => ({
      credentials: transaction.listCredentials(PROFILE),
      bindings: transaction.listBindings(PROFILE),
      levels: transaction.listOperationLevels(PROFILE),
    })), snapshot)
    assert.throws(() => store.transaction(() => store.transaction(() => undefined)), (error) => error.code === 'io')
    assert.throws(() => store.transaction(() => Promise.resolve()), (error) => error.code === 'io')
    const thenable = Object.assign(() => undefined, { then() {} })
    assert.throws(() => store.transaction(() => thenable), (error) => error.code === 'io')
    const captured = store.transaction((transaction) => transaction)
    assert.throws(() => captured.getRoot(), (error) => error.code === 'io')
    assert.throws(() => captured.setCredential(METADATA), (error) => error.code === 'io')
    assert.throws(() => store.transaction((transaction) => transaction.setBinding({
      ...BINDING, reference: 'credential:missing',
    })), (error) => error.code === 'io')
    store.transaction((transaction) => transaction.deleteCredential(PROFILE, METADATA.reference))
    assert.equal(store.transaction((transaction) => transaction.listBindings(PROFILE)).length, 0)
    store.dispose()
    assert.throws(() => store.transaction((transaction) => transaction.getRoot()), (error) => error.code === 'security-disposed')
  })
}

test('持久绑定中的超长资源 key 按损坏分类且不改写原行', (t) => {
  const directory = fixture(t)
  const store = createSqliteSecurityStore(directory)
  store.transaction((transaction) => {
    transaction.setInstallation(INSTALLATION)
    transaction.setRoot(ROOT)
    transaction.setCredential(METADATA)
    transaction.setBinding(BINDING)
  })
  store.dispose()
  const invalidKey = 'x'.repeat(2049)
  const database = new DatabaseSync(join(directory, 'core.sqlite'))
  database.prepare('UPDATE security_credential_bindings SET resource_key = ?').run(invalidKey)
  database.close()
  const reopened = createSqliteSecurityStore(directory)
  try {
    assert.throws(() => reopened.transaction((transaction) => transaction.listBindings(PROFILE)), (error) => (
      error instanceof SecurityFailure && error.code === 'security-unavailable' && error.reason === undefined
    ))
  } finally {
    reopened.dispose()
  }
  const inspection = new DatabaseSync(join(directory, 'core.sqlite'))
  try {
    assert.equal(inspection.prepare('SELECT resource_key FROM security_credential_bindings').get().resource_key, invalidKey)
  } finally {
    inspection.close()
  }
})
