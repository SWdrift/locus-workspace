/** 远程目标子系统：声明式登记 SSH 目标，并通过受控入口执行只读或普通命令。 */
export type TargetProtocol = 'ssh'
export type TargetVia = 'direct' | 'frp'
export type RemoteShell = 'posix' | 'cmd'
export type AuthMethod = 'key' | 'password'
export type Capability = 'exec' | 'shell'

/** 被访问对象的身份；不包含地址与凭据。 */
export interface RemoteResource {
  readonly kind: string
  readonly label?: string
}

/** 接入面到资源的认证材料引用；不保存凭据值。 */
export interface RemoteAuth {
  readonly method: AuthMethod
  /** 相对目标根目录的凭据文件路径。 */
  readonly path: string
  /** 凭据根的绝对路径；缺省使用目标根目录。 */
  readonly root?: string
}

export interface RemoteIdentity {
  readonly login: string
  readonly auth: RemoteAuth
}

/** 允许对目标执行的能力集合。 */
export interface RemoteAccess {
  readonly capabilities: readonly Capability[]
}

/** 主机信任锚；指纹用于 Plink，known_hosts 用于 OpenSSH。 */
export interface RemoteTrust {
  readonly fingerprint?: string
  readonly knownHosts?: string
}

/** 到达资源的路径；同一资源可有多条路径。 */
export interface RemoteConnectivity {
  readonly transport: TargetProtocol
  readonly via: TargetVia
  readonly host: string
  readonly port: number
  readonly remoteShell: RemoteShell
  /** 客户端可执行文件；缺省使用 PATH 中的 ssh/plink。 */
  readonly client?: string
  readonly trust?: RemoteTrust
}

export interface RemoteTarget {
  readonly id: string
  readonly resource: RemoteResource
  readonly identity: RemoteIdentity
  readonly access: RemoteAccess
  readonly connectivity: RemoteConnectivity
}

export interface ProbeResult {
  readonly targetId: string
  readonly ok: boolean
  readonly detail: string
  readonly checkedAt: string
}

export interface RemoteTargetView extends RemoteTarget {
  readonly lastProbe?: ProbeResult
}

export interface ExecResult {
  readonly targetId: string
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface AddOptions {
  readonly dryRun?: boolean
}

export interface RunOptions {
  readonly timeoutMs?: number
}

export interface RunResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/** 传输调用边界；测试注入假实现，生产使用真实子进程。 */
export interface CommandRunner {
  run(command: string, args: readonly string[], options?: RunOptions): Promise<RunResult>
  interactive(command: string, args: readonly string[], options?: RunOptions): Promise<number>
}

/** 组合根提供的组件状态；远程目标不依赖 Core，只消费这个窄视图。 */
export interface ComponentAvailability {
  readonly id: string
  readonly kind: 'locus' | 'external'
  readonly state: string | null
}

export interface ComponentGate {
  get(id: string): ComponentAvailability | undefined
}

export interface RemoteTargetsService {
  list(): readonly RemoteTarget[]
  show(reference: string): RemoteTargetView
  add(id: string, spec: unknown, options?: AddOptions): RemoteTarget
  addFromText(id: string, text: string, options?: AddOptions): RemoteTarget
  remove(reference: string): void
  probe(reference: string): Promise<ProbeResult>
  exec(reference: string, command: readonly string[]): Promise<ExecResult>
  shell(reference: string): Promise<number>
  dispose(): void
}

export type RemoteTargetsFailureCode =
  | 'invalid-spec'
  | 'target-exists'
  | 'target-not-found'
  | 'ambiguous-target'
  | 'unsupported-protocol'
  | 'credential-missing'
  | 'capability-unsupported'
  | 'component-unavailable'
  | 'io'

export class RemoteTargetsFailure extends Error {
  readonly code: RemoteTargetsFailureCode

  constructor(code: RemoteTargetsFailureCode, message: string) {
    super(message)
    this.name = 'RemoteTargetsFailure'
    this.code = code
  }
}
