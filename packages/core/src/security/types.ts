import type { ComponentSpec } from '../components/types.ts'

export type SecurityLevel = 'user' | 'root'
export type SecuritySource = 'human' | 'agent' | 'component'
export type SecurityGrantScope = 'operation' | 'session'
export type CredentialRef = `credential:${string}`
export type CredentialValues = Readonly<Record<string, string>>
export type SecurityParameters =
  null | boolean | number | string | readonly SecurityParameters[] | { readonly [key: string]: SecurityParameters }

/** 授权键是组件与 operation；资源 key 只参与凭据绑定，不参与等级判定。 */
export interface SecurityRequest {
  readonly component: string
  readonly operation: string
  readonly parameters: SecurityParameters
}

/** 由可信 Host 创建的进程内会话；source 只作来源记录，不参与授权。 */
export interface SecuritySession {
  readonly sessionId: string
  readonly userId: 'user'
  readonly source: SecuritySource
  readonly startedAt: number
  readonly endedAt: number | undefined
  readonly active: boolean
}

/** 凭据绑定键是 component + slot + resourceKey；引用只指向 Provider 条目。 */
export interface CredentialBinding {
  readonly profile: string
  readonly componentId: string
  readonly slot: string
  readonly resourceKey: string
  readonly reference: CredentialRef
  readonly createdAt: number
  readonly updatedAt: number
}

export interface UnbindCredentialInput {
  readonly componentId: string
  readonly slot: string
  readonly resourceKey: string
}

/** Root 对 operation 的认证等级覆盖。 */
export interface OperationLevelRecord {
  readonly profile: string
  readonly componentId: string
  readonly operation: string
  readonly level: SecurityLevel
  readonly updatedAt: number
}

export interface SetOperationLevelInput {
  readonly componentId: string
  readonly operation: string
  readonly level: SecurityLevel
}

export interface ClearOperationLevelInput {
  readonly componentId: string
  readonly operation: string
}

/** 组件的声明等级、Root 覆盖与最终生效等级。 */
export interface OperationAuthority {
  readonly componentId: string
  readonly operation: string
  readonly defaultAuthLevel: SecurityLevel
  readonly effectiveAuthLevel: SecurityLevel
  readonly source: 'override' | 'operation' | 'default'
}

export interface CredentialStatus {
  readonly metadata: CredentialMetadata
  readonly present: boolean
}

/** 凭据管理输出只包含公开元数据与绑定，不包含 Provider 的秘密字段。 */
export interface CredentialList {
  readonly credentials: readonly CredentialMetadata[]
  readonly bindings: readonly CredentialBinding[]
}

export interface ComponentCredentials extends CredentialList {
  readonly component: string
}

export interface CredentialBindingView {
  readonly binding: CredentialBinding
  readonly credential: CredentialMetadata
}

/** 当前 Profile 精确 Keyring service 下未被元数据登记的孤立账户。 */
export interface CredentialCleanupResult {
  readonly service: string
  readonly orphans: readonly string[]
  readonly removed: number
  readonly remaining: number
}

/** 仅含可展示的授权信息，永不携带密码、凭据值或其摘要。 */
export interface SecurityChallenge {
  readonly challengeId: string
  readonly sessionId: string
  readonly subject: 'user'
  readonly componentId: string
  readonly operation: string
  readonly parameters: SecurityParameters
  readonly expiresAt: number
}

/** 授权依赖 Core 内部记录与对象身份，复制公开字段不能获得权限。 */
export interface SecurityGrant {
  readonly grantId: string
  readonly challengeId: string
  readonly sessionId: string
  readonly subject: 'user'
  readonly authorizedBy: 'root'
  readonly scope: SecurityGrantScope
  readonly componentId: string
  readonly operation: string
  readonly parameters: SecurityParameters
  /** operation 为固定有效期；session 在 Session 结束时失效，故为 null。 */
  readonly expiresAt: number | null
}

/** 组件 handler 的唯一凭据入口；Core 在授权后注入。 */
export interface OperationCredentialPort {
  read<T>(slot: string, resourceKey: string, consume: (values: CredentialValues) => T | Promise<T>): Promise<T>

  /** 只在实际获准 root 时可用。 */
  write(slot: string, resourceKey: string, values: CredentialValues): Promise<CredentialRef>
}

/** 只交付给绑定了可信定义与会话的组件，不提供认证或原始凭据导出入口。 */
export interface ComponentSecurity {
  execute<T>(request: SecurityRequest, run: (credential: OperationCredentialPort) => T | Promise<T>): Promise<T>
}

/** 只含可展示字段；秘密字段不在元数据中。 */
export interface CredentialMetadata {
  readonly reference: CredentialRef
  readonly profile: string
  /** 拥有该 CredentialRef 的组件 id；第一版单 owner。 */
  readonly owner: string
  readonly providerId: string
  readonly fields: Readonly<Record<string, string>>
  readonly createdAt: number
  readonly updatedAt: number
}

