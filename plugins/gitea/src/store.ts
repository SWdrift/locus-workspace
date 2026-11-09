import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SQLOutputValue, StatementSync } from 'node:sqlite'
import type {
  GiteaInstance,
  GiteaInstanceInput,
  GiteaInstanceUpdate,
} from '@locus/contracts'

interface InstanceRow {
  id: string
  name: string
  base_url: string
  credential_ref: string
  created_at: string
  updated_at: string
}

interface Connection {
  readonly database: DatabaseSync
  readonly byId: StatementSync
  readonly byName: StatementSync
  readonly byBaseUrl: StatementSync
  readonly listAll: StatementSync
  readonly insert: StatementSync
  readonly update: StatementSync
  readonly remove: StatementSync
}

const COLUMNS = 'id, name, base_url, credential_ref, created_at, updated_at'
const SCHEMA_VERSION = 1
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} 必须是字符串`)
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`${field} 必须是非空字符串`)
  if (value.includes('\0')) throw new Error(`${field} 不能包含 NUL 字符`)
  return trimmed
}

function requireName(value: unknown): string {
  const name = requireText(value, 'Gitea 实例名称')
  if (/[\p{Cc}]/u.test(name)) throw new Error('Gitea 实例名称不能包含控制字符')
  return name
}

function normalizeBaseUrl(value: unknown): string {
  const input = requireText(value, 'Gitea 实例地址')
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('Gitea 实例地址必须是有效 URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Gitea 实例地址只支持 http 或 https')
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('Gitea 实例地址不能包含用户名或密码')
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('Gitea 实例地址不能包含查询参数或 fragment')
  }
  const pathname = url.pathname.replace(/\/+$/, '')
  return `${url.origin}${pathname === '/' ? '' : pathname}`
}

function normalizeCredentialRef(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error('Gitea 凭据引用必须是字符串')
  const reference = value.trim()
  if (reference.length === 0) return ''
  if (!CREDENTIAL_REF.test(reference)) {
    throw new Error('Gitea 凭据引用必须是 POSIX 环境/凭据名称；不保存 Token 明文')
  }
  return reference
}

function normalizeInstance(input: GiteaInstanceInput): {
  name: string
  baseUrl: string
  credentialRef: string
} {
  return {
    name: requireName(input.name),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    credentialRef: normalizeCredentialRef(input.credentialRef),
  }
}

function instanceFromRow(row: InstanceRow): GiteaInstance {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    ...(row.credential_ref === '' ? {} : { credentialRef: row.credential_ref }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function decodeRow(row: Record<string, SQLOutputValue>): InstanceRow {
  const { id, name, base_url, credential_ref, created_at, updated_at } = row
  if (
    typeof id !== 'string' || typeof name !== 'string' ||
    typeof base_url !== 'string' || typeof credential_ref !== 'string' ||
    typeof created_at !== 'string' || typeof updated_at !== 'string'
  ) {
    throw new Error('Gitea 实例记录格式损坏，已保留原数据')
  }
  return { id, name, base_url, credential_ref, created_at, updated_at }
}

function transaction<T>(database: DatabaseSync, action: () => T): T {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = action()
    database.exec('COMMIT')
    return result
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Gitea 事务失败，且无法回滚')
    }
    throw error
  }
}

/** 只保存实例访问配置；仓库、Workflow 与 Run 都是按需观察，不复制历史。 */
export class GiteaStore {
  private connection: Connection | undefined

  constructor(private readonly dataDirectory: string) {}

  private open(): Connection {
    if (this.connection) return this.connection
    mkdirSync(this.dataDirectory, { recursive: true })
    const filename = join(this.dataDirectory, 'gitea.sqlite')
    let database: DatabaseSync | undefined
    try {
      database = new DatabaseSync(filename, { timeout: 1000 })
      const integrity = database.prepare('PRAGMA integrity_check').all()
      if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
        throw new Error('Gitea 数据库完整性检查失败，已保留原数据')
      }
      const version = database.prepare('PRAGMA user_version').get()?.user_version
      const objects = database.prepare('SELECT name FROM sqlite_schema').all()
      if (version !== SCHEMA_VERSION) {
        if (version !== 0 || objects.length !== 0) {
          throw new Error(
            version === 0
              ? 'Gitea 数据库已有结构但无版本，拒绝覆盖；请备份后手工处理'
              : `Gitea 数据格式版本 ${String(version)} 不受支持，需要版本 ${SCHEMA_VERSION}；已保留原数据`,
          )
        }
      }
      if (database.prepare('PRAGMA journal_mode = DELETE').get()?.journal_mode !== 'delete') {
        throw new Error('Gitea 数据库无法采用 journal_mode=DELETE')
      }
      database.exec('PRAGMA synchronous = FULL')
      if (version === 0) {
        transaction(database, () => {
          const current = database?.prepare('PRAGMA user_version').get()?.user_version
          if (current === SCHEMA_VERSION) return
          if (current !== 0 || database?.prepare('SELECT name FROM sqlite_schema').all().length !== 0) {
            throw new Error('拒绝初始化已有结构或未知版本的 Gitea 数据库')
          }
          database?.exec(`
            CREATE TABLE instances (
              id TEXT PRIMARY KEY NOT NULL,
              name TEXT NOT NULL CHECK (length(trim(name)) > 0),
              base_url TEXT NOT NULL CHECK (length(trim(base_url)) > 0),
              credential_ref TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE (name),
              UNIQUE (base_url)
            ) STRICT;
            PRAGMA user_version = ${SCHEMA_VERSION};
          `)
        })
      }
      const connection: Connection = {
        database,
        byId: database.prepare(`SELECT ${COLUMNS} FROM instances WHERE id = ?`),
        byName: database.prepare(`SELECT ${COLUMNS} FROM instances WHERE name = ?`),
        byBaseUrl: database.prepare(`SELECT ${COLUMNS} FROM instances WHERE base_url = ?`),
        listAll: database.prepare(`SELECT ${COLUMNS} FROM instances ORDER BY rowid`),
        insert: database.prepare(`INSERT INTO instances (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`),
        update: database.prepare(
          'UPDATE instances SET name = ?, base_url = ?, credential_ref = ?, updated_at = ? WHERE id = ?',
        ),
        remove: database.prepare('DELETE FROM instances WHERE id = ?'),
      }
      this.connection = connection
      return connection
    } catch (error) {
      database?.close()
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`无法打开 Gitea 数据库 ${filename}：${detail}`, { cause: error })
    }
  }

  private require(connection: Connection, id: string): GiteaInstance {
    const row = connection.byId.get(id)
    if (!row) throw new Error(`找不到 Gitea 实例：${id}`)
    return instanceFromRow(decodeRow(row))
  }

  add(input: GiteaInstanceInput): GiteaInstance {
    const instance = normalizeInstance(input)
    const connection = this.open()
    if (connection.byName.get(instance.name)) {
      throw new Error(`已存在同名 Gitea 实例：${instance.name}`)
    }
    if (connection.byBaseUrl.get(instance.baseUrl)) {
      throw new Error(`已存在相同地址的 Gitea 实例：${instance.baseUrl}`)
    }
    const id = randomUUID()
    const now = new Date().toISOString()
    transaction(connection.database, () => {
      connection.insert.run(
        id, instance.name, instance.baseUrl, instance.credentialRef, now, now,
      )
    })
    return this.require(connection, id)
  }

  list(): readonly GiteaInstance[] {
    return this.open().listAll.all().map((row) => instanceFromRow(decodeRow(row)))
  }

  get(id: string): GiteaInstance {
    return this.require(this.open(), requireText(id, 'Gitea 实例 id'))
  }

  update(id: string, changes: GiteaInstanceUpdate): GiteaInstance {
    const instanceId = requireText(id, 'Gitea 实例 id')
    const current = this.require(this.open(), instanceId)
    if (
      changes.name === undefined && changes.baseUrl === undefined &&
      changes.credentialRef === undefined
    ) {
      throw new Error('至少提供一个 Gitea 实例修改字段')
    }
    const name = changes.name === undefined ? current.name : requireName(changes.name)
    const baseUrl = changes.baseUrl === undefined ? current.baseUrl : normalizeBaseUrl(changes.baseUrl)
    const credentialRef = changes.credentialRef === undefined
      ? current.credentialRef ?? ''
      : normalizeCredentialRef(changes.credentialRef)
    const connection = this.open()
    const byName = connection.byName.get(name)
    if (byName && byName.id !== instanceId) throw new Error(`已存在同名 Gitea 实例：${name}`)
    const byBase = connection.byBaseUrl.get(baseUrl)
    if (byBase && byBase.id !== instanceId) throw new Error(`已存在相同地址的 Gitea 实例：${baseUrl}`)
    transaction(connection.database, () => {
      connection.update.run(name, baseUrl, credentialRef, new Date().toISOString(), instanceId)
    })
    return this.require(connection, instanceId)
  }

  remove(id: string): void {
    const instanceId = requireText(id, 'Gitea 实例 id')
    const connection = this.open()
    transaction(connection.database, () => {
      const result = connection.remove.run(instanceId)
      if (result.changes === 0) throw new Error(`找不到 Gitea 实例：${instanceId}`)
    })
  }

  dispose(): void {
    this.connection?.database.close()
    this.connection = undefined
  }
}
