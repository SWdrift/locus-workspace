import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createLocusCore, createMemoryCredentialProvider, createMemorySecurityStore, SecurityFailure } from '@locus/core'
import { api, component, createPostgresPool } from '../lib/index.js'

const PASSWORD = 'isolated-root-password'
const SECRET = 'postgres-sentinel-secret'
const USERNAME = 'controlled-user'
const HOST = '127.0.0.1'
const PORT = '6543'
const DATABASE = 'controlled'
const REFERENCE = 'credential:postgres-local'
const SLOT = 'database-auth'
const RESOURCE = { type: 'database', id: 'local' }

function request(capability) {
  return { capability, resource: RESOURCE, parameters: null }
}

/** register 是 root 能力：先捕获挑战，认证后由 Core 恢复同一闭包。 */
async function register(host) {
  const session = host.createSession('agent')
  const port = host.bindComponent(session, component)
  let challenge
  try {
    await port.execute(request('register'), (context) => api.register(context, {
      credential: REFERENCE, host: HOST, port: PORT, database: DATABASE, username: USERNAME, password: SECRET,
    }))
  } catch (error) {
    if (error.code !== 'authentication-required') throw error
    challenge = error.challenge
  }
  assert.ok(challenge)
  assert.deepEqual(await host.resume(await host.authenticate(challenge, PASSWORD)), { registered: true })
  return { session, port }
}

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-postgres-'))
  let host
  const core = createLocusCore({
    dataDirectory: join(root, 'data'), components: [component],
    security: { store: createMemorySecurityStore(), provider: createMemoryCredentialProvider(), receiveHost(value) { host = value } },
  })
  t.after(async () => { await core.dispose(); rmSync(root, { recursive: true, force: true }) })
  await host.initializeRoot(PASSWORD, PASSWORD)
  return { core, host }
}

test('PostgreSQL 目标与驱动参数来自 Core 绑定，不构造密码 URL，dispose 清除可控引用', async (t) => {
  const setup = await fixture(t)
  const { session, port } = await register(setup.host)
  const management = setup.host.forSession(session)
  const bindings = (await management.listBindings()).map(({ capability, slot, resource, reference }) => ({ capability, slot, resource, reference }))
  bindings.sort((left, right) => left.capability.localeCompare(right.capability))
  assert.deepEqual(bindings, [
    { capability: 'list', slot: SLOT, resource: RESOURCE, reference: REFERENCE },
    { capability: 'register', slot: SLOT, resource: RESOURCE, reference: REFERENCE },
  ])
  const metadata = (await management.listCredentials()).find((item) => item.reference === REFERENCE)
  assert.ok(metadata)
  assert.deepEqual({ ...metadata.fields }, {
    host: HOST, port: PORT, database: DATABASE, username: USERNAME,
  })

  let owned
  const lease = await port.execute(request('list'), (context) => createPostgresPool(
    context, SLOT, REFERENCE,
    (parameters) => {
      owned = parameters
      return { async end() {} }
    },
  ))
  assert.deepEqual({ ...owned }, {
    host: HOST, port: Number(PORT), database: DATABASE, user: USERNAME, password: SECRET,
  })
  assert.equal('connectionString' in owned, false)
  assert.equal(leasedConnectionString(lease.pool), undefined)
  await lease.dispose()
  assert.equal(owned.password, '')
  assert.throws(() => lease.pool, (error) => error instanceof SecurityFailure && error.code === 'delivery-failed')
})

function leasedConnectionString(pool) {
  return pool.connectionString
}

test('调用方不能改用其他 CredentialRef', async (t) => {
  const setup = await fixture(t)
  const { port } = await register(setup.host)
  await assert.rejects(
    () => port.execute(request('list'), (context) => createPostgresPool(
      context, SLOT, 'credential:other', () => assert.fail('不应创建连接池'),
    )),
    (error) => error.code === 'access-denied' && error.reason === 'credential-binding-mismatch',
  )
})

test('调用方不能再指定连接目标', async (t) => {
  const setup = await fixture(t)
  const { port } = await register(setup.host)
  let observed
  const lease = await port.execute(request('list'), (context) => createPostgresPool(
    context, SLOT, REFERENCE,
    (parameters) => {
      observed = parameters
      return { async end() {} }
    },
  ))
  assert.equal(observed.host, HOST)
  assert.equal(observed.port, Number(PORT))
  assert.equal(observed.database, DATABASE)
  await lease.dispose()
})
