import { basename, isAbsolute, resolve } from 'node:path'
import { i18n } from '../i18n/core.ts'
import { WorkspaceFailure } from './errors.ts'
import { createSqliteWorkspaceStore } from './sqlite-store.ts'
import type { MountService, RelationSource, ResourceReference, WorkspaceRelation, WorkspaceService } from './types.ts'

/** 输入与领域规则在服务边界完成；SQLite 存储负责原子读写与连接生命周期。 */
export function createWorkspaceStore(dataDirectory: string) {
  const store = createSqliteWorkspaceStore(dataDirectory)
  const workspaces: WorkspaceService = {
    create(name) {
      store.assertActive()
      requireText(name, i18n.t('label.workspace-name'))
      return store.workspaces.create(name.trim())
    },
    list() {
      store.assertActive()
      return store.workspaces.list()
    },
    get(id) {
      store.assertActive()
      requireText(id, i18n.t('label.workspace-id'))
      return store.workspaces.get(id)
    },
    rename(id, name) {
      store.assertActive()
      requireText(id, i18n.t('label.workspace-id'))
      requireText(name, i18n.t('label.workspace-name'))
      return store.workspaces.rename(id, name.trim())
    },
    link(id, kind, target, source) {
      store.assertActive()
      requireText(id, i18n.t('label.workspace-id'))
      validateRelation(kind, target, source)
      if (target.namespace === 'locus.workspace' && target.id === id) {
        throw new WorkspaceFailure('conflict', i18n.t('workspace.self-reference'))
      }
      return store.workspaces.link(id, kind, target, source)
    },
    unlink(id, relationId) {
      store.assertActive()
      requireText(id, i18n.t('label.workspace-id'))
      requireText(relationId, i18n.t('label.relation-id'))
      store.workspaces.unlink(id, relationId)
    },
    remove(id) {
      store.assertActive()
      requireText(id, i18n.t('label.workspace-id'))
      store.workspaces.remove(id)
    },
  }
  const mounts: MountService = {
    add(workspaceId, path, options) {
      store.assertActive()
      requireText(workspaceId, i18n.t('label.workspace-id'))
      const normalizedPath = normalizeMountPath(path)
      const name = options?.name === undefined ? undefined : requireMountName(options.name)
      return store.mounts.add(workspaceId, normalizedPath, name ?? defaultMountName(normalizedPath), name)
    },
    list(workspaceId) {
      store.assertActive()
      requireText(workspaceId, i18n.t('label.workspace-id'))
      return store.mounts.list(workspaceId)
    },
    remove(workspaceId, mountIdOrName) {
      store.assertActive()
      requireText(workspaceId, i18n.t('label.workspace-id'))
      requireText(mountIdOrName, i18n.t('label.mount-reference'))
      store.mounts.remove(workspaceId, mountIdOrName)
    },
  }
  return { workspaces, mounts, assertActive: store.assertActive, dispose: store.dispose }
}

function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new WorkspaceFailure('invalid-argument', i18n.t('workspace.field-non-empty', { field }))
  }
  if (value.includes('\0')) {
    throw new WorkspaceFailure('invalid-argument', i18n.t('workspace.field-nul', { field }))
  }
}

const MOUNT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

function requireMountName(value: unknown): string {
  requireText(value, i18n.t('label.mount-name'))
  if (!MOUNT_NAME.test(value)) {
    throw new WorkspaceFailure('invalid-argument', i18n.t('workspace.mount-name-invalid'))
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
  requireText(value, i18n.t('label.mount-path'))
  if (!isAbsolute(value)) {
    throw new WorkspaceFailure('invalid-argument', i18n.t('workspace.mount-path-absolute'))
  }
  return resolve(value)
}

function validateRelation(kind: WorkspaceRelation['kind'], target: ResourceReference, source: RelationSource): void {
  if (kind !== 'member' && kind !== 'association') {
    throw new WorkspaceFailure('invalid-argument', i18n.t('workspace.relation-kind-invalid', { kind: String(kind) }))
  }
  if (target === null || typeof target !== 'object') {
    throw new WorkspaceFailure('invalid-argument', i18n.t('workspace.relation-target'))
  }
  requireText(target.namespace, i18n.t('label.relation-target-namespace'))
  requireText(target.id, i18n.t('label.relation-target-id'))
  if (source === null || typeof source !== 'object') {
    throw new WorkspaceFailure('invalid-argument', i18n.t('workspace.relation-source'))
  }
  if (source.kind !== 'manual' && source.kind !== 'discovery') {
    throw new WorkspaceFailure(
      'invalid-argument',
      i18n.t('workspace.relation-source-kind-invalid', { kind: String(source.kind) }),
    )
  }
  requireText(source.detail, i18n.t('label.relation-source-detail'))
}
