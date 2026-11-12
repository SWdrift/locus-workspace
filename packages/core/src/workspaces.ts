import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  RelationSource,
  ResourceReference,
  Workspace,
  WorkspaceRelation,
  WorkspaceService,
} from '@locus/contracts'

interface WorkspaceRow {
  id: string
  name: string
  created_at: string
}

interface RelationRow {
  id: string
  kind: WorkspaceRelation['kind']
  target_namespace: string
  target_id: string
  source_kind: RelationSource['kind']
  source_detail: string
  created_at: string
}

const SCHEMA_VERSION = 1
const SCHEMA = `
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
  PRAGMA user_version = ${SCHEMA_VERSION};
`

function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} 必须是非空字符串`)
  }
  if (value.includes('\0')) {
    throw new Error(`${field} 不能包含 NUL 字符`)
  }
}

function validateRelation(
  kind: WorkspaceRelation['kind'],
  target: ResourceReference,
  source: RelationSource,
): void {
  if (kind !== 'member' && kind !== 'association') {
    throw new Error(`无效关系 kind：${String(kind)}，必须是 member 或 association`)
  }
  if (target === null || typeof target !== 'object') {
    throw new Error('关系 target 必须包含 namespace 和 id')
  }
  requireText(target.namespace, '关系 target.namespace')
  requireText(target.id, '关系 target.id')
  if (source === null || typeof source !== 'object') {
    throw new Error('关系 source 必须包含 kind 和 detail')
  }
  if (source.kind !== 'manual' && source.kind !== 'discovery') {
    throw new Error(`无效关系 source.kind：${String(source.kind)}，必须是 manual 或 discovery`)
  }
  requireText(source.detail, '关系 source.detail')
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
      throw new AggregateError([error, rollbackError], 'Workspace 事务失败，且无法回滚')
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

function openDatabase(dataDirectory: string): DatabaseSync {
  const filename = join(dataDirectory, 'core.sqlite')
  mkdirSync(dataDirectory, { recursive: true })
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(filename, { timeout: 1000, enableForeignKeyConstraints: true })
    checkIntegrity(database)
    const version = database.prepare('PRAGMA user_version').get()?.user_version
    if (version !== SCHEMA_VERSION && version !== 0) {
      throw new Error(`不支持的数据库版本 ${String(version)}，当前支持 ${SCHEMA_VERSION}；仅初始化新空库`)
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
        if (currentVersion === SCHEMA_VERSION) return
        if (
          currentVersion !== 0 ||
          initializingDatabase.prepare('SELECT name FROM sqlite_schema').all().length !== 0
        ) {
          throw new Error(`拒绝初始化非空或未知版本数据库：${String(currentVersion)}`)
        }
        initializingDatabase.exec(SCHEMA)
      })
    }
    return database
  } catch (error) {
    database?.close()
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`无法打开 Workspace 数据库 ${filename}：${detail}`, { cause: error })
  }
}

function requireWorkspace(database: DatabaseSync, id: string): WorkspaceRow {
  const row = database
    .prepare('SELECT id, name, created_at FROM workspaces WHERE id = ?')
    .get(id) as unknown as WorkspaceRow | undefined
  if (!row) {
    throw new Error(`找不到 Workspace：${id}`)
  }
  return row
}

function relationFromRow(row: RelationRow): WorkspaceRelation {
  return {
    id: row.id,
    kind: row.kind,
    target: { namespace: row.target_namespace, id: row.target_id },
    source: { kind: row.source_kind, detail: row.source_detail },
    createdAt: row.created_at,
  }
}

function workspaceFromRow(database: DatabaseSync, row: WorkspaceRow): Workspace {
  const relations = database
    .prepare(
      `SELECT id, kind, target_namespace, target_id, source_kind, source_detail, created_at
       FROM relations WHERE workspace_id = ? ORDER BY rowid`,
    )
    .all(row.id) as unknown as RelationRow[]
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    relations: relations.map(relationFromRow),
  }
}

/** 只缓存连接，不缓存领域对象；其他连接提交的数据在下一次用例中重新读取。 */
export function createWorkspaceStore(dataDirectory: string) {
  let database: DatabaseSync | undefined
  let disposed = false

  function assertActive(): void {
    if (disposed) {
      throw new Error('Locus Core 已释放，不能继续使用')
    }
  }

  function getDatabase(): DatabaseSync {
    database ??= openDatabase(dataDirectory)
    return database
  }

  const workspaces: WorkspaceService = {
    create(name) {
      assertActive()
      requireText(name, 'Workspace 名称')
      const database = getDatabase()
      return transaction(database, true, () => {
        const id = randomUUID()
        database
          .prepare('INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)')
          .run(id, name.trim(), new Date().toISOString())
        return workspaceFromRow(database, requireWorkspace(database, id))
      })
    },
    list() {
      assertActive()
      const database = getDatabase()
      return transaction(database, false, () => {
        const rows = database
          .prepare('SELECT id, name, created_at FROM workspaces ORDER BY rowid')
          .all() as unknown as WorkspaceRow[]
        return rows.map((row) => workspaceFromRow(database, row))
      })
    },
    get(id) {
      assertActive()
      requireText(id, 'Workspace id')
      const database = getDatabase()
      return transaction(database, false, () => workspaceFromRow(database, requireWorkspace(database, id)))
    },
    rename(id, name) {
      assertActive()
      requireText(id, 'Workspace id')
      requireText(name, 'Workspace 名称')
      const database = getDatabase()
      return transaction(database, true, () => {
        requireWorkspace(database, id)
        database.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name.trim(), id)
        return workspaceFromRow(database, requireWorkspace(database, id))
      })
    },
    link(id, kind, target, source) {
      assertActive()
      requireText(id, 'Workspace id')
      validateRelation(kind, target, source)
      const database = getDatabase()
      return transaction(database, true, () => {
        requireWorkspace(database, id)
        if (target.namespace === 'locus.workspace') {
          requireWorkspace(database, target.id)
          if (target.id === id) {
            throw new Error('Workspace 不能把自身保存为成员或关联')
          }
        }
        const existing = database
          .prepare(
            `SELECT id, kind, target_namespace, target_id, source_kind, source_detail, created_at
             FROM relations WHERE workspace_id = ? AND kind = ? AND target_namespace = ? AND target_id = ?`,
          )
          .get(id, kind, target.namespace, target.id) as unknown as RelationRow | undefined
        if (existing) return relationFromRow(existing)
        const relation: WorkspaceRelation = {
          id: randomUUID(),
          kind,
          target: { namespace: target.namespace, id: target.id },
          source: { kind: source.kind, detail: source.detail },
          createdAt: new Date().toISOString(),
        }
        database
          .prepare(
            `INSERT INTO relations
             (id, workspace_id, kind, target_namespace, target_id, source_kind, source_detail, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            relation.id,
            id,
            kind,
            relation.target.namespace,
            relation.target.id,
            relation.source.kind,
            relation.source.detail,
            relation.createdAt,
          )
        return relation
      })
    },
    unlink(id, relationId) {
      assertActive()
      requireText(id, 'Workspace id')
      requireText(relationId, '关系 id')
      const database = getDatabase()
      transaction(database, true, () => {
        requireWorkspace(database, id)
        const result = database
          .prepare('DELETE FROM relations WHERE workspace_id = ? AND id = ?')
          .run(id, relationId)
        if (result.changes === 0) {
          throw new Error(`找不到 Workspace ${id} 的关系：${relationId}`)
        }
      })
    },
  }

  return {
    workspaces,
    assertActive,
    dispose(): void {
      if (disposed) return
      disposed = true
      database?.close()
      database = undefined
    },
  }
}
