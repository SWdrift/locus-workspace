import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { openCoreDatabase } from '../storage/database.ts'
import { WorkspaceFailure } from './errors.ts'
import type { Mount, RelationSource, Workspace, WorkspaceRelation, WorkspaceService } from './types.ts'

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

interface MountRow {
  id: string
  workspace_id: string
  name: string
  path: string
  created_at: string
}

/** 只缓存连接，不缓存领域对象；其他连接提交的数据在下一次用例中重新读取。 */
export function createSqliteWorkspaceStore(dataDirectory: string) {
  let database: DatabaseSync | undefined
  let disposed = false

  function assertActive(): void {
    if (disposed) {
      throw new WorkspaceFailure('disposed', 'Locus Core 已释放，不能继续使用')
    }
  }

  function getDatabase(): DatabaseSync {
    assertActive()
    database ??= openCoreDatabase(dataDirectory)
    return database
  }

  const workspaces: WorkspaceService = {
    create(name) {
      const database = getDatabase()
      return transaction(database, true, () => {
        const id = randomUUID()
        database
          .prepare('INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)')
          .run(id, name, new Date().toISOString())
        return workspaceFromRow(database, requireWorkspace(database, id))
      })
    },
    list() {
      const database = getDatabase()
      return transaction(database, false, () => {
        const rows = database
          .prepare('SELECT id, name, created_at FROM workspaces ORDER BY rowid')
          .all() as unknown as WorkspaceRow[]
        return rows.map(row => workspaceFromRow(database, row))
      })
    },
    get(id) {
      const database = getDatabase()
      return transaction(database, false, () => workspaceFromRow(database, requireWorkspace(database, id)))
    },
    rename(id, name) {
      const database = getDatabase()
      return transaction(database, true, () => {
        requireWorkspace(database, id)
        database.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name, id)
        return workspaceFromRow(database, requireWorkspace(database, id))
      })
    },
    link(id, kind, target, source) {
      const database = getDatabase()
      return transaction(database, true, () => {
        requireWorkspace(database, id)
        if (target.namespace === 'locus.workspace') {
          requireWorkspace(database, target.id)
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
      const database = getDatabase()
      transaction(database, true, () => {
        requireWorkspace(database, id)
        const result = database.prepare('DELETE FROM relations WHERE workspace_id = ? AND id = ?').run(id, relationId)
        if (result.changes === 0) {
          throw new WorkspaceFailure('not-found', `找不到 Workspace ${id} 的关系：${relationId}`)
        }
      })
    },
    remove(id) {
      const database = getDatabase()
      transaction(database, true, () => {
        requireWorkspace(database, id)
        database.prepare('DELETE FROM mounts WHERE workspace_id = ?').run(id)
        database
          .prepare(
            `DELETE FROM relations
             WHERE workspace_id = ? OR (target_namespace = 'locus.workspace' AND target_id = ?)`,
          )
          .run(id, id)
        database.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
      })
    },
  }

  const mounts = {
    add(workspaceId: string, normalizedPath: string, defaultName: string, requestedName?: string) {
      const normalizedPathKey = process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath
      const database = getDatabase()
      return transaction(database, true, () => {
        requireWorkspace(database, workspaceId)
        const existingPath = database
          .prepare('SELECT id FROM mounts WHERE workspace_id = ? AND path_key = ?')
          .get(workspaceId, normalizedPathKey)
        if (existingPath !== undefined) {
          throw new WorkspaceFailure('conflict', `该路径已挂载到 Workspace：${normalizedPath}`)
        }

        let name: string
        if (requestedName !== undefined) {
          name = requestedName
          const existingName = database
            .prepare('SELECT id FROM mounts WHERE workspace_id = ? AND name_key = ?')
            .get(workspaceId, name.toLowerCase())
          if (existingName !== undefined) {
            throw new WorkspaceFailure('conflict', `挂载名称已存在：${name}`)
          }
        } else {
          const base = defaultName
          name = base
          let suffix = 2
          while (
            database
              .prepare('SELECT id FROM mounts WHERE workspace_id = ? AND name_key = ?')
              .get(workspaceId, name.toLowerCase()) !== undefined
          ) {
            name = `${base}-${suffix++}`
          }
        }

        const mount: Mount = {
          id: randomUUID(),
          workspaceId,
          name,
          path: normalizedPath,
          createdAt: new Date().toISOString(),
        }
        database
          .prepare(
            `INSERT INTO mounts (id, workspace_id, name, name_key, path, path_key, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            mount.id,
            workspaceId,
            mount.name,
            mount.name.toLowerCase(),
            mount.path,
            normalizedPathKey,
            mount.createdAt,
          )
        return mount
      })
    },
    list(workspaceId: string) {
      const database = getDatabase()
      return transaction(database, false, () => {
        requireWorkspace(database, workspaceId)
        const rows = database
          .prepare(
            `SELECT id, workspace_id, name, path, created_at
             FROM mounts WHERE workspace_id = ? ORDER BY rowid`,
          )
          .all(workspaceId) as unknown as MountRow[]
        return rows.map(mountFromRow)
      })
    },
    remove(workspaceId: string, mountIdOrName: string) {
      const database = getDatabase()
      transaction(database, true, () => {
        requireWorkspace(database, workspaceId)
        const byId = database
          .prepare('SELECT id FROM mounts WHERE workspace_id = ? AND id = ?')
          .get(workspaceId, mountIdOrName) as { id: string } | undefined
        const target =
          byId ??
          (database
            .prepare('SELECT id FROM mounts WHERE workspace_id = ? AND name_key = ?')
            .get(workspaceId, mountIdOrName.toLowerCase()) as { id: string } | undefined)
        if (target === undefined) {
          throw new WorkspaceFailure('not-found', `找不到挂载：${mountIdOrName}`)
        }
        database.prepare('DELETE FROM mounts WHERE id = ?').run(target.id)
      })
    },
  }

  return {
    workspaces,
    mounts,
    assertActive,
    dispose(): void {
      if (disposed) return
      disposed = true
      database?.close()
      database = undefined
    },
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
      throw new AggregateError([error, rollbackError], 'Workspace 事务失败，且无法回滚')
    }
    throw error
  }
}

function requireWorkspace(database: DatabaseSync, id: string): WorkspaceRow {
  const row = database.prepare('SELECT id, name, created_at FROM workspaces WHERE id = ?').get(id) as unknown as
    WorkspaceRow | undefined
  if (!row) {
    throw new WorkspaceFailure('not-found', `找不到 Workspace：${id}`)
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

function mountFromRow(row: MountRow): Mount {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    path: row.path,
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
  const mounts = database
    .prepare(
      `SELECT id, workspace_id, name, path, created_at
       FROM mounts WHERE workspace_id = ? ORDER BY rowid`,
    )
    .all(row.id) as unknown as MountRow[]
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    relations: relations.map(relationFromRow),
    mounts: mounts.map(mountFromRow),
  }
}
