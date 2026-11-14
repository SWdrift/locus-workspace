import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openCoreDatabase } from '../database.ts'
import type { DeployState, ExternalState } from './spec.ts'

export interface ComponentStateRow {
  readonly externalState: ExternalState | null
  readonly externalDetail: string
  readonly externalCheckedAt: string | null
  readonly deployState: DeployState | null
  readonly deployDetail: string
  readonly deployCheckedAt: string | null
}

export interface ComponentStateStore {
  read(componentId: string): ComponentStateRow | undefined
  recordExternal(componentId: string, state: ExternalState, detail: string, checkedAt: string): void
  recordDeploy(componentId: string, state: DeployState, detail: string, checkedAt: string): void
  remove(componentId: string): void
  dispose(): void
}

interface StateDatabaseRow {
  external_state: ExternalState | null
  external_detail: string
  external_checked_at: string | null
  deploy_state: DeployState | null
  deploy_detail: string
  deploy_checked_at: string | null
}

/** 状态与定义分离：定义在文件里，观察结果写 `core.sqlite`。 */
export function createComponentStateStore(dataDirectory: string): ComponentStateStore {
  const file = join(dataDirectory, 'core.sqlite')
  let database: DatabaseSync | undefined

  function getDatabase(): DatabaseSync {
    database ??= openCoreDatabase(dataDirectory)
    return database
  }

  return {
    read(componentId) {
      // 读取不创建数据库：只有定义文件时，状态就是“未探查”。
      if (!existsSync(file)) return undefined
      const row = getDatabase()
        .prepare(
          `SELECT external_state, external_detail, external_checked_at,
                  deploy_state, deploy_detail, deploy_checked_at
           FROM component_states WHERE component_id = ?`,
        )
        .get(componentId) as unknown as StateDatabaseRow | undefined
      if (row === undefined) return undefined
      return {
        externalState: row.external_state,
        externalDetail: row.external_detail,
        externalCheckedAt: row.external_checked_at,
        deployState: row.deploy_state,
        deployDetail: row.deploy_detail,
        deployCheckedAt: row.deploy_checked_at,
      }
    },
    recordExternal(componentId, state, detail, checkedAt) {
      getDatabase()
        .prepare(
          `INSERT INTO component_states
             (component_id, external_state, external_detail, external_checked_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(component_id) DO UPDATE SET
             external_state = excluded.external_state,
             external_detail = excluded.external_detail,
             external_checked_at = excluded.external_checked_at`,
        )
        .run(componentId, state, detail, checkedAt)
    },
    recordDeploy(componentId, state, detail, checkedAt) {
      getDatabase()
        .prepare(
          `INSERT INTO component_states (component_id, deploy_state, deploy_detail, deploy_checked_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(component_id) DO UPDATE SET
             deploy_state = excluded.deploy_state,
             deploy_detail = excluded.deploy_detail,
             deploy_checked_at = excluded.deploy_checked_at`,
        )
        .run(componentId, state, detail, checkedAt)
    },
    remove(componentId) {
      if (!existsSync(file)) return
      getDatabase().prepare('DELETE FROM component_states WHERE component_id = ?').run(componentId)
    },
    dispose() {
      database?.close()
      database = undefined
    },
  }
}
