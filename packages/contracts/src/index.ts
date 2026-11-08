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

/** Tag 只参与分类，不能用于解析依赖或授权。 */
export interface CapabilityDescriptor {
  readonly id: string
  readonly provider: string
  readonly tags: readonly string[]
}

export interface Workspace {
  readonly id: string
  readonly name: string
  readonly createdAt: string
  readonly relations: readonly WorkspaceRelation[]
  /** 用户选择的提供方声明快照，不代表当前可用或已授权。 */
  readonly capabilities: readonly CapabilityDescriptor[]
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
  configureCapability(id: string, capability: CapabilityDescriptor): Workspace
  removeCapability(id: string, capabilityId: string): Workspace
}

export interface FilesystemLocation {
  readonly id: string
  readonly workspaceId: string
  readonly path: string
  readonly reference: ResourceReference
}

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

/** Filesystem 与 CLI/Git 的实际局部协议，不是通用资源系统。 */
export interface FilesystemService {
  readonly capability: CapabilityDescriptor
  register(workspaceId: string, path: string): FilesystemLocation
  locations(workspaceId: string): readonly FilesystemLocation[]
  unregister(workspaceId: string, locationId: string): void
  inspect(workspaceId: string, locationId: string, relativePath?: string): Promise<FilesystemObservation>
  discover(workspaceId: string, locationId: string, relativePath?: string, limit?: number): Promise<FilesystemDiscovery>
  read(workspaceId: string, locationId: string, relativePath?: string, maxBytes?: number): Promise<FilesystemRead>
}

export interface GitObservation {
  readonly workspaceId: string
  readonly locationId: string
  readonly filesystem: FilesystemObservation
  readonly state: 'repository' | 'not-repository' | 'unavailable' | 'error'
  readonly observedAt: string
  readonly reference?: ResourceReference
  readonly root?: string
  /** null 表示 detached HEAD；非仓库时不提供此字段。 */
  readonly branch?: string | null
  /** null 表示尚未提交的仓库。 */
  readonly commit?: string | null
  readonly dirty?: boolean
  readonly remotes?: readonly { readonly name: string; readonly url: string }[]
  readonly error?: string
}

/** 直接消费 Filesystem 的路径线索，不维护另一套 Workspace 成员。 */
export interface GitService {
  readonly capability: CapabilityDescriptor
  availability(): Promise<{ readonly available: boolean; readonly error?: string }>
  inspect(workspaceId: string, locationId: string, relativePath?: string): Promise<GitObservation>
}

/** Session 关联的命名空间前缀；后半段是来源标识，避免不同 DSH 数据目录的 id 冲突。 */
export const SESSION_NAMESPACE_PREFIX = 'dsh.session.'

/** 当前 DSH 来源；id 是数据目录的稳定摘要，label 只用于人读。 */
export interface SessionSource {
  readonly id: string
  readonly label: string
}

/**
 * 一次 Session 发现或检查结果。
 * live、persisted 与可访问性分开表达，不合并成一个布尔状态。
 */
export interface SessionSummary {
  readonly reference: ResourceReference
  readonly sessionId: string
  readonly source: SessionSource
  readonly state: 'live' | 'persisted' | 'unavailable'
  readonly live: boolean
  readonly persisted: boolean
  readonly createdAt?: string
  readonly cwd?: string
  readonly parentSessionId?: string
  readonly origin?: 'subagent'
  readonly agentPreset?: string
  readonly isSeeded?: boolean
  readonly formatStatus?: 'current' | 'migration-required'
  readonly title?: string
  readonly error?: string
}

/** 返回原生 Session 的入口；只有当前宿主能可靠恢复时才给出可执行命令。 */
export interface SessionOpen {
  readonly mode: 'live' | 'native' | 'unavailable'
  readonly command?: readonly string[]
  readonly cwd?: string
  readonly note: string
}

/** 发现、检查与原生返回入口；关联持久化仍由 Workspace 关系保存。 */
export interface SessionService {
  readonly capability: CapabilityDescriptor
  readonly source: SessionSource
  availability(): Promise<{ readonly available: boolean; readonly error?: string }>
  discover(signal?: AbortSignal): Promise<readonly SessionSummary[]>
  inspect(sessionId: string, signal?: AbortSignal): Promise<SessionSummary>
  inspectReference(reference: ResourceReference, signal?: AbortSignal): Promise<SessionSummary>
  reference(sessionId: string): ResourceReference
  open(reference: ResourceReference, signal?: AbortSignal): Promise<SessionOpen>
}

/** Remote Machine 的 Locus 管理身份命名空间；不是 hostname、IP 或 SSH 地址。 */
export const REMOTE_MACHINE_NAMESPACE = 'locus.remote-machine'

export type MachineAddressKind = 'ssh' | 'hostname' | 'ip' | 'other'

/** 已知访问地址；同一机器可有多个，地址重合不证明机器身份重合。 */
export interface MachineAddress {
  readonly id: string
  readonly kind: MachineAddressKind
  readonly value: string
  readonly port?: number
  readonly label?: string
  readonly createdAt: string
}

export interface MachineAddressInput {
  readonly kind: MachineAddressKind
  readonly value: string
  readonly port?: number
  readonly label?: string
}

export interface MachineAddressUpdate {
  readonly kind?: MachineAddressKind
  readonly value?: string
  readonly port?: number
  readonly label?: string
}

export interface RemoteMachine {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly addresses: readonly MachineAddress[]
}

export interface RemoteMachineUpdate {
  readonly name?: string
  readonly description?: string
}

/** 一次只读观察的入口；只代表该 SSH 地址当前可达，不代表机器全局在线。 */
export interface MachineObservationSource {
  readonly kind: 'ssh'
  readonly addressId: string
  readonly endpoint: string
  readonly port?: number
}

export interface MachineObservation {
  readonly machineId: string
  readonly scope: 'single-address'
  readonly source: MachineObservationSource
  readonly state: 'observed' | 'unreachable' | 'denied' | 'unavailable' | 'error'
  readonly observedAt: string
  readonly host?: { readonly hostname: string }
  readonly error?: string
}

/**
 * 机器资料与本地管理身份；SSH 只用于按地址观察。
 * Workspace 关联仍由 Core 的不透明引用保存，服务本身不修改 Core。
 */
export interface RemoteMachineService {
  readonly capability: CapabilityDescriptor
  availability(): Promise<{ readonly available: boolean; readonly error?: string }>
  register(name: string, description?: string): RemoteMachine
  list(): readonly RemoteMachine[]
  get(machineId: string): RemoteMachine
  update(machineId: string, changes: RemoteMachineUpdate): RemoteMachine
  addAddress(machineId: string, address: MachineAddressInput): RemoteMachine
  updateAddress(machineId: string, addressId: string, changes: MachineAddressUpdate): RemoteMachine
  removeAddress(machineId: string, addressId: string): RemoteMachine
  reference(machineId: string): ResourceReference
  observe(machineId: string, addressId?: string, signal?: AbortSignal): Promise<MachineObservation>
}
