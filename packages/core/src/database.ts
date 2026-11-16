import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { COMPONENT_SCHEMA } from './schema/component.ts'
import { SECURITY_SCHEMA } from './schema/security.ts'
import { WORKSPACE_SCHEMA } from './schema/workspace.ts'

/** Workspace、组件与安全元数据共用同一个数据库与版本号。 */
export const CORE_SCHEMA_VERSION = 7

const SECURITY_TABLES = [
  'security_installation',
  'security_root_authentication',
  'security_profiles',
  'security_credentials',
  'security_credential_bindings',
  'security_capability_levels',
] as const

const WORKSPACE_COLUMNS = ['id', 'name', 'created_at'] as const
const RELATION_COLUMNS = [
  'id', 'workspace_id', 'kind', 'target_namespace', 'target_id', 'source_kind',
  'source_detail', 'created_at',
] as const
const MOUNT_COLUMNS = ['id', 'workspace_id', 'name', 'name_key', 'path', 'path_key', 'created_at'] as const
const COMPONENT_COLUMNS = [
  'component_id', 'external_state', 'external_detail', 'external_checked_at',
  'deploy_state', 'deploy_detail', 'deploy_checked_at',
] as const
const SECURITY_COLUMNS: Readonly<Record<typeof SECURITY_TABLES[number], readonly string[]>> = {
  security_installation: ['singleton', 'installation_id'],
  security_root_authentication: [
    'singleton', 'generation', 'verifier_version', 'algorithm', 'scrypt_n', 'scrypt_r',
    'scrypt_p', 'scrypt_maxmem', 'salt', 'derived_key', 'failed_attempts', 'locked_until',
    'attempt_id', 'attempt_expires_at',
  ],
  security_profiles: ['name', 'installation_id'],
  security_credentials: ['profile', 'reference', 'provider_id', 'fields', 'created_at', 'updated_at', 'owner_component'],
  security_credential_bindings: [
    'profile', 'component_id', 'capability', 'slot', 'resource_type', 'resource_id',
    'reference', 'created_at', 'updated_at',
  ],
  security_capability_levels: ['profile', 'component_id', 'capability', 'level', 'updated_at'],
}
const INTEGER_SECURITY_COLUMNS = new Set([
  'singleton', 'generation', 'verifier_version', 'scrypt_n', 'scrypt_r', 'scrypt_p',
  'scrypt_maxmem', 'failed_attempts', 'locked_until', 'attempt_expires_at', 'created_at', 'updated_at',
])

/** 建库 DDL 按主题分片在 `src/schema/`，只在初始化新空库时执行。 */
const SCHEMA = `${WORKSPACE_SCHEMA}\n${COMPONENT_SCHEMA}\n${SECURITY_SCHEMA}`

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

function requireTable(database: DatabaseSync, name: string, expected: readonly string[], security = false): void {
  if (!tableExists(database, name)) {
    throw new Error(`数据库缺少 ${name} 表，拒绝在不完整结构上继续`)
  }
  const columns = database.prepare(`PRAGMA table_info(${name})`).all()
  if (columns.length !== expected.length || columns.some((column, index) => (
    column.name !== expected[index] ||
    column.type !== (security && INTEGER_SECURITY_COLUMNS.has(String(column.name)) ? 'INTEGER' : 'TEXT')
  ))) {
    throw new Error(`数据库 ${name} 表结构冲突，拒绝使用未知结构`)
  }
}

function requireCurrentTables(database: DatabaseSync): void {
  requireTable(database, 'workspaces', WORKSPACE_COLUMNS)
  requireTable(database, 'relations', RELATION_COLUMNS)
  requireTable(database, 'mounts', MOUNT_COLUMNS)
  requireTable(database, 'component_states', COMPONENT_COLUMNS)
  for (const table of SECURITY_TABLES) {
    requireTable(database, table, SECURITY_COLUMNS[table], true)
  }
}

/** 开发阶段不做旧结构迁移；版本不符时要求备份后重建数据目录，不覆盖未知数据。 */
export function openCoreDatabase(dataDirectory: string): DatabaseSync {
  const filename = join(dataDirectory, 'core.sqlite')
  mkdirSync(dataDirectory, { recursive: true })
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(filename, { timeout: 1000, enableForeignKeyConstraints: true })
    checkIntegrity(database)
    const version = database.prepare('PRAGMA user_version').get()?.user_version
    if (version === 0) {
      if (database.prepare('SELECT name FROM sqlite_schema').all().length !== 0) {
        throw new Error('仅初始化新空库，拒绝修改已有数据库结构')
      }
      database.exec('PRAGMA journal_mode = DELETE')
      database.exec('PRAGMA synchronous = FULL')
      transaction(database, true, () => {
        const current = database!.prepare('PRAGMA user_version').get()?.user_version
        if (current !== 0 || database!.prepare('SELECT name FROM sqlite_schema').all().length !== 0) {
          throw new Error(`拒绝初始化非空或未知版本数据库：${String(current)}`)
        }
        database!.exec(`${SCHEMA}PRAGMA user_version = ${CORE_SCHEMA_VERSION};`)
      })
    } else if (version !== CORE_SCHEMA_VERSION) {
      throw new Error(
        `数据库结构版本 ${String(version)} 与当前 ${CORE_SCHEMA_VERSION} 不兼容；开发阶段不迁移旧结构，请备份后重建数据目录`,
      )
    }
    if (database.prepare('PRAGMA journal_mode = DELETE').get()?.journal_mode !== 'delete') {
      throw new Error('数据库无法采用 journal_mode=DELETE')
    }
    database.exec('PRAGMA synchronous = FULL')
    requireCurrentTables(database)
    return database
  } catch (error) {
    database?.close()
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`无法打开 Core 数据库 ${filename}：${detail}`, { cause: error })
  }
}
