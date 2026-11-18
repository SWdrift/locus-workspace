/** 失败分类轴由 Core 拥有；新增 kind 必须同时提供处理器。 */
export const FAILURE_KINDS = ['protocol', 'security', 'component', 'workspace', 'domain'] as const
export type FailureKind = (typeof FAILURE_KINDS)[number]

/**
 * 统一失败界面：只按结构识别，组件无需继承 Core 类型。
 * code 保持 string，封闭性由各 kind 的码表校验落实。
 */
export interface Failure {
  readonly kind: FailureKind
  readonly code: string
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>>
  readonly cause?: unknown
  readonly reason?: string
  readonly challenge?: unknown
}

const KIND_SET: ReadonlySet<string> = new Set(FAILURE_KINDS)

/** 结构守卫：kind 属于词表且 code/message 为字符串即可参与分类。 */
export function isFailure(value: unknown): value is Failure {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { readonly kind?: unknown; readonly code?: unknown; readonly message?: unknown }
  return (
    typeof candidate.kind === 'string' &&
    KIND_SET.has(candidate.kind) &&
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string'
  )
}
