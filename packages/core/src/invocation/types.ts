import type { ComponentCredential } from '../components/types.ts'
import type { CredentialRef, CredentialValues } from '../security/types.ts'

export type LocusMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export const LOCUS_METHODS: readonly LocusMethod[] = Object.freeze(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

/** 输入运行时解析；输出只约束类型，并在契约测试中解析，不在执行后改判业务结果。 */
export interface OperationSchema<T> {
  parse(value: unknown): T
}

export interface CredentialDefinition {
  readonly id: string
  readonly declaration: ComponentCredential
  readonly input: OperationSchema<CredentialValues>
  readonly secretFields: readonly string[]
}

export interface InputField {
  /** 公开说明，不得包含实际凭据或其他秘密值。 */
  readonly description?: string | undefined
  readonly required?: boolean | undefined
  readonly secret?: boolean | undefined
  /** 只有同时声明 tty: true 时，才可显式允许 Host 从可信文件收集。 */
  readonly file?: boolean | undefined
  /** 只能由可信 Host 提供，禁止来自普通 Body。 */
  readonly tty?: boolean | undefined
}

/** 保留重复 query 值；路由、授权与建链共用规范 URI，参数只解码一次。 */
export interface InvocationUrl {
  readonly href: string
  readonly scheme: string
  readonly authority: string
  readonly path: string
  readonly pathParams: Readonly<Record<string, string>>
  readonly query: Readonly<Record<string, readonly string[]>>
}

export interface OperationContext {
  readonly namespace: string
  readonly operationId: string
  readonly requestId: string
  /** 组件自有配置/状态的根目录；由 Host 注入，不来自 URL。 */
  readonly dataDirectory: string
  readonly url: InvocationUrl
  /** 只读组件状态窄视图，供领域组件检查传输等前置条件。 */
  readonly components: {
    get(
      id: string,
    ): { readonly id: string; readonly kind: 'locus' | 'external'; readonly state: string | null } | undefined
  }
  readonly credential: {
    read<T>(
      credential: CredentialDefinition,
      resourceKey: string,
      consume: (values: CredentialValues) => T | Promise<T>,
    ): Promise<T>
    /** 只在实际获准 root 时可用；写当前 namespace、slot、resourceKey。 */
    write(credential: CredentialDefinition, resourceKey: string, values: CredentialValues): Promise<CredentialRef>
  }
  /** 领域事件接入点；Core 填充 specversion/id/source/subject/time。 */
  emit(type: string, data: unknown): void
}

export interface OperationMetadata {
  readonly id: string
  /** 公开用途与必要输入说明，不得包含实际秘密值。 */
  readonly summary?: string | undefined
  readonly method: LocusMethod
  readonly scheme: string
  readonly authority: string
  readonly path: string
  readonly auth: 'user' | 'root' | 'none'
  /** Host 用于展示、收集与脱敏；字段是否有效仍由 input/query schema 决定。 */
  readonly fields?: Readonly<Record<string, InputField>> | undefined
}

/** 运行期发现视图，只包含可公开序列化的声明。 */
export interface OperationDescription extends OperationMetadata {
  readonly component: string
}

export interface OperationDefinition<Q, I, O> extends OperationMetadata {
  readonly query?: OperationSchema<Q>
  readonly input: OperationSchema<I>
  readonly output: OperationSchema<O>
  readonly run: (query: Q, input: I, context: OperationContext) => NoInfer<O> | Promise<NoInfer<O>>
}

export interface ApiRouter {
  register(namespace: string, operation: OperationDefinition<any, any, any>): void
  build(operationId: string, params: Readonly<Record<string, string>>): string
  resolve(
    method: LocusMethod,
    uri: string,
  ): {
    readonly namespace: string
    /** 异构 operation 在路由边界擦除类型；Dispatcher 必须先用其 schema 解析再执行。 */
    readonly operation: OperationDefinition<any, any, any>
    readonly url: InvocationUrl
  }
  readonly operations: readonly {
    readonly namespace: string
    readonly operation: OperationDefinition<any, any, any>
  }[]
}

export type InvocationErrorCode =
  | 'invalid-argument'
  | 'invalid-body'
  | 'invalid-uri'
  | 'unsupported-scheme'
  | 'unsupported-method'
  | 'unsupported-media-type'
  | 'not-found'
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'timeout'
  | 'unavailable'
  | 'unknown-result'
  | 'internal'

export type InvocationResult<T = unknown> = {
  readonly uri: string
  readonly requestId: string
  readonly meta?: Readonly<Record<string, unknown>>
} & (
  | {
      readonly ok: true
      readonly data: T
      readonly links: Readonly<Record<string, string>>
    }
  | {
      readonly ok: false
      readonly error: {
        readonly code: InvocationErrorCode
        readonly message: string
        readonly details?: Readonly<Record<string, unknown>>
      }
    }
)

/** 成功结果的窄类型，便于消费方在 ok 判别后取得 data。 */
export type InvocationSuccess<T = unknown> = InvocationResult<T> & {
  readonly ok: true
  readonly data: T
  readonly links: Readonly<Record<string, string>>
}

/** 失败结果的窄类型，便于 CLI 与测试按 code 分支。 */
export type InvocationFailureResult = InvocationResult<never> & {
  readonly ok: false
  readonly error: {
    readonly code: InvocationErrorCode
    readonly message: string
    readonly details?: Readonly<Record<string, unknown>>
  }
}

/** 不接受 principal；身份只来自可信 Host 的真实 Session。 */
export interface InvocationRequest {
  readonly method: LocusMethod
  readonly uri: string
  readonly body?: unknown
  /** 只接受 application/json 或 +json；未提供时按无 Body 处理。 */
  readonly contentType?: string
}

export interface Dispatcher {
  /** 第二参数只由可信 Host 提供；合并并校验后直接交给可信 handler，不写日志或事件。 */
  invoke(request: InvocationRequest, trustedInput?: Readonly<Record<string, unknown>>): Promise<InvocationResult>
  /** 按输入顺序返回逐项结果；只允许 GET，不因单项业务失败丢弃其他结果。 */
  invokeAll(requests: readonly (InvocationRequest & { readonly method: 'GET' })[]): Promise<readonly InvocationResult[]>
}

/** 组合根可注入的组件状态窄视图；不暴露组件服务或可写入口。 */
export interface ComponentStateView {
  get(
    id: string,
  ): { readonly id: string; readonly kind: 'locus' | 'external'; readonly state: string | null } | undefined
}
