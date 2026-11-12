import type {
  FilesystemDiscovery,
  FilesystemLocation,
  FilesystemObservation,
  FilesystemRead,
  FilesystemService,
  LocusInfo,
  LocusService,
  RelationSource,
  ResourceReference,
  Workspace,
  WorkspaceRelation,
} from '@locus/contracts'

/** CLI 与 UI 共用的 Workspace/Filesystem 用例；只组合公开服务，不拥有持久化。 */
export interface WorkspaceApplication {
  readonly info: LocusInfo
  readonly filesystemAvailable: boolean
  listWorkspaces(): readonly Workspace[]
  createWorkspace(name: string): Workspace
  getWorkspace(id: string): Workspace
  renameWorkspace(id: string, name: string): Workspace
  link(
    id: string,
    kind: WorkspaceRelation['kind'],
    target: ResourceReference,
    source: RelationSource,
  ): WorkspaceRelation
  unlink(id: string, relationId: string): void
  listLocations(workspaceId: string): readonly FilesystemLocation[]
  registerLocation(workspaceId: string, path: string): FilesystemLocation
  unregisterLocation(workspaceId: string, locationId: string): void
  inspectLocation(workspaceId: string, locationId: string, relativePath?: string): Promise<FilesystemObservation>
  discoverLocation(
    workspaceId: string,
    locationId: string,
    relativePath?: string,
    limit?: number,
  ): Promise<FilesystemDiscovery>
  readLocation(
    workspaceId: string,
    locationId: string,
    relativePath?: string,
    maxBytes?: number,
  ): Promise<FilesystemRead>
  confirmResource(
    workspaceId: string,
    locationId: string,
    kind: WorkspaceRelation['kind'],
    relativePath?: string,
  ): Promise<WorkspaceRelation>
}

export interface WorkspaceApplicationServices {
  readonly locus: LocusService
  readonly filesystem?: FilesystemService
}

/** 每次创建都读取当前服务实例，调用方无需缓存或复制领域规则。 */
export function createWorkspaceApplication(services: WorkspaceApplicationServices): WorkspaceApplication {
  const { locus, filesystem } = services

  function requireFilesystem(): FilesystemService {
    if (filesystem === undefined) {
      throw new Error('Filesystem 能力不可用：profile 未加载 locusFilesystem；Workspace 与已保存关系不受影响。')
    }
    return filesystem
  }

  return {
    info: locus.info,
    filesystemAvailable: filesystem !== undefined,
    listWorkspaces: () => locus.workspaces.list(),
    createWorkspace: (name) => locus.workspaces.create(name),
    getWorkspace: (id) => locus.workspaces.get(id),
    renameWorkspace: (id, name) => locus.workspaces.rename(id, name),
    link: (id, kind, target, source) => locus.workspaces.link(id, kind, target, source),
    unlink: (id, relationId) => locus.workspaces.unlink(id, relationId),
    listLocations: (workspaceId) => requireFilesystem().locations(workspaceId),
    registerLocation: (workspaceId, path) => requireFilesystem().register(workspaceId, path),
    unregisterLocation: (workspaceId, locationId) => {
      requireFilesystem().unregister(workspaceId, locationId)
    },
    inspectLocation: (workspaceId, locationId, relativePath) =>
      requireFilesystem().inspect(workspaceId, locationId, relativePath),
    discoverLocation: (workspaceId, locationId, relativePath, limit) =>
      requireFilesystem().discover(workspaceId, locationId, relativePath, limit),
    readLocation: (workspaceId, locationId, relativePath, maxBytes) =>
      requireFilesystem().read(workspaceId, locationId, relativePath, maxBytes),
    async confirmResource(workspaceId, locationId, kind, relativePath) {
      const resource = await requireFilesystem().inspect(workspaceId, locationId, relativePath)
      if (resource.state !== 'accessible') {
        throw new Error(`无法确认 ${resource.path}：${resource.state}${resource.error ? ` (${resource.error})` : ''}`)
      }
      return locus.workspaces.link(workspaceId, kind, resource.reference, {
        kind: 'discovery',
        detail: `Filesystem 位置 ${locationId}，路径 ${resource.path}`,
      })
    },
  }
}
