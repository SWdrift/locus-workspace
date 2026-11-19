import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openCoreDatabase } from '../storage/database.ts'
import { i18n } from '../i18n/core.ts'
import { InvocationFailure } from '../invocation/errors.ts'
import type { EventFilter, EventStore, LocusEvent } from './types.ts'

const DEFAULT_LIMIT = 1000
const MAX_LIMIT = 10_000

interface EventRow {
  id: string
  type: string
  source: string
  subject: string | null
  time: string
  data: string
}

/** 事件记录是 best-effort 观察数据；缺失记录不能证明操作未发生。 */
export function createCoreEventStore(dataDirectory: string): EventStore {
  const filename = join(dataDirectory, 'core.sqlite')
  let database: DatabaseSync | undefined
  let disposed = false

  function assertActive(): void {
    if (disposed) throw new InvocationFailure('unavailable', i18n.t('event.store-disposed'))
  }

  function connection(): DatabaseSync {
    assertActive()
    database ??= openCoreDatabase(dataDirectory)
    return database
  }

  return {
    append(event) {
      assertActive()
      // 只读请求不得因事件记录创建数据目录；已有库才 best-effort 追加。
      if (!existsSync(filename)) return
      connection()
        .prepare(
          `INSERT INTO events (id, type, source, subject, time, data)
        VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(event.id, event.type, event.source, event.subject ?? null, event.time, JSON.stringify(event.data ?? null))
    },
    list(filter: EventFilter = {}) {
      assertActive()
      if (!existsSync(filename)) return Object.freeze([])
      const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
      const clauses: string[] = []
      const values: string[] = []
      if (filter.type !== undefined) {
        clauses.push('type = ?')
        values.push(filter.type)
      }
      if (filter.subject !== undefined) {
        clauses.push('subject = ?')
        values.push(filter.subject)
      }
      const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
      const rows = connection()
        .prepare(`SELECT id, type, source, subject, time, data FROM events ${where} ORDER BY seq DESC LIMIT ?`)
        .all(...values, limit) as unknown as EventRow[]
      return Object.freeze(rows.reverse().map(rowEvent))
    },
    dispose() {
      if (disposed) return
      disposed = true
      database?.close()
      database = undefined
    },
  }
}

function rowEvent(row: EventRow): LocusEvent {
  return Object.freeze({
    specversion: '1.0' as const,
    id: row.id,
    type: row.type,
    source: row.source,
    ...(row.subject === null ? {} : { subject: row.subject }),
    time: row.time,
    data: JSON.parse(row.data) as unknown,
  })
}
