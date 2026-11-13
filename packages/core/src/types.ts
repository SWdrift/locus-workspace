/** Locus 运行时的公开身份信息。 */
export interface LocusInfo {
  /** 面向客户端与诊断的产品版本。 */
  readonly version: string
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

/** Workspace 挂载的本机目录；名称用于 CLI 与 shell 环境变量。 */
export interface Mount {
  readonly id: string
  readonly workspaceId: string
  readonly name: string
  readonly path: string
  readonly createdAt: string
}

export interface Workspace {
  readonly id: string
  readonly name: string
  readonly createdAt: string
  readonly relations: readonly WorkspaceRelation[]
  readonly mounts: readonly Mount[]
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
  /** 删除 Workspace 及其长期关系与挂载，不删除外部目录。 */
  remove(id: string): void
}

/** Workspace 内的本机目录挂载；同一 Workspace 内名称与路径都唯一。 */
export interface MountService {
  add(workspaceId: string, path: string, options?: { readonly name?: string }): Mount
  list(workspaceId: string): readonly Mount[]
  remove(workspaceId: string, mountIdOrName: string): void
}

/** 本地 Core 句柄；释放后捕获的服务不可继续调用。 */
export interface LocusCore {
  readonly info: LocusInfo
  /** Core 自有 SQLite 与后续领域数据的根目录。 */
  readonly dataDirectory: string
  readonly workspaces: WorkspaceService
  readonly mounts: MountService
  dispose(): Promise<void>
}
