import { basename, isAbsolute, resolve } from 'node:path'
import { WorkspaceFailure } from './errors.ts'
import { createSqliteWorkspaceStore } from './sqlite-store.ts'
import type { MountService, RelationSource, ResourceReference, WorkspaceRelation, WorkspaceService } from './types.ts'

/** 输入与领域规则在服务边界完成；SQLite 存储负责原子读写与连接生命周期。 */
export function createWorkspaceStore(dataDirectory: string) {
  const store = createSqliteWorkspaceStore(dataDirectory)
  const workspaces: WorkspaceService = {
    create(name) {
      store.assertActive()
      requireText(name, 'Workspace 名称')
      return store.workspaces.create(name.trim())
    },
    list() {
      store.assertActive()
      return store.workspaces.list()
    },
    get(id) {
      store.assertActive()
      requireText(id, 'Workspace id')
      return store.workspaces.get(id)
    },
    rename(id, name) {
      store.assertActive()
      requireText(id, 'Workspace id')
      requireText(name, 'Workspace 名称')
      return store.workspaces.rename(id, name.trim())
    },
    link(id, kind, target, source) {
      store.assertActive()
      requireText(id, 'Workspace id')
      validateRelation(kind, target, source)
      if (target.namespace === 'locus.workspace' && target.id === id) {
        throw new WorkspaceFailure('conflict', 'Workspace 不能把自身保存为成员或关联')
      }
      return store.workspaces.link(id, kind, target, source)
    },
    unlink(id, relationId) {
      store.assertActive()
      requireText(id, 'Workspace id')
      requireText(relationId, '关系 id')
      store.workspaces.unlink(id, relationId)
    },
    remove(id) {
      store.assertActive()
      requireText(id, 'Workspace id')
      store.workspaces.remove(id)
    },
  }
  const mounts: MountService = {
    add(workspaceId, path, options) {
      store.assertActive()
      requireText(workspaceId, 'Workspace id')
      const normalizedPath = normalizeMountPath(path)
      const name = options?.name === undefined ? undefined : requireMountName(options.name)
      return store.mounts.add(workspaceId, normalizedPath, name ?? defaultMountName(normalizedPath), name)
    },
    list(workspaceId) {
      store.assertActive()
      requireText(workspaceId, 'Workspace id')
      return store.mounts.list(workspaceId)
    },
    remove(workspaceId, mountIdOrName) {
      store.assertActive()
      requireText(workspaceId, 'Workspace id')
      requireText(mountIdOrName, '挂载 id 或名称')
      store.mounts.remove(workspaceId, mountIdOrName)
    },
  }
  return { workspaces, mounts, assertActive: store.assertActive, dispose: store.dispose }
}

function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new WorkspaceFailure('invalid-argument', `${field} 必须是非空字符串`)
  }
  if (value.includes('\0')) {
    throw new WorkspaceFailure('invalid-argument', `${field} 不能包含 NUL 字符`)
  }
}

const MOUNT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

function requireMountName(value: unknown): string {
  requireText(value, '挂载名称')
  if (!MOUNT_NAME.test(value)) {
    throw new WorkspaceFailure(
      'invalid-argument',
      '挂载名称必须以字母或数字开头，只包含字母、数字、下划线和短横线，最长 64 字符',
    )
  }
  return value
}

function defaultMountName(pathValue: string): string {
  const base = basename(pathValue)
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
  return base || 'mount'
}

function normalizeMountPath(value: unknown): string {
  requireText(value, '挂载路径')
  if (!isAbsolute(value)) {
    throw new WorkspaceFailure('invalid-argument', '挂载路径必须是绝对路径')
  }
  return resolve(value)
}

function validateRelation(kind: WorkspaceRelation['kind'], target: ResourceReference, source: RelationSource): void {
  if (kind !== 'member' && kind !== 'association') {
    throw new WorkspaceFailure('invalid-argument', `无效关系 kind：${String(kind)}，必须是 member 或 association`)
  }
  if (target === null || typeof target !== 'object') {
    throw new WorkspaceFailure('invalid-argument', '关系 target 必须包含 namespace 和 id')
  }
  requireText(target.namespace, '关系 target.namespace')
  requireText(target.id, '关系 target.id')
  if (source === null || typeof source !== 'object') {
    throw new WorkspaceFailure('invalid-argument', '关系 source 必须包含 kind 和 detail')
  }
  if (source.kind !== 'manual' && source.kind !== 'discovery') {
    throw new WorkspaceFailure(
      'invalid-argument',
      `无效关系 source.kind：${String(source.kind)}，必须是 manual 或 discovery`,
    )
  }
  requireText(source.detail, '关系 source.detail')
}
