import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SQLOutputValue, StatementSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { FILESYSTEM_NAMESPACE_PREFIX, type FilesystemLocation } from '@locus/contracts'

export interface StoredLocation {
  readonly location: FilesystemLocation
  readonly hostname: string
}

interface Connection {
  readonly database: DatabaseSync
  readonly byPath: StatementSync
  readonly byId: StatementSync
  readonly list: StatementSync
  readonly insert: StatementSync
  readonly remove: StatementSync
}

const columns = 'id, workspace_id, hostname, path, reference_namespace, reference_id'

function decode(row: Record<string, SQLOutputValue>): StoredLocation {
  const { id, workspace_id, hostname, path, reference_namespace, reference_id } = row
  if (
    typeof id !== 'string' || typeof workspace_id !== 'string' ||
    typeof hostname !== 'string' || typeof path !== 'string' ||
    typeof reference_namespace !== 'string' || typeof reference_id !== 'string'
  ) {
    throw new Error('Filesystem 位置记录格式损坏，已保留原数据')
  }
  return {
    hostname,
    location: {
      id,
      workspaceId: workspace_id,
      path,
      reference: { namespace: reference_namespace, id: reference_id },
    },
  }
}

/** 只保存位置配置；不保存观察，也不访问 Core 的数据库。 */
export class LocationStore {
  private connection: Connection | undefined

  constructor(private readonly dataDirectory: string) {}

  private open(): Connection {
    if (this.connection) return this.connection
    mkdirSync(this.dataDirectory, { recursive: true })
    const file = join(this.dataDirectory, 'filesystem.sqlite')

    let database: DatabaseSync | undefined
    try {
      database = new DatabaseSync(file)
      database.exec('PRAGMA busy_timeout = 1000')
      const version = database.prepare('PRAGMA user_version').get()?.user_version
      const objects = database.prepare('SELECT name FROM sqlite_schema').all()
      if (version !== 1) {
        if (version !== 0 || objects.length !== 0) {
          throw new Error(
            version === 0
              ? 'Filesystem 数据库已有结构但无版本，拒绝覆盖；请备份后手工处理'
              : `Filesystem 数据格式版本 ${String(version)} 不受支持，需要版本 1；已保留原数据`,
          )
        }
      } else {
        const integrity = database.prepare('PRAGMA integrity_check').all()
        if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
          throw new Error('Filesystem 数据库完整性检查失败，已保留原数据')
        }
      }
      database.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL')
      if (version === 0) {
        database.exec('BEGIN IMMEDIATE')
        try {
          const current = database.prepare('PRAGMA user_version').get()?.user_version
          if (current === 1) {
            database.exec('COMMIT')
          } else {
            const currentObjects = database.prepare('SELECT name FROM sqlite_schema').all()
            if (current !== 0 || currentObjects.length !== 0) {
              throw new Error('拒绝初始化已有结构或未知版本的 Filesystem 数据库')
            }
            database.exec(`
              CREATE TABLE locations (
                id TEXT PRIMARY KEY NOT NULL,
                workspace_id TEXT NOT NULL,
                hostname TEXT NOT NULL,
                path TEXT NOT NULL,
                reference_namespace TEXT NOT NULL,
                reference_id TEXT NOT NULL,
                UNIQUE (workspace_id, hostname, path)
              ) STRICT;
              PRAGMA user_version = 1;
              COMMIT;
            `)
          }
        } catch (error) {
          if (database.isTransaction) database.exec('ROLLBACK')
          throw error
        }
      }
      const connection: Connection = {
        database,
        byPath: database.prepare(`SELECT ${columns} FROM locations WHERE workspace_id = ? AND hostname = ? AND path = ?`),
        byId: database.prepare(`SELECT ${columns} FROM locations WHERE workspace_id = ? AND id = ?`),
        list: database.prepare(`SELECT ${columns} FROM locations WHERE workspace_id = ? ORDER BY rowid`),
        insert: database.prepare(`INSERT INTO locations (${columns}) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (workspace_id, hostname, path) DO NOTHING`),
        remove: database.prepare('DELETE FROM locations WHERE workspace_id = ? AND id = ?'),
      }
      this.connection = connection
      return connection
    } catch (error) {
      database?.close()
      throw error
    }
  }

  register(workspaceId: string, path: string, hostname: string): FilesystemLocation {
    const connection = this.open()
    const existing = connection.byPath.get(workspaceId, hostname, path)
    if (existing) return decode(existing).location
    connection.insert.run(
      randomUUID(), workspaceId, hostname, path,
      `${FILESYSTEM_NAMESPACE_PREFIX}${hostname}`, pathToFileURL(path).href,
    )
    const saved = connection.byPath.get(workspaceId, hostname, path)
    if (!saved) throw new Error('Filesystem 位置未能持久保存')
    return decode(saved).location
  }

  list(workspaceId: string): readonly FilesystemLocation[] {
    return this.open().list.all(workspaceId).map(row => decode(row).location)
  }

  get(workspaceId: string, locationId: string): StoredLocation {
    const row = this.open().byId.get(workspaceId, locationId)
    if (!row) throw new Error(`Workspace 中不存在 Filesystem 位置：${locationId}`)
    return decode(row)
  }

  remove(workspaceId: string, locationId: string): void {
    this.get(workspaceId, locationId)
    this.open().remove.run(workspaceId, locationId)
  }

  close(): void {
    this.connection?.database.close()
    this.connection = undefined
  }
}
