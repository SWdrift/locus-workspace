import type { ComponentSpec } from '../components/spec.ts'

export type SecurityLevel = 'user' | 'root'
export type SecuritySource = 'human' | 'agent' | 'component'
export type SecurityGrantScope = 'operation' | 'session'
export type CredentialRef = `credential:${string}`
export type CredentialValues = Readonly<Record<string, string>>
export type SecurityParameters = null | boolean | number | string | readonly SecurityParameters[] | { readonly [key: string]: SecurityParameters }

/** Security 领域的精确资源；Workspace 关系继续使用 ResourceReference。 */
export interface SecurityResource {
  readonly type: string
  readonly id: string
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

/** 一次组件能力调用的授权请求；不携带秘密输入。 */
export interface SecurityRequest {
  readonly capability: string
  readonly resource: SecurityResource
  readonly parameters: SecurityParameters
}

/** 组件能力与精确资源的凭据绑定；slot 是组件声明的凭据槽。 */
export interface CredentialBinding {
  readonly profile: string
  readonly componentId: string
  readonly capability: string
  readonly slot: string
  readonly resource: SecurityResource
  readonly reference: CredentialRef
  readonly createdAt: number
  readonly updatedAt: number
}

export interface UnbindCredentialInput {
  readonly componentId: string
  readonly capability: string
  readonly resource: SecurityResource
  readonly slot: string
}

/** Root 对组件能力的认证等级覆盖。 */
export interface CapabilityLevelRecord {
  readonly profile: string
  readonly componentId: string
  readonly capability: string
  readonly level: SecurityLevel
  readonly updatedAt: number
}

export interface SetCapabilityLevelInput {
  readonly componentId: string
  readonly capability: string
  readonly level: SecurityLevel
}

export interface ClearCapabilityLevelInput {
  readonly componentId: string
  readonly capability: string
}

/** 组件的默认、覆盖与最终生效等级；source 说明最终值来自哪里。 */
export interface CapabilityAuthority {
  readonly componentId: string
  readonly capability: string
  readonly defaultAuthLevel: SecurityLevel
  readonly effectiveAuthLevel: SecurityLevel
  readonly source: 'override' | 'component' | 'default'
}

export interface CredentialStatus {
  readonly metadata: CredentialMetadata
  readonly present: boolean
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
  readonly operationId: string
  readonly sessionId: string
  readonly subject: 'user'
  readonly componentId: string
  readonly capability: string
  readonly resource: SecurityResource
  readonly expiresAt: number
}

/** 授权依赖 Core 内部记录与对象身份，复制公开字段不能获得权限。 */
export interface SecurityGrant {
  readonly grantId: string
  readonly operationId: string
  readonly sessionId: string
  readonly subject: 'user'
  readonly authorizedBy: 'root'
  readonly scope: SecurityGrantScope
  readonly componentId: string
  readonly capability: string
  readonly resource: SecurityResource
  /** operation 为固定有效期；session 在 Session 结束时失效，故为 null。 */
  readonly expiresAt: number | null
}

/** 组件 handler 的唯一凭据入口；Core 在授权后注入。 */
export interface CapabilityContext {
  registerCredential(
    slot: string,
    reference: CredentialRef,
    values: CredentialValues,
  ): Promise<void>

  withCredential<T>(
    slot: string,
    reference: CredentialRef,
    consume: (values: CredentialValues) => T | Promise<T>,
  ): Promise<T>
}

/** 只交付给绑定了可信定义与会话的组件，不提供认证或原始凭据导出入口。 */
export interface ComponentSecurity {
  /**
   * 预检能力、资源与 read 槽，再执行授权。root 级操作抛出
   * authentication-required；resume 后在同一回调内注入 CapabilityContext。
   */
  execute<T>(
    request: SecurityRequest,
    operation: (context: CapabilityContext, snapshot: SecurityRequest) => T | Promise<T>,
  ): Promise<T>
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
  execute<T>(request: SecurityRequest, operation: (snapshot: SecurityRequest) => T | Promise<T>): Promise<T>
  listCredentials(): Promise<readonly CredentialMetadata[]>
  deleteCredential(reference: CredentialRef): Promise<void>
  listBindings(): Promise<readonly CredentialBinding[]>
  unbindCredential(input: UnbindCredentialInput): Promise<boolean>
  credentialStatus(reference: CredentialRef): Promise<CredentialStatus>
  cleanupCredentialOrphans(apply: boolean): Promise<CredentialCleanupResult>
  changeRootPassword(password: string, confirmation: string): Promise<void>
  setCapabilityLevel(input: SetCapabilityLevelInput): Promise<CapabilityAuthority>
  clearCapabilityLevel(input: ClearCapabilityLevelInput): Promise<CapabilityAuthority>
  listCapabilityAuthorities(): Promise<readonly CapabilityAuthority[]>
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
  bindComponent(session: SecuritySession, definition: ComponentSpec): ComponentSecurity
  forSession(session: SecuritySession): HostSecurity
  initializeRoot(password: string, confirmation: string): Promise<void>
  resetRoot(password: string, confirmation: string): Promise<void>
  authenticate(
    challenge: SecurityChallenge,
    password: string,
    scope?: SecurityGrantScope,
  ): Promise<SecurityGrant>
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
  getBinding(
    profile: string,
    componentId: string,
    capability: string,
    resource: SecurityResource,
    slot: string,
  ): CredentialBinding | undefined
  listBindings(profile: string): readonly CredentialBinding[]
  setBinding(binding: CredentialBinding): void
  deleteBinding(
    profile: string,
    componentId: string,
    capability: string,
    resource: SecurityResource,
    slot: string,
  ): void
  getCapabilityLevel(profile: string, componentId: string, capability: string): SecurityLevel | undefined
  listCapabilityLevels(profile: string): readonly CapabilityLevelRecord[]
  setCapabilityLevel(record: CapabilityLevelRecord): void
  deleteCapabilityLevel(profile: string, componentId: string, capability: string): void
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
