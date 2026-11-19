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
  /** shell 默认 cwd；每个 Workspace 最多一个。 */
  readonly primary: boolean
  readonly createdAt: string
}

export interface Workspace {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly createdAt: string
  readonly relations: readonly WorkspaceRelation[]
  readonly mounts: readonly Mount[]
}

export interface WorkspaceUpdate {
  readonly name?: string
  readonly description?: string
}

export interface MountUpdate {
  readonly name?: string
  readonly primary?: boolean
}

/** 长期工作语境用例；同步成功返回即完成本地持久写入。 */
export interface WorkspaceService {
  create(name: string, options?: { readonly description?: string }): Workspace
  list(): readonly Workspace[]
  get(id: string): Workspace
  update(id: string, input: WorkspaceUpdate): Workspace
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
  add(workspaceId: string, path: string, options?: { readonly name?: string; readonly primary?: boolean }): Mount
  list(workspaceId: string): readonly Mount[]
  update(workspaceId: string, mountIdOrName: string, input: MountUpdate): Mount
  remove(workspaceId: string, mountIdOrName: string): void
}
