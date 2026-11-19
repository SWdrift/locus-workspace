import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { i18n } from '../i18n/core.ts'
import { openCoreDatabase } from '../storage/database.ts'
import { WorkspaceFailure } from './errors.ts'
import type { Mount, RelationSource, ResourceReference, Workspace, WorkspaceRelation } from './types.ts'

interface WorkspaceRow {
  id: string
  name: string
  created_at: string
  name_key: string
  description: string | null
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
  is_primary: number
  created_at: string
}

interface WorkspaceWrite {
  readonly name?: string
  readonly description?: string | null
}

interface MountWrite {
  readonly name?: string
  readonly primary?: boolean
}

/** 只缓存连接，不缓存领域对象；其他连接提交的数据在下一次用例中重新读取。 */
export function createSqliteWorkspaceStore(dataDirectory: string) {
  let database: DatabaseSync | undefined
  let disposed = false

  function assertActive(): void {
    if (disposed) {
      throw new WorkspaceFailure('disposed', i18n.t('workspace.disposed'))
    }
  }

  function getDatabase(): DatabaseSync {
    assertActive()
    database ??= openCoreDatabase(dataDirectory)
    return database
  }

  const workspaces = {
    create(name: string, description?: string) {
      const database = getDatabase()
      return transaction(database, true, () => {
        const existing = database.prepare('SELECT id FROM workspaces WHERE name_key = ?').get(name)
        if (existing !== undefined) {
          throw new WorkspaceFailure('conflict', i18n.t('workspace.name-exists', { name }))
        }
        const id = randomUUID()
        database
          .prepare(
            `INSERT INTO workspaces (id, name, created_at, name_key, description)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(id, name, new Date().toISOString(), name, description ?? null)
        return workspaceFromRow(database, requireWorkspace(database, id))
      })
    },
    list() {
      const database = getDatabase()
      return transaction(database, false, () => {
        const rows = database
          .prepare('SELECT id, name, created_at, name_key, description FROM workspaces ORDER BY rowid')
          .all() as unknown as WorkspaceRow[]
        return rows.map(row => workspaceFromRow(database, row))
      })
    },
    get(id: string) {
      const database = getDatabase()
      return transaction(database, false, () => workspaceFromRow(database, requireWorkspace(database, id)))
    },
    update(id: string, input: WorkspaceWrite) {
      const database = getDatabase()
      return transaction(database, true, () => {
        const current = requireWorkspace(database, id)
        const name = input.name ?? current.name
        const nameKey = input.name === undefined ? current.name_key : name
        if (input.name !== undefined) {
          const conflict = database.prepare('SELECT id FROM workspaces WHERE name_key = ? AND id <> ?').get(nameKey, id)
          if (conflict !== undefined) {
            throw new WorkspaceFailure('conflict', i18n.t('workspace.name-exists', { name }))
          }
        }
        const description = input.description === undefined ? current.description : input.description
        database
          .prepare('UPDATE workspaces SET name = ?, name_key = ?, description = ? WHERE id = ?')
          .run(name, nameKey, description, id)
        return workspaceFromRow(database, requireWorkspace(database, id))
      })
    },
    link(id: string, kind: WorkspaceRelation['kind'], target: ResourceReference, source: RelationSource) {
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
    unlink(id: string, relationId: string) {
      const database = getDatabase()
      transaction(database, true, () => {
        requireWorkspace(database, id)
        const result = database.prepare('DELETE FROM relations WHERE workspace_id = ? AND id = ?').run(id, relationId)
        if (result.changes === 0) {
          throw new WorkspaceFailure(
            'not-found',
            i18n.t('workspace.relation-not-found', { workspace: id, relation: relationId }),
          )
        }
      })
    },
    remove(id: string) {
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
    add(workspaceId: string, normalizedPath: string, defaultName: string, requestedName?: string, primary = false) {
      const normalizedPathKey = process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath
      const database = getDatabase()
      return transaction(database, true, () => {
        requireWorkspace(database, workspaceId)
        const existingPath = database
          .prepare('SELECT id FROM mounts WHERE workspace_id = ? AND path_key = ?')
          .get(workspaceId, normalizedPathKey)
        if (existingPath !== undefined) {
          throw new WorkspaceFailure('conflict', i18n.t('workspace.mount-path-exists', { path: normalizedPath }))
        }

        let name: string
        if (requestedName !== undefined) {
          name = requestedName
          const existingName = database
            .prepare('SELECT id FROM mounts WHERE workspace_id = ? AND name_key = ?')
            .get(workspaceId, name.toLowerCase())
          if (existingName !== undefined) {
            throw new WorkspaceFailure('conflict', i18n.t('workspace.mount-name-exists', { name }))
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

        if (primary) {
          database.prepare('UPDATE mounts SET is_primary = 0 WHERE workspace_id = ?').run(workspaceId)
        }
        const mount: Mount = {
          id: randomUUID(),
          workspaceId,
          name,
          path: normalizedPath,
          primary,
          createdAt: new Date().toISOString(),
        }
        database
          .prepare(
            `INSERT INTO mounts (id, workspace_id, name, name_key, path, path_key, created_at, is_primary)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            mount.id,
            workspaceId,
            mount.name,
            mount.name.toLowerCase(),
            mount.path,
            normalizedPathKey,
            mount.createdAt,
            primary ? 1 : 0,
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
            `SELECT id, workspace_id, name, path, is_primary, created_at
             FROM mounts WHERE workspace_id = ? ORDER BY rowid`,
          )
          .all(workspaceId) as unknown as MountRow[]
        return rows.map(mountFromRow)
      })
    },
    update(workspaceId: string, mountIdOrName: string, input: MountWrite) {
      const database = getDatabase()
      return transaction(database, true, () => {
        requireWorkspace(database, workspaceId)
        const target = findMount(database, workspaceId, mountIdOrName)
        const row = requireMount(database, target.id)
        const name = input.name ?? row.name
        if (input.name !== undefined) {
          const conflict = database
            .prepare('SELECT id FROM mounts WHERE workspace_id = ? AND name_key = ? AND id <> ?')
            .get(workspaceId, name.toLowerCase(), row.id)
          if (conflict !== undefined) {
            throw new WorkspaceFailure('conflict', i18n.t('workspace.mount-name-exists', { name }))
          }
        }
        const primary = input.primary === undefined ? row.is_primary === 1 : input.primary
        if (input.primary === true) {
          database.prepare('UPDATE mounts SET is_primary = 0 WHERE workspace_id = ?').run(workspaceId)
        }
        database
          .prepare('UPDATE mounts SET name = ?, name_key = ?, is_primary = ? WHERE id = ?')
          .run(name, name.toLowerCase(), primary ? 1 : 0, row.id)
        return mountFromRow(requireMount(database, row.id))
      })
    },
    remove(workspaceId: string, mountIdOrName: string) {
      const database = getDatabase()
      transaction(database, true, () => {
        requireWorkspace(database, workspaceId)
        const target = findMount(database, workspaceId, mountIdOrName)
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
      throw new AggregateError([error, rollbackError], i18n.t('workspace.transaction-failed'))
    }
    throw error
  }
}

function requireWorkspace(database: DatabaseSync, id: string): WorkspaceRow {
  const row = database
    .prepare('SELECT id, name, created_at, name_key, description FROM workspaces WHERE id = ?')
    .get(id) as unknown as WorkspaceRow | undefined
  if (!row) {
    throw new WorkspaceFailure('not-found', i18n.t('workspace.not-found', { reference: id }))
  }
  return row
}

function requireMount(database: DatabaseSync, id: string): MountRow {
  const row = database
    .prepare('SELECT id, workspace_id, name, path, is_primary, created_at FROM mounts WHERE id = ?')
    .get(id) as unknown as MountRow | undefined
  if (!row) {
    throw new WorkspaceFailure('not-found', i18n.t('workspace.mount-not-found', { reference: id }))
  }
  return row
}

function findMount(database: DatabaseSync, workspaceId: string, reference: string): { id: string } {
  const byId = database
    .prepare('SELECT id FROM mounts WHERE workspace_id = ? AND id = ?')
    .get(workspaceId, reference) as { id: string } | undefined
  const target =
    byId ??
    (database
      .prepare('SELECT id FROM mounts WHERE workspace_id = ? AND name_key = ?')
      .get(workspaceId, reference.toLowerCase()) as { id: string } | undefined)
  if (target === undefined) {
    throw new WorkspaceFailure('not-found', i18n.t('workspace.mount-not-found', { reference }))
  }
  return target
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
    primary: row.is_primary === 1,
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
      `SELECT id, workspace_id, name, path, is_primary, created_at
       FROM mounts WHERE workspace_id = ? ORDER BY rowid`,
    )
    .all(row.id) as unknown as MountRow[]
  return {
    id: row.id,
    name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    createdAt: row.created_at,
    relations: relations.map(relationFromRow),
    mounts: mounts.map(mountFromRow),
  }
}
