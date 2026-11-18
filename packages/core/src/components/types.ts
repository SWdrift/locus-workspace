import type { CredentialDefinition, OperationDefinition, OperationMetadata } from '../invocation/types.ts'

/** 组件类别：包提供的组件，或仅在数据目录登记的外部组件。 */
export type ComponentKind = 'locus' | 'external'

/** 外部软件的观察状态；未探查不落值。 */
export type ExternalState = 'healthy' | 'stopped' | 'abnormal' | 'absent'

/** 部署状态；`not-deployable` 表示定义没有部署入口。 */
export type DeployState = 'deployed' | 'failed' | 'not-deployed' | 'not-deployable'

export interface ComponentInfo {
  readonly text?: string
  readonly json?: unknown
}

export interface ArgvProbe {
  readonly kind?: 'argv'
  readonly argv: readonly string[]
  readonly timeoutMs?: number
  /** 探针非零退出时的归类；默认 abnormal。 */
  readonly onFailure?: 'stopped' | 'abnormal'
}

export interface TcpProbe {
  readonly kind: 'tcp'
  readonly host: string
  readonly port: number
  readonly timeoutMs?: number
  readonly onFailure?: 'stopped' | 'abnormal'
}

export interface HttpProbe {
  readonly kind: 'http'
  readonly url: string
  /** 期望状态码；默认 200。 */
  readonly expectStatus?: number
  readonly timeoutMs?: number
  readonly onFailure?: 'stopped' | 'abnormal'
}

export type ComponentProbe = ArgvProbe | TcpProbe | HttpProbe

export interface ComponentDeploy {
  readonly argv: readonly string[]
  readonly timeoutMs?: number
}

/** 组件自有配置：内联映射，或相对数据目录的路径（文件/文件夹）。 */
export type ComponentConfig = Readonly<Record<string, unknown>> | string

/** 凭据字段；秘密字段进入 Keyring，公开字段进入 SQLite 元数据。 */
export interface CredentialField {
  readonly name: string
  readonly secret: boolean
  readonly required: boolean
}

/** 组件声明的凭据槽；字段结构属于可信代码契约。 */
export interface ComponentCredential {
  readonly id: string
  readonly fields: readonly CredentialField[]
}

/** 组件元数据；operation 与凭据由两个定义视图分别扩展。 */
interface ComponentMetadata {
  readonly id: string
  readonly version: string
  readonly name: string
  readonly summary: string
  readonly kind: ComponentKind
  readonly requires?: readonly string[]
  readonly config?: ComponentConfig
  readonly probe?: ComponentProbe
  readonly deploy?: ComponentDeploy
  readonly info?: ComponentInfo
}

/** Core 消费的可序列化定义；不包含函数。 */
export interface ComponentSpec extends ComponentMetadata {
  readonly operations?: readonly OperationMetadata[]
  readonly credentials?: readonly ComponentCredential[]
}

/** 包作者写的一份定义；operation 带 handler。 */
export interface ComponentDefinition extends ComponentMetadata {
  readonly operations?: readonly OperationDefinition<any, any, any>[]
  readonly credentials?: readonly CredentialDefinition[]
}

/** defineComponent 的两个运行时视图。 */
export interface DefinedComponent {
  readonly component: ComponentSpec
  readonly operations: readonly OperationDefinition<any, any, any>[]
}

export interface ComponentExternalView {
  readonly state: ExternalState | null
  readonly detail: string
  readonly checkedAt?: string | undefined
  readonly source: 'probe' | 'derived'
}

export interface ComponentDeployView {
  readonly state: DeployState
  readonly detail: string
  readonly checkedAt?: string | undefined
}

export interface ComponentView {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly kind: ComponentKind
  readonly version: string
  readonly codeVersion?: string | undefined
  readonly needsUpgrade: boolean
  readonly requires: readonly string[]
  readonly operations?: readonly OperationMetadata[] | undefined
  readonly credentials?: readonly ComponentCredential[] | undefined
  readonly source: 'package' | 'dynamic'
  readonly definitionPath: string
  readonly configPath?: string | undefined
  readonly info?: ComponentInfo | undefined
  readonly external?: ComponentExternalView | undefined
  readonly deploy: ComponentDeployView
}

export interface ComponentProblem {
  readonly id: string
  readonly source: 'package' | 'dynamic'
  readonly path: string
  readonly error: string
}

export interface ComponentList {
  readonly components: readonly ComponentView[]
  readonly problems: readonly ComponentProblem[]
}

export interface ComponentRemoval {
  readonly component: string
  readonly removed: true
}

export interface ComponentProbeAll {
  readonly probed: readonly ComponentView[]
  readonly skipped: readonly { readonly id: string; readonly reason: string }[]
}

export interface ComponentsService {
  list(): ComponentList
  show(id: string): ComponentView
  addFromText(text: string): ComponentView
  addFromPath(path: string): ComponentView
  remove(id: string): void
  upgrade(id: string): ComponentView
  probe(id: string): Promise<ComponentView>
  deploy(id: string): Promise<ComponentView>
  dispose(): void
}

export interface ComponentServiceOptions {
  readonly dataDirectory: string
  readonly definitions?: readonly ComponentSpec[]
  readonly runner?: ComponentRunner
}

export interface ComponentCommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  /** 子进程未能启动时的系统错误码，如 `ENOENT`。 */
  readonly errorCode: string | null
  readonly timedOut: boolean
}

/** 组件探针与部署命令的执行边界；测试注入假实现。 */
export interface ComponentRunner {
  run(argv: readonly string[], options: { timeoutMs: number }): Promise<ComponentCommandResult>
}