/** Root 管理端口只通过 SecurityHost 交付给可信组合根。 */
export interface HostSecurity {
  listCredentials(): Promise<readonly CredentialMetadata[]>
  deleteCredential(reference: CredentialRef): Promise<void>
  listBindings(): Promise<readonly CredentialBinding[]>
  unbindCredential(input: UnbindCredentialInput): Promise<boolean>
  credentialStatus(reference: CredentialRef): Promise<CredentialStatus>
  cleanupCredentialOrphans(apply: boolean): Promise<CredentialCleanupResult>
  changeRootPassword(password: string, confirmation: string): Promise<void>
  setOperationLevel(input: SetOperationLevelInput): Promise<OperationAuthority>
  clearOperationLevel(input: ClearOperationLevelInput): Promise<OperationAuthority>
  listOperationAuthorities(): Promise<readonly OperationAuthority[]>
}

export interface SecurityStatus {
  readonly initialized: boolean
  readonly profile: string
  readonly installationId: string | undefined
  readonly identities: readonly { readonly id: 'root' | 'user'; readonly level: SecurityLevel }[]
}

/** 普通 Core 公开面没有 Host、会话创建、身份选择或认证方法。 */
export interface SecurityService {
  status(): Promise<SecurityStatus>
  providerStatus(): Promise<CredentialProviderStatus>
}

/** 只能在装配时由 receiveHost 回调接收，不能从 core.security 取得。 */
export interface SecurityHost {
  createSession(source: SecuritySource): SecuritySession
  endSession(session: SecuritySession): void
  bindComponent(session: SecuritySession, componentId: string): ComponentSecurity
  forSession(session: SecuritySession): HostSecurity
  /** 组合根专用管理端口；调用方已由 operation 授权。 */
  management(): HostSecurity
  initializeRoot(password: string, confirmation: string): Promise<void>
  resetRoot(password: string, confirmation: string): Promise<void>
  authenticate(challenge: SecurityChallenge, password: string, scope?: SecurityGrantScope): Promise<SecurityGrant>
  cancelChallenge(challenge: SecurityChallenge): void
  resume<T = unknown>(grant: SecurityGrant): Promise<T>
  /** Host 退出时撤销全部会话、待处理挑战与授权。 */
  close(): void
}

export interface CredentialProviderKey {
  readonly service: string
  readonly account: string
}

export interface CredentialProviderStatus {
  readonly id: string
  readonly backend: string
  readonly state: 'ready' | 'unverified' | 'unavailable'
  readonly nativeBinding: 'not-applicable' | 'not-loaded' | 'loaded'
}

/** Provider 只保管秘密，不判断权限；未配置时必须失败，不能自动回退。 */
export interface CredentialProvider {
  readonly id: string
  status?(): Promise<CredentialProviderStatus>
  get(key: CredentialProviderKey): Promise<string | undefined>
  set(key: CredentialProviderKey, secret: string): Promise<void>
  delete(key: CredentialProviderKey): Promise<void>
  /** 只返回账户名，不返回秘密；缺失时清理入口明确失败而不是假装没有孤立条目。 */
  list?(service: string): Promise<readonly string[]>
  dispose?(): void | Promise<void>
}

export interface SecurityInstallation {
  readonly installationId: string
}

/** 固定 scrypt 格式；SQLite 中的验证材料仍有离线破解风险。 */
export interface RootPasswordVerifier {
  readonly version: 1
  readonly algorithm: 'scrypt'
  readonly N: 32768
  readonly r: 8
  readonly p: 1
  readonly maxmem: 67108864
  readonly salt: string
  readonly derivedKey: string
}

export interface RootAuthenticationState {
  readonly generation: number
  readonly verifier: RootPasswordVerifier
  readonly failedAttempts: number
  readonly lockedUntil: number | undefined
  /** 预先计作失败的短租约，阻止并发 KDF 与进程退出清零尝试次数。 */
  readonly attempt: { readonly id: string; readonly expiresAt: number } | undefined
}

/** 回调必须同步完成；SQLite 实现应以同一写事务提交所有修改，禁止事务内 await。 */
export interface SecurityStoreTransaction {
  getInstallation(): SecurityInstallation | undefined
  setInstallation(installation: SecurityInstallation): void
  getRoot(): RootAuthenticationState | undefined
  setRoot(root: RootAuthenticationState): void
  getCredential(profile: string, reference: CredentialRef): CredentialMetadata | undefined
  listCredentials(profile: string): readonly CredentialMetadata[]
  setCredential(metadata: CredentialMetadata): void
  deleteCredential(profile: string, reference: CredentialRef): void
  getBinding(profile: string, componentId: string, slot: string, resourceKey: string): CredentialBinding | undefined
  listBindings(profile: string): readonly CredentialBinding[]
  setBinding(binding: CredentialBinding): void
  deleteBinding(profile: string, componentId: string, slot: string, resourceKey: string): void
  getOperationLevel(profile: string, componentId: string, operation: string): SecurityLevel | undefined
  listOperationLevels(profile: string): readonly OperationLevelRecord[]
  setOperationLevel(record: OperationLevelRecord): void
  deleteOperationLevel(profile: string, componentId: string, operation: string): void
}

export interface SecurityStore {
  transaction<T>(operation: (transaction: SecurityStoreTransaction) => T): T
  dispose?(): void
}

export interface SecurityOptions {
  readonly store?: SecurityStore
  readonly provider?: CredentialProvider
  readonly profile?: string
  readonly clock?: () => number
  /** 组合根专用信任交付；回调不进入普通 security 公开面。 */
  readonly receiveHost?: (host: SecurityHost) => void
}

/** 内部装配只需要组件的 operation 元数据与凭据声明。 */
export type TrustedComponentSpec = ComponentSpec
