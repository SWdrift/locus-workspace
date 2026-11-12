/** Locus 运行时的公开身份信息。 */
export interface LocusInfo {
  /** 面向客户端与诊断的产品版本。 */
  readonly version: string
}

/** DSH 宿主适配器暴露给 Locus 插件的服务。 */
export interface LocusService {
  readonly info: LocusInfo
  /** 各数据所有者在此目录保存自身数据，不共享领域写入规则。 */
  readonly dataDirectory: string
  readonly workspaces: WorkspaceService
}

/** 由领域提供方解释的不透明引用，不表示资源所有权。 */
export interface ResourceReference {
  readonly namespace: string
  readonly id: string
}

/** 保存确认动作的来源，不把发现本身当作长期成员。 */
export interface RelationSource {
  readonly kind: 'manual' | 'discovery'
  readonly detail: string
}

export interface WorkspaceRelation {
  readonly id: string
  readonly kind: 'member' | 'association'
  readonly target: ResourceReference
  readonly source: RelationSource
  readonly createdAt: string
}

export interface Workspace {
  readonly id: string
  readonly name: string
  readonly createdAt: string
  readonly relations: readonly WorkspaceRelation[]
}

/** 长期工作语境用例；同步成功返回即完成本地持久写入。 */
export interface WorkspaceService {
  create(name: string): Workspace
  list(): readonly Workspace[]
  get(id: string): Workspace
  rename(id: string, name: string): Workspace
  link(
    id: string,
    kind: WorkspaceRelation['kind'],
    target: ResourceReference,
    source: RelationSource,
  ): WorkspaceRelation
  unlink(id: string, relationId: string): void
}

export interface FilesystemLocation {
  readonly id: string
  readonly workspaceId: string
  readonly path: string
  readonly reference: ResourceReference
}

/** 本机 Filesystem 引用的命名空间前缀；后半段是主机标识。 */
export const FILESYSTEM_NAMESPACE_PREFIX = 'locus.filesystem:'

/** 每次查询的原生观察；不是持久成员或授权凭据。 */
export interface FilesystemObservation {
  readonly path: string
  readonly reference: ResourceReference
  readonly state: 'accessible' | 'missing' | 'denied' | 'unavailable' | 'error'
  readonly kind: 'file' | 'directory' | 'symlink' | 'other' | 'unknown'
  readonly observedAt: string
  readonly error?: string
}

export interface FilesystemDiscovery {
  readonly root: FilesystemObservation
  readonly entries: readonly FilesystemObservation[]
  readonly truncated: boolean
}

export interface FilesystemRead {
  readonly resource: FilesystemObservation
  readonly text: string
  readonly truncated: boolean
}

/** Filesystem 与 CLI 的实际局部协议，不是通用资源系统。 */
export interface FilesystemService {
  register(workspaceId: string, path: string): FilesystemLocation
  locations(workspaceId: string): readonly FilesystemLocation[]
  unregister(workspaceId: string, locationId: string): void
  inspect(workspaceId: string, locationId: string, relativePath?: string): Promise<FilesystemObservation>
  discover(workspaceId: string, locationId: string, relativePath?: string, limit?: number): Promise<FilesystemDiscovery>
  read(workspaceId: string, locationId: string, relativePath?: string, maxBytes?: number): Promise<FilesystemRead>
}
