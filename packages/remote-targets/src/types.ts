import { DomainFailure } from '@locus/core/invocation'
import type { CredentialValues } from '@locus/core/security'
import type { z } from 'zod'
import type {
  credentialUpdateResultSchema,
  execResultSchema,
  migrationSourceSchema,
  probeResultSchema,
  remoteAccessSchema,
  remoteAuthSchema,
  remoteConnectivitySchema,
  remoteIdentitySchema,
  remoteJobResultSchema,
  remoteResourceSchema,
  remoteServiceSchema,
  remoteTargetSchema,
  remoteTargetViewSchema,
  remoteTrustSchema,
} from './schemas.ts'

/** 远程目标子系统：声明式登记 SSH 目标，并通过受控入口执行只读或普通命令。 */
export type TargetProtocol = RemoteConnectivity['transport']
export type TargetVia = RemoteConnectivity['via']
export type RemoteShell = RemoteConnectivity['remoteShell']
export type AuthMethod = RemoteAuth['method']
export type Capability = RemoteAccess['capabilities'][number]

/** 被访问对象的身份；不包含地址与凭据。 */
export type RemoteResource = z.infer<typeof remoteResourceSchema>

/** 认证方式；秘密由 Core 按 component + slot + resourceKey 绑定交付。 */
export type RemoteAuth = z.infer<typeof remoteAuthSchema>
export type RemoteIdentity = z.infer<typeof remoteIdentitySchema>

/** 允许对目标执行的能力集合。 */
export type RemoteAccess = z.infer<typeof remoteAccessSchema>

/** 主机信任锚；指纹用于 Plink，known_hosts 用于 OpenSSH。 */
export type RemoteTrust = z.infer<typeof remoteTrustSchema>

/** 到达资源的路径；同一资源可有多条路径。 */
export type RemoteConnectivity = z.infer<typeof remoteConnectivitySchema>
export type RemoteTarget = z.infer<typeof remoteTargetSchema>
export type ProbeResult = z.infer<typeof probeResultSchema>
export type RemoteTargetView = z.infer<typeof remoteTargetViewSchema>
export type ExecResult = z.infer<typeof execResultSchema>
export type RemoteJobResult = z.infer<typeof remoteJobResultSchema>
export type RemoteCredentialUpdateResult = z.infer<typeof credentialUpdateResultSchema>

/** operation handler 从 Core 取得的目标凭据材料；不写入目标配置。 */
export interface RemoteCredentialMaterial {
  readonly slot: RemoteCredentialSlot
  readonly values: CredentialValues
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

/** 旧文件认证的迁移读取结果；调用方负责导入 Core。 */
export type RemoteTargetMigrationSource = z.infer<typeof migrationSourceSchema>

export interface RemoteTargetsService {
  list(): readonly RemoteTarget[]
  show(reference: string): RemoteTargetView
  add(id: string, spec: unknown, options?: AddOptions): RemoteTarget
  addFromText(id: string, text: string, options?: AddOptions): RemoteTarget
  remove(reference: string): void
  credentialMigration(reference: string): RemoteTargetMigrationSource
  useCredential(reference: string): RemoteTarget
  probe(reference: string, material: RemoteCredentialMaterial): Promise<ProbeResult>
  exec(reference: string, command: readonly string[], material: RemoteCredentialMaterial): Promise<ExecResult>
  shell(reference: string, material: RemoteCredentialMaterial): Promise<number>
  system(reference: string, material: RemoteCredentialMaterial): Promise<ProbeResult>
  services(reference: string, material: RemoteCredentialMaterial): Promise<readonly RemoteService[]>
  restartService(reference: string, name: string, material: RemoteCredentialMaterial): Promise<RemoteService>
  dispose(): void
}

export type RemoteService = z.infer<typeof remoteServiceSchema>

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

export class RemoteTargetsFailure extends DomainFailure {
  override readonly code: RemoteTargetsFailureCode
  readonly details: Readonly<Record<string, boolean>> | undefined

  constructor(code: RemoteTargetsFailureCode, message: string, details?: Readonly<Record<string, boolean>>) {
    super(code, message)
    this.name = 'RemoteTargetsFailure'
    this.code = code
    this.details = details
  }
}
