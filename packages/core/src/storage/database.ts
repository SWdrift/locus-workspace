import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { i18n } from '../i18n/core.ts'
import { COMPONENT_SCHEMA } from './schema/component.ts'
import { EVENTS_SCHEMA } from './schema/events.ts'
import { SECURITY_SCHEMA } from './schema/security.ts'
import { WORKSPACE_SCHEMA } from './schema/workspace.ts'

/** Workspace、组件与安全元数据共用同一个数据库与版本号。 */
export const CORE_SCHEMA_VERSION = 9

const SECURITY_TABLES = [
  'security_installation',
  'security_root_authentication',
  'security_profiles',
  'security_credentials',
  'security_credential_bindings',
  'security_operation_levels',
] as const

const WORKSPACE_COLUMNS = ['id', 'name', 'created_at', 'name_key', 'description'] as const
const RELATION_COLUMNS = [
  'id',
  'workspace_id',
  'kind',
  'target_namespace',
  'target_id',
  'source_kind',
  'source_detail',
  'created_at',
] as const
const MOUNT_COLUMNS = [
  'id',
  'workspace_id',
  'name',
  'name_key',
  'path',
  'path_key',
  'created_at',
  'is_primary',
] as const
const COMPONENT_COLUMNS = [
  'component_id',
  'external_state',
  'external_detail',
  'external_checked_at',
  'deploy_state',
  'deploy_detail',
  'deploy_checked_at',
] as const
const EVENTS_COLUMNS = ['seq', 'id', 'type', 'source', 'subject', 'time', 'data'] as const
const SECURITY_COLUMNS: Readonly<Record<(typeof SECURITY_TABLES)[number], readonly string[]>> = {
  security_installation: ['singleton', 'installation_id'],
  security_root_authentication: [
    'singleton',
    'generation',
    'verifier_version',
    'algorithm',
    'scrypt_n',
    'scrypt_r',
    'scrypt_p',
    'scrypt_maxmem',
    'salt',
    'derived_key',
    'failed_attempts',
    'locked_until',
    'attempt_id',
    'attempt_expires_at',
  ],
  security_profiles: ['name', 'installation_id'],
  security_credentials: [
    'profile',
    'reference',
    'provider_id',
    'fields',
    'created_at',
    'updated_at',
    'owner_component',
  ],
  security_credential_bindings: [
    'profile',
    'component_id',
    'slot',
    'resource_key',
    'reference',
    'created_at',
    'updated_at',
  ],
  security_operation_levels: ['profile', 'component_id', 'operation', 'level', 'updated_at'],
}
const INTEGER_COLUMNS: Readonly<Record<string, true>> = {
  singleton: true,
  generation: true,
  verifier_version: true,
  scrypt_n: true,
  scrypt_r: true,
  scrypt_p: true,
  scrypt_maxmem: true,
  failed_attempts: true,
  locked_until: true,
  attempt_expires_at: true,
  created_at: true,
  updated_at: true,
  is_primary: true,
}
const EVENT_INTEGER_COLUMNS: Readonly<Record<string, true>> = { seq: true }

/** 建库 DDL 按主题分片在 `storage/schema/`，只在初始化新空库时执行。 */
const SCHEMA = `${WORKSPACE_SCHEMA}\n${COMPONENT_SCHEMA}\n${SECURITY_SCHEMA}\n${EVENTS_SCHEMA}`

/** 运行时不做自动迁移；版本不符时要求先备份并执行当前一跳迁移，不覆盖未知数据。 */
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
        throw new Error(i18n.t('storage.init-empty-only'))
      }
      database.exec('PRAGMA journal_mode = DELETE')
      database.exec('PRAGMA synchronous = FULL')
      transaction(database, true, () => {
        const current = database!.prepare('PRAGMA user_version').get()?.user_version
        if (current !== 0 || database!.prepare('SELECT name FROM sqlite_schema').all().length !== 0) {
          throw new Error(i18n.t('storage.init-version-refused', { version: String(current) }))
        }
        database!.exec(`${SCHEMA}PRAGMA user_version = ${CORE_SCHEMA_VERSION};`)
      })
    } else if (version !== CORE_SCHEMA_VERSION) {
      throw new Error(
        i18n.t('storage.version-mismatch', {
          version: String(version),
          current: CORE_SCHEMA_VERSION,
        }),
      )
    }
    if (database.prepare('PRAGMA journal_mode = DELETE').get()?.journal_mode !== 'delete') {
      throw new Error(i18n.t('storage.journal-mode'))
    }
    database.exec('PRAGMA synchronous = FULL')
    requireCurrentTables(database)
    return database
  } catch (error) {
    database?.close()
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(i18n.t('storage.open-failed', { file: filename, detail }), { cause: error })
  }
}

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
      throw new AggregateError([error, rollbackError], i18n.t('storage.transaction-failed'))
    }
    throw error
  }
}

function checkIntegrity(database: DatabaseSync): void {
  const rows = database.prepare('PRAGMA integrity_check').all()
  if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') {
    throw new Error(
      i18n.t('storage.integrity-failed', {
        detail: rows.map(row => row.integrity_check).join('; '),
      }),
    )
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length !== 0) {
    throw new Error(i18n.t('storage.foreign-key-failed'))
  }
}

function tableExists(database: DatabaseSync, name: string): boolean {
  return database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name) !== undefined
}

function requireTable(
  database: DatabaseSync,
  name: string,
  expected: readonly string[],
  integerColumns: Readonly<Record<string, true>> = {},
): void {
  if (!tableExists(database, name)) {
    throw new Error(i18n.t('storage.table-missing', { table: name }))
  }
  const columns = database.prepare(`PRAGMA table_info(${name})`).all()
  if (
    columns.length !== expected.length ||
    columns.some(
      (column, index) =>
        column.name !== expected[index] ||
        column.type !== (integerColumns[String(column.name)] === true ? 'INTEGER' : 'TEXT'),
    )
  ) {
    throw new Error(i18n.t('storage.table-conflict', { table: name }))
  }
}

function requireCurrentTables(database: DatabaseSync): void {
  requireTable(database, 'workspaces', WORKSPACE_COLUMNS)
  requireTable(database, 'relations', RELATION_COLUMNS)
  requireTable(database, 'mounts', MOUNT_COLUMNS, { is_primary: true })
  requireTable(database, 'component_states', COMPONENT_COLUMNS)
  requireTable(database, 'events', EVENTS_COLUMNS, EVENT_INTEGER_COLUMNS)
  for (const table of SECURITY_TABLES) {
    requireTable(database, table, SECURITY_COLUMNS[table], INTEGER_COLUMNS)
  }
}
