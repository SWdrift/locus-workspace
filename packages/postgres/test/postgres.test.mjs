import assert from 'node:assert/strict'
import test from 'node:test'
import { InvocationFailure } from '@locus/core/invocation'
import pg from 'pg'
import { component, operations } from '../lib/index.js'

const SECRET = 'postgres-sentinel-secret'
const USERNAME = 'controlled-user'
const HOST = '127.0.0.1'
const PORT = '6543'
const DATABASE = 'controlled'

function operation(id) {
  const found = operations.find((candidate) => candidate.id === id)
  assert.ok(found, `缺少 operation：${id}`)
  return found
}

const register = operation('pg.database.register')
const query = operation('pg.database.query')

/**
 * 只实现被调用字段的 fake context：pathParams 提供 database id，
 * credential.read 用凭据槽字段驱动消费回调，credential.write 捕获写入。
 */
function fakeContext({ id = 'local', values = {}, onWrite } = {}) {
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

const CREDENTIAL_VALUES = {
  host: HOST,
  port: PORT,
  database: DATABASE,
  username: USERNAME,
  password: SECRET,
}

/** pg.Pool 只在 query/end 时触网；替换实例方法以观察驱动参数，禁止真实连接。 */
function fakePool(t, handler = () => ({ rows: [], rowCount: 0 })) {
  const state = { calls: [], options: [], ends: 0 }
  const prototype = pg.Pool.prototype
  const own = {
    query: Object.hasOwn(prototype, 'query'),
    end: Object.hasOwn(prototype, 'end'),
  }
  const original = { query: prototype.query, end: prototype.end }
  prototype.query = async function (sql, values) {
    state.calls.push({ sql, values })
    state.options.push(describe(this.options))
    return handler(this.options, sql, values)
  }
  prototype.end = async function () {
    state.ends += 1
  }
  t.after(() => {
    if (own.query) prototype.query = original.query
    else delete prototype.query
    if (own.end) prototype.end = original.end
    else delete prototype.end
  })
  return state
}

/** 密码在 pg 池选项里是非枚举属性，显式取值并记录可枚举键便于断言目标形状。 */
function describe(options) {
  return {
    host: options.host,
    port: options.port,
    portKey: Object.hasOwn(options, 'port'),
    database: options.database,
    user: options.user,
    password: options.password,
    connectionString: options.connectionString,
  }
}

test('PostgreSQL 只暴露 operation 契约，不携带 capability 声明', () => {
  assert.deepEqual(component.operations.map((metadata) => metadata.id), [
    'pg.database.register',
    'pg.database.query',
  ])
  assert.equal('capabilities' in component, false)
  assert.equal('api' in component, false)
  assert.equal(register.auth, 'root')
  assert.equal(query.auth, 'user')
  assert.equal(register.path, '/:id')
  assert.equal(query.path, '/:id/queries')
  assert.throws(() => register.input.parse({ host: HOST, database: DATABASE, username: USERNAME }))
  assert.throws(() => query.input.parse({}))
  assert.deepEqual(
    register.input.parse({
      host: HOST, port: PORT, database: DATABASE, username: USERNAME, password: SECRET, credential: 'credential:x',
    }),
    { host: HOST, port: PORT, database: DATABASE, username: USERNAME, password: SECRET },
  )
  assert.deepEqual(
    query.input.parse({ sql: 'select 1', values: [], host: HOST, database: DATABASE, credential: 'credential:x' }),
    { sql: 'select 1', values: [] },
  )
})

test('pg.database.register 以 database id 写入 database-auth，port 缺省不写', async () => {
  const context = fakeContext({ id: 'local', onWrite: () => 'credential:local' })
  const result = await register.run(undefined, {
    host: HOST,
    port: PORT,
    database: DATABASE,
    username: USERNAME,
    password: SECRET,
  }, context)

  assert.deepEqual(result, { registered: true, reference: 'credential:local' })
  assert.equal(context.reads.length, 0)
  assert.equal(context.writes.length, 1)
  const [{ credential, key, fields }] = context.writes
  assert.equal(credential.id, 'database-auth')
  assert.deepEqual(credential.secretFields, ['password'])
  assert.equal(credential.declaration.fields.find((field) => field.name === 'host').secret, false)
  assert.equal(credential.declaration.fields.find((field) => field.name === 'port').required, false)
  assert.equal(key, 'local')
  assert.deepEqual({ ...fields }, {
    host: HOST,
    port: PORT,
    database: DATABASE,
    username: USERNAME,
    password: SECRET,
  })

  const withoutPort = fakeContext({ id: 'other' })
  const defaults = await register.run(undefined, {
    host: HOST,
    database: DATABASE,
    username: USERNAME,
    password: SECRET,
  }, withoutPort)
  assert.deepEqual(defaults, { registered: true, reference: 'credential:other' })
  assert.equal(withoutPort.writes[0].key, 'other')
  assert.equal(Object.hasOwn(withoutPort.writes[0].fields, 'port'), false)
  assert.deepEqual({ ...withoutPort.writes[0].fields }, {
    host: HOST,
    database: DATABASE,
    username: USERNAME,
    password: SECRET,
  })
})

test('pg.database.query 从凭据槽取连接目标，不接受 input 指定的目标', async (t) => {
  const pool = fakePool(t, () => ({ rows: [{ user: USERNAME, value: 1 }], rowCount: null }))
  const context = fakeContext({ id: 'local', values: CREDENTIAL_VALUES })
  const parsed = query.input.parse({
    sql: 'select current_user as user, 1 as value',
    values: [],
    host: 'attacker.example',
    port: '1',
    database: 'attacker',
    username: 'attacker',
    password: 'attacker',
    credential: 'credential:other',
  })
  assert.deepEqual(parsed, { sql: 'select current_user as user, 1 as value', values: [] })

  const result = await query.run(undefined, parsed, context)
  assert.deepEqual(result, { rows: [{ user: USERNAME, value: 1 }], rowCount: 1 })
  assert.deepEqual(query.output.parse(result), result)
  assert.equal(context.reads.length, 1)
  assert.equal(context.reads[0].credential.id, 'database-auth')
  assert.equal(context.reads[0].key, 'local')
  assert.equal(context.writes.length, 0)

  assert.equal(pool.calls.length, 1)
  assert.equal(pool.calls[0].sql, 'select current_user as user, 1 as value')
  assert.deepEqual(pool.calls[0].values, [])
  assert.deepEqual(pool.options[0], {
    host: HOST,
    port: Number(PORT),
    portKey: true,
    database: DATABASE,
    user: USERNAME,
    password: SECRET,
    connectionString: undefined,
  })
  assert.equal(pool.ends, 1)
})

test('pg.database.query 在凭据缺少 port 时不传端口，并返回 rowCount 回退值', async (t) => {
  const pool = fakePool(t, () => ({ rows: [{ a: 1 }, { a: 2 }], rowCount: null }))
  const context = fakeContext({
    values: { host: HOST, database: DATABASE, username: USERNAME, password: SECRET },
  })
  const result = await query.run(undefined, { sql: 'select 1' }, context)
  assert.equal(result.rowCount, 2)
  assert.deepEqual(result.rows, [{ a: 1 }, { a: 2 }])
  assert.deepEqual(pool.options[0], {
    host: HOST,
    port: undefined,
    portKey: false,
    database: DATABASE,
    user: USERNAME,
    password: SECRET,
    connectionString: undefined,
  })
  assert.equal(pool.ends, 1)
})

test('pg.database.query 将驱动原生字段转为可 JSON 消费的 DTO', async (t) => {
  const instant = new Date('2026-01-02T03:04:05.000Z')
  const pool = fakePool(t, () => ({
    rows: [{ createdAt: instant, bytes: Buffer.from([1, 2]), nested: { value: true } }],
    rowCount: 1,
  }))
  const result = await query.run(undefined, { sql: 'select native_values' }, fakeContext({ values: CREDENTIAL_VALUES }))
  assert.deepEqual(result, {
    rows: [{
      createdAt: instant.toISOString(),
      bytes: { type: 'Buffer', data: [1, 2] },
      nested: { value: true },
    }],
    rowCount: 1,
  })
  assert.deepEqual(query.output.parse(result), result)
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
  assert.equal(pool.ends, 1)
})

test('pg.database.query 拒绝不完整或非法的凭据字段且不创建连接池', async (t) => {
  const pool = fakePool(t)
  const incomplete = [
    { database: DATABASE, username: USERNAME, password: SECRET },
    { host: HOST, username: USERNAME, password: SECRET },
    { host: HOST, database: DATABASE, password: SECRET },
    { host: HOST, database: DATABASE, username: USERNAME },
  ]
  for (const values of incomplete) {
    await assert.rejects(
      () => query.run(undefined, { sql: 'select 1' }, fakeContext({ values })),
      (error) => error instanceof InvocationFailure && error.code === 'invalid-argument',
    )
  }
  for (const port of ['0', '65536', 'abc', '']) {
    await assert.rejects(
      () => query.run(
        undefined,
        { sql: 'select 1' },
        fakeContext({ values: { ...CREDENTIAL_VALUES, port } }),
      ),
      (error) => error instanceof InvocationFailure && error.code === 'invalid-argument',
    )
  }
  assert.equal(pool.calls.length, 0)
  assert.equal(pool.ends, 0)
})

test('pg.database.query 将驱动失败收为 unavailable 并释放连接池', async (t) => {
  const pool = fakePool(t, () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:6543')
  })
  const context = fakeContext({ values: CREDENTIAL_VALUES })
  await assert.rejects(
    () => query.run(undefined, { sql: 'select 1' }, context),
    (error) => error instanceof InvocationFailure &&
      error.code === 'unavailable' &&
      error.message.includes('ECONNREFUSED') &&
      error.message.includes(SECRET) === false,
  )
  assert.equal(pool.calls.length, 1)
  assert.equal(pool.ends, 1)
})
