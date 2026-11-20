import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ProbeResult } from './types.ts'

export interface ProbeStore {
  record(result: ProbeResult): void
  last(targetId: string): ProbeResult | undefined
  remove(targetId: string): void
  dispose(): void
}

/** 运行时状态与配置分离：探测结果写 SQLite，目标定义仍以 YAML 为真源。 */
export function createProbeStore(root: string): ProbeStore {
  const file = join(root, 'state.sqlite')
  let database: DatabaseSync | undefined

  const open = (): DatabaseSync => {
    if (database !== undefined) return database
    mkdirSync(root, { recursive: true })
    database = new DatabaseSync(file)
    database.exec(`
      CREATE TABLE IF NOT EXISTS probe_results (
        target_id TEXT PRIMARY KEY,
        ok INTEGER NOT NULL,
        detail TEXT NOT NULL,
        checked_at TEXT NOT NULL
      )
    `)
    return database
  }

  return {
    record(result) {
      open()
        .prepare(
          `
          INSERT INTO probe_results (target_id, ok, detail, checked_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(target_id) DO UPDATE SET
            ok = excluded.ok,
            detail = excluded.detail,
            checked_at = excluded.checked_at
        `,
        )
        .run(result.targetId, result.ok ? 1 : 0, result.detail, result.checkedAt)
    },
    last(targetId) {
      if (!existsSync(file)) return undefined
      const row = open()
        .prepare('SELECT target_id, ok, detail, checked_at FROM probe_results WHERE target_id = ?')
        .get(targetId)
      if (row === undefined) return undefined
      return {
        targetId: String(row.target_id),
        ok: Number(row.ok) === 1,
        detail: String(row.detail),
        checkedAt: String(row.checked_at),
      }
    },
    remove(targetId) {
      if (!existsSync(file)) return
      open().prepare('DELETE FROM probe_results WHERE target_id = ?').run(targetId)
    },
    dispose() {
      database?.close()
      database = undefined
    },
  }
}
