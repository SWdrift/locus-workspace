import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Workspace 与组件状态共用同一个数据库与版本号。 */
export const CORE_SCHEMA_VERSION = 3

const SCHEMA_V1 = `
  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE relations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    kind TEXT NOT NULL CHECK (kind IN ('member', 'association')),
    target_namespace TEXT NOT NULL CHECK (length(trim(target_namespace)) > 0),
    target_id TEXT NOT NULL CHECK (length(trim(target_id)) > 0),
    source_kind TEXT NOT NULL CHECK (source_kind IN ('manual', 'discovery')),
    source_detail TEXT NOT NULL CHECK (length(trim(source_detail)) > 0),
    created_at TEXT NOT NULL,
    UNIQUE (workspace_id, kind, target_namespace, target_id)
  ) STRICT;
`
const SCHEMA_V2 = `
  CREATE TABLE mounts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    name_key TEXT NOT NULL CHECK (length(trim(name_key)) > 0),
    path TEXT NOT NULL CHECK (length(trim(path)) > 0),
    path_key TEXT NOT NULL CHECK (length(trim(path_key)) > 0),
    created_at TEXT NOT NULL,
    UNIQUE (workspace_id, name_key),
    UNIQUE (workspace_id, path_key)
  ) STRICT;
`
const SCHEMA_V3 = `
  CREATE TABLE component_states (
    component_id TEXT PRIMARY KEY CHECK (length(trim(component_id)) > 0),
    external_state TEXT CHECK (
      external_state IS NULL OR external_state IN ('healthy', 'stopped', 'abnormal', 'absent')
    ),
    external_detail TEXT NOT NULL DEFAULT '',
    external_checked_at TEXT,
    deploy_state TEXT CHECK (
      deploy_state IS NULL OR deploy_state IN ('deployed', 'failed', 'not-deployed', 'not-deployable')
    ),
    deploy_detail TEXT NOT NULL DEFAULT '',
    deploy_checked_at TEXT
  ) STRICT;
`

/** 读取使用同一快照，写入先取得写锁；提交失败也不能报告成功。 */
function transaction<T>(database: DatabaseSync, write: boolean, action: () => T): T {
  database.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN')
  try {
    const result = action()
    database.exec('COMMIT')
    return result
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], '数据库事务失败，且无法回滚')
    }
    throw error
  }
}

function checkIntegrity(database: DatabaseSync): void {
  const rows = database.prepare('PRAGMA integrity_check').all()
  if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') {
    throw new Error(`数据库完整性检查失败：${rows.map((row) => row.integrity_check).join('; ')}`)
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length !== 0) {
    throw new Error('数据库外键完整性检查失败')
  }
}

function tableExists(database: DatabaseSync, name: string): boolean {
  return database
    .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")
    .get(name) !== undefined
}

function requireTable(database: DatabaseSync, name: string): void {
  if (!tableExists(database, name)) {
    throw new Error(`数据库缺少 ${name} 表，拒绝在不完整结构上继续`)
  }
}

function migrate(database: DatabaseSync, version: number): void {
  transaction(database, true, () => {
    const current = database.prepare('PRAGMA user_version').get()?.user_version
    if (current === CORE_SCHEMA_VERSION) return
    if (current !== version) {
      throw new Error(`数据库版本在迁移期间变化：${String(current)}，预期 ${version}`)
    }
    if (current === 1) {
      if (tableExists(database, 'mounts')) {
        throw new Error('数据库版本为 1，但已存在 mounts 表；拒绝覆盖未知结构')
      }
      database.exec(SCHEMA_V2)
    }
    if (current === 1 || current === 2) {
      if (tableExists(database, 'component_states')) {
        throw new Error('数据库版本低于 3，但已存在 component_states 表；拒绝覆盖未知结构')
      }
      database.exec(SCHEMA_V3)
      database.exec(`PRAGMA user_version = ${CORE_SCHEMA_VERSION}`)
      return
    }
    throw new Error(`不支持的数据库版本 ${String(current)}，仅支持从 1 或 2 迁移`)
  })
}

/** 打开 `core.sqlite`；首次打开负责建立或迁移到当前结构。 */
export function openCoreDatabase(dataDirectory: string): DatabaseSync {
  const filename = join(dataDirectory, 'core.sqlite')
  mkdirSync(dataDirectory, { recursive: true })
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(filename, { timeout: 1000, enableForeignKeyConstraints: true })
    checkIntegrity(database)
    const version = database.prepare('PRAGMA user_version').get()?.user_version
    if (version !== 0 && version !== 1 && version !== 2 && version !== CORE_SCHEMA_VERSION) {
      throw new Error(
        `不支持的数据库版本 ${String(version)}，当前支持 ${CORE_SCHEMA_VERSION}；仅支持从 1 或 2 迁移`,
      )
    }
    if (version === 0 && database.prepare('SELECT name FROM sqlite_schema').all().length !== 0) {
      throw new Error('仅初始化新空库，拒绝修改已有数据库结构')
    }
    if (database.prepare('PRAGMA journal_mode = DELETE').get()?.journal_mode !== 'delete') {
      throw new Error('数据库无法采用 journal_mode=DELETE')
    }
    database.exec('PRAGMA synchronous = FULL')
    if (version === 0) {
      const initializingDatabase = database
      transaction(initializingDatabase, true, () => {
        const currentVersion = initializingDatabase.prepare('PRAGMA user_version').get()?.user_version
        if (currentVersion === CORE_SCHEMA_VERSION) return
        if (currentVersion !== 0 || initializingDatabase.prepare('SELECT name FROM sqlite_schema').all().length !== 0) {
          throw new Error(`拒绝初始化非空或未知版本数据库：${String(currentVersion)}`)
        }
        initializingDatabase.exec(
          `${SCHEMA_V1}${SCHEMA_V2}${SCHEMA_V3}PRAGMA user_version = ${CORE_SCHEMA_VERSION};`,
        )
      })
    } else if (version < CORE_SCHEMA_VERSION) {
      migrate(database, version)
    }
    requireTable(database, 'mounts')
    requireTable(database, 'component_states')
    return database
  } catch (error) {
    database?.close()
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`无法打开 Core 数据库 ${filename}：${detail}`, { cause: error })
  }
}
