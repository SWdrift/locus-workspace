import { basename, isAbsolute, resolve } from 'node:path'
import { i18n } from '../i18n/core.ts'
import { WorkspaceFailure } from './errors.ts'
import { createSqliteWorkspaceStore } from './sqlite-store.ts'
import type {
  MountService,
  MountUpdate,
  RelationSource,
  ResourceReference,
  WorkspaceRelation,
  WorkspaceService,
  WorkspaceUpdate,
} from './types.ts'

/** 输入与领域规则在服务边界完成；SQLite 存储负责原子读写与连接生命周期。 */
export function createWorkspaceStore(dataDirectory: string) {
  const store = createSqliteWorkspaceStore(dataDirectory)
  const workspaces: WorkspaceService = {
    create(name, options) {
      store.assertActive()
      const normalized = requireWorkspaceName(name)
      const description = options?.description === undefined ? undefined : optionalDescription(options.description)
      return store.workspaces.create(normalized, description)
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
    update(id, input: WorkspaceUpdate) {
      store.assertActive()
      requireText(id, i18n.t('label.workspace-id'))
      const name = input.name === undefined ? undefined : requireWorkspaceName(input.name)
      const description = input.description === undefined ? undefined : clearableDescription(input.description)
      return store.workspaces.update(id, {
        ...(name === undefined ? {} : { name }),
        ...(description === undefined ? {} : { description }),
      })
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
      return store.mounts.add(
        workspaceId,
        normalizedPath,
        name ?? defaultMountName(normalizedPath),
        name,
        options?.primary === true,
      )
    },
    list(workspaceId) {
      store.assertActive()
      requireText(workspaceId, i18n.t('label.workspace-id'))
      return store.mounts.list(workspaceId)
    },
    update(workspaceId, mountIdOrName, input: MountUpdate) {
      store.assertActive()
      requireText(workspaceId, i18n.t('label.workspace-id'))
      requireText(mountIdOrName, i18n.t('label.mount-reference'))
      const name = input.name === undefined ? undefined : requireMountName(input.name)
      return store.mounts.update(workspaceId, mountIdOrName, {
        ...(name === undefined ? {} : { name }),
        ...(input.primary === undefined ? {} : { primary: input.primary }),
      })
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

function requireWorkspaceName(value: unknown): string {
  requireText(value, i18n.t('label.workspace-name'))
  const name = value.trim()
  if (name.length > 64 || /[\u0000-\u001F\u007F]/.test(name)) {
    throw new WorkspaceFailure('invalid-argument', i18n.t('workspace.name-invalid'))
  }
  return name
}

/** 返回 undefined 表示不写入；返回 null 表示清空。 */
function clearableDescription(value: unknown): string | null | undefined {
  if (typeof value !== 'string') {
    throw new WorkspaceFailure('invalid-argument', i18n.t('workspace.description-invalid'))
  }
  const description = value.trim()
  if (description.length === 0) return null
  if (description.length > 500) {
    throw new WorkspaceFailure('invalid-argument', i18n.t('workspace.description-too-long', { max: '500' }))
  }
  return description
}

function optionalDescription(value: unknown): string | undefined {
  const description = clearableDescription(value)
  return description === null ? undefined : description
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
