import assert from 'node:assert/strict'
import test from 'node:test'
import { SESSION_NAMESPACE_PREFIX } from '../../../packages/contracts/lib/index.js'
import { createSessionService } from '../lib/index.js'

const source = { home: 'C:/tmp/locus-dsh', label: 'locus' }

function header(id, overrides = {}) {
  return {
    version: 4,
    id,
    createdAt: 1_700_000_000_000,
    isSeeded: false,
    ...overrides,
  }
}

function record(id, overrides = {}) {
  return {
    header: header(id),
    live: true,
    persisted: true,
    ...overrides,
  }
}

function queryFor(records, { title, listError, filterError } = {}) {
  const calls = { list: 0, filter: 0, title: 0 }
  return {
    calls,
    async listSessions() {
      calls.list++
      if (listError) throw listError
      return records
    },
    async filterSessions() {
      calls.filter++
      if (filterError) throw filterError
      return records
    },
    async readTitleSnapshot(sessionId) {
      calls.title++
      if (title === 'error') throw new Error('title unavailable')
      return {
        session: header(sessionId),
        ...(title === undefined ? {} : { title: { title, messageSeqs: [], source: { kind: 'user' }, eventSeq: 1, updatedAt: 1 } }),
      }
    },
  }
}

test('discover 只映射元信息并分别保留 live 与 persisted', async () => {
  const query = queryFor([
    record('session-live'),
    record('session-cold', { live: false, header: header('session-cold', { cwd: 'C:/work', parentSession: 'session-live' }) }),
  ])
  const service = createSessionService({ query: () => query, source })
  const sessions = await service.discover()

  assert.equal(sessions.length, 2)
  assert.equal(sessions[0].state, 'live')
  assert.equal(sessions[0].live, true)
  assert.equal(sessions[0].persisted, true)
  assert.equal(sessions[1].state, 'persisted')
  assert.equal(sessions[1].live, false)
  assert.equal(sessions[1].cwd, 'C:/work')
  assert.equal(sessions[1].parentSessionId, 'session-live')
  assert.equal(sessions[1].reference.namespace, `${SESSION_NAMESPACE_PREFIX}${service.source.id}`)
  assert.equal(sessions[1].reference.id, 'session-cold')
  assert.equal(sessions[1].createdAt, new Date(1_700_000_000_000).toISOString())
  assert.equal('events' in sessions[1], false)
})

test('inspect 按当前来源读取标题；查询失败不伪造可访问性', async () => {
  const query = queryFor([record('session-a')], { title: '修复 Session 查询' })
  const service = createSessionService({ query: () => query, source })
  const inspected = await service.inspect('session-a')
  assert.equal(inspected.state, 'live')
  assert.equal(inspected.title, '修复 Session 查询')
  assert.equal(inspected.error, undefined)

  const failed = createSessionService({
    query: () => queryFor([], { filterError: Object.assign(new Error('database locked'), { code: 'SESSION_QUERY_PERSISTENCE_FAILED' }) }),
    source,
  })
  const unavailable = await failed.inspect('session-a')
  assert.equal(unavailable.state, 'unavailable')
  assert.match(unavailable.error, /SESSION_QUERY_PERSISTENCE_FAILED/)
  assert.match(unavailable.error, /database locked/)

  const titleFailure = createSessionService({ query: () => queryFor([record('session-a')], { title: 'error' }), source })
  const partial = await titleFailure.inspect('session-a')
  assert.equal(partial.state, 'live')
  assert.equal(partial.title, undefined)
  assert.match(partial.error, /标题/)
})

test('查询服务缺失时 discover 失败，inspect 仍返回可解释的不可用状态', async () => {
  const service = createSessionService({ query: () => undefined, source })
  assert.equal((await service.availability()).available, false)
  await assert.rejects(service.discover(), /Session 能力不可用/)
  const inspected = await service.inspect('session-a')
  assert.equal(inspected.state, 'unavailable')
  assert.match(inspected.error, /ctx\.sessionQuery/)
  const opened = await service.open(service.reference('session-a'))
  assert.equal(opened.mode, 'unavailable')
})

test('来源标识进入命名空间；其他来源的关联不查询当前语料库', async () => {
  const query = queryFor([record('session-a')])
  const service = createSessionService({ query: () => query, source })
  const reference = service.reference('session-a')
  assert.equal(reference.namespace, `${SESSION_NAMESPACE_PREFIX}${service.source.id}`)

  const foreign = await service.inspectReference({ namespace: `${SESSION_NAMESPACE_PREFIX}other`, id: 'session-a' })
  assert.equal(foreign.state, 'unavailable')
  assert.match(foreign.error, /其他 DSH 数据目录/)
  assert.equal(query.calls.filter, 0)

  assert.throws(() => service.reference(''), /必须是非空字符串/)
  await assert.rejects(service.inspectReference({ namespace: 'locus.workspace', id: 'x' }), /不是 Session 引用/)
})

test('open 只在可可靠继续时给出原生 headless 入口', async () => {
  const live = createSessionService({ query: () => queryFor([record('session-a')]), source })
  assert.equal((await live.open(live.reference('session-a'))).mode, 'live')

  const persistedRecord = record('session-a', { live: false, header: header('session-a', { cwd: 'C:/work' }) })
  const cold = createSessionService({ query: () => queryFor([persistedRecord]), source })
  const opened = await cold.open(cold.reference('session-a'))
  assert.equal(opened.mode, 'native')
  assert.deepEqual(opened.command, ['dsh', '--profile', 'headless', '--session-id', 'session-a'])
  assert.equal(opened.cwd, 'C:/work')

  const noCwd = createSessionService({
    query: () => queryFor([record('session-a', { live: false })]),
    source,
  })
  assert.equal((await noCwd.open(noCwd.reference('session-a'))).mode, 'unavailable')

  const fork = createSessionService({
    query: () => queryFor([record('session-a', {
      live: false,
      header: header('session-a', { cwd: 'C:/work', isSeeded: true }),
    })]),
    source,
  })
  assert.equal((await fork.open(fork.reference('session-a'))).mode, 'unavailable')
})
