import { CapabilityFailure } from '@locus/core'
import type { CredentialRef, CredentialValues } from '@locus/core'

/** 远程目标子系统：声明式登记 SSH 目标，并通过受控入口执行只读或普通命令。 */
export type TargetProtocol = 'ssh'
export type TargetVia = 'direct' | 'frp'
export type RemoteShell = 'posix' | 'cmd'
export type AuthMethod = 'key' | 'private-key' | 'password'
export type Capability = 'exec' | 'shell'

/** 被访问对象的身份；不包含地址与凭据。 */
export interface RemoteResource {
  readonly kind: string
  readonly label?: string
}

/** 接入面到资源的认证材料引用；新格式只保存稳定 CredentialRef。 */
export interface RemoteAuth {
  readonly method: AuthMethod
  /** Core 凭据引用；新格式必填。 */
  readonly credential?: CredentialRef
  /** 旧格式相对目标根目录的凭据文件路径；仅供迁移读取。 */
  readonly path?: string
  /** 旧格式凭据根的绝对路径；仅供迁移读取。 */
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
  readonly signal?: AbortSignal
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

/** 组合根提供的组件状态；远程目标只消费这个窄视图，不读取组件定义文件。 */
export interface ComponentAvailability {
  readonly id: string
  readonly kind: 'locus' | 'external'
  readonly state: string | null
}

export interface ComponentGate {
  get(id: string): ComponentAvailability | undefined
}

export type RemoteCredentialSlot = 'ssh-private-key' | 'ssh-password'

/** 组合根注入 Core 授权与字段交付；组件状态与目标 access 不能代替它。 */
export interface RemoteSecurity {
  withCredential<T>(
    targetId: string,
    slot: RemoteCredentialSlot,
    credential: CredentialRef,
    targetBinding: string,
    consume: (values: CredentialValues) => Promise<T>,
  ): Promise<T>
}

/** 旧文件认证的迁移读取结果；调用方负责导入 Core。 */
export interface CredentialMigration {
  readonly method: 'key' | 'password'
  readonly path: string
}

export interface RemoteTargetsService {
  list(): readonly RemoteTarget[]
  show(reference: string): RemoteTargetView
  add(id: string, spec: unknown, options?: AddOptions): RemoteTarget
  addFromText(id: string, text: string, options?: AddOptions): RemoteTarget
  remove(reference: string): void
  credentialMigration(reference: string): CredentialMigration
  useCredential(reference: string, credential: CredentialRef): RemoteTarget
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
  | 'credential-too-large'
  | 'capability-unsupported'
  | 'target-config-mismatch'
  | 'component-unavailable'
  | 'access-denied'
  | 'migration-required'
  | 'already-migrated'
  | 'encrypted-key-unsupported'
  | 'delivery-failed'
  | 'io'

export class RemoteTargetsFailure extends CapabilityFailure {
  constructor(code: RemoteTargetsFailureCode, message: string) {
    super(code, message)
    this.name = 'RemoteTargetsFailure'
  }
}
