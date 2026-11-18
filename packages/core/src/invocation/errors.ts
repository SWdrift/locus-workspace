import type { ComponentFailureCode } from '../components/errors.ts'
import { isFailure } from '../failure.ts'
import type { Failure, FailureKind } from '../failure.ts'
import type { SecurityFailureCode } from '../security/errors.ts'
import { WORKSPACE_FAILURE_CODES } from '../workspaces/errors.ts'
import type { WorkspaceFailureCode } from '../workspaces/errors.ts'
import { INVOCATION_ERROR_CODES } from './types.ts'
import type { InvocationErrorCode, InvocationFailureResult } from './types.ts'

export { DomainFailure } from '../errors.ts'

/** 协议级失败；领域 operation 在边界显式转换自身错误，可附带原错误作 cause。 */
export class InvocationFailure extends Error {
  readonly kind = 'protocol' as const
  readonly code: InvocationErrorCode
  readonly details: Readonly<Record<string, unknown>> | undefined

  constructor(
    code: InvocationErrorCode,
    message: string,
    options?: { readonly details?: Readonly<Record<string, unknown>>; readonly cause?: unknown },
  ) {
    super(message, options)
    this.name = 'InvocationFailure'
    this.code = code
    this.details = options?.details
  }
}

export function errorResult(
  uri: string,
  requestId: string,
  code: InvocationErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>> | undefined,
  meta?: Readonly<Record<string, unknown>> | undefined,
): InvocationFailureResult {
  return Object.freeze({
    ok: false,
    uri,
    requestId,
    ...(meta === undefined ? {} : { meta: Object.freeze(meta) }),
    error: Object.freeze({ code, message, ...(details === undefined ? {} : { details }) }),
  })
}

const COMPONENT_ERROR_CODES: Readonly<Record<ComponentFailureCode, InvocationErrorCode>> = Object.freeze({
  'invalid-spec': 'invalid-argument',
  'invalid-definition': 'invalid-argument',
  'component-exists': 'conflict',
  'component-not-found': 'not-found',
  'component-package': 'conflict',
  'no-probe': 'unsupported-method',
  'no-deploy': 'unsupported-method',
  'no-external': 'unsupported-method',
  io: 'internal',
})

const SECURITY_ERROR_CODES: Readonly<Record<SecurityFailureCode, InvocationErrorCode>> = Object.freeze({
  'security-unavailable': 'unavailable',
  'security-uninitialized': 'unauthorized',
  'security-already-initialized': 'conflict',
  'security-disposed': 'unavailable',
  'access-denied': 'forbidden',
  'authentication-required': 'unauthorized',
  'authentication-failed': 'unauthorized',
  'authentication-cancelled': 'unauthorized',
  'authentication-unavailable': 'unavailable',
  'authentication-rate-limited': 'unavailable',
  'challenge-expired': 'unauthorized',
  'challenge-revoked': 'unauthorized',
  'grant-expired': 'unauthorized',
  'grant-consumed': 'unauthorized',
  'grant-revoked': 'unauthorized',
  'credential-missing': 'not-found',
  'credential-fields-mismatch': 'invalid-argument',
  'provider-unavailable': 'unavailable',
  'credential-too-large': 'unavailable',
  'delivery-failed': 'unavailable',
  'operation-failed': 'internal',
  io: 'internal',
})

interface FailurePayload {
  readonly code: InvocationErrorCode
  readonly message: string
  readonly details: Readonly<Record<string, unknown>> | undefined
}

const STACK_LIMIT = 40
const PROTOCOL_CODES: ReadonlySet<string> = new Set(INVOCATION_ERROR_CODES)
const WORKSPACE_CODES: ReadonlySet<string> = new Set(WORKSPACE_FAILURE_CODES)

/** 只取帧：剥掉 `name: message` 首行，沿 cause 链拼接，不读取任何消息文本。 */
function debugFrames(error: unknown): readonly string[] | undefined {
  const frames: string[] = []
  for (let current: unknown = error; current instanceof Error && frames.length < STACK_LIMIT; current = current.cause) {
    for (const line of current.stack?.split('\n').slice(1) ?? []) {
      if (line.trim().length > 0 && frames.length < STACK_LIMIT) frames.push(line)
    }
  }
  return frames.length === 0 ? undefined : frames
}

function withStack(
  details: Readonly<Record<string, unknown>> | undefined,
  error: unknown,
  debug: boolean,
): Readonly<Record<string, unknown>> | undefined {
  const stack = debug ? debugFrames(error) : undefined
  return stack === undefined ? details : { ...details, stack }
}

/** 未注册码与未知异常的兜底：固定内部码，领域码只作为根因。 */
function fallback(failure: Failure, debug: boolean): FailurePayload {
  return {
    code: 'internal',
    message: '内部操作失败',
    details: withStack({ domain: failure.code }, failure, debug),
  }
}

function mappedCode<C extends string>(
  table: Readonly<Record<C, InvocationErrorCode>>,
  code: string,
): InvocationErrorCode | undefined {
  return Object.hasOwn(table, code) ? table[code as C] : undefined
}

const HANDLERS = {
  protocol: (failure, debug): FailurePayload => {
    if (!PROTOCOL_CODES.has(failure.code)) return fallback(failure, debug)
    return {
      code: failure.code as InvocationErrorCode,
      message: failure.message,
      details: withStack(failure.details, failure.cause ?? failure, debug),
    }
  },
  security: (failure, debug) => {
    const code = mappedCode(SECURITY_ERROR_CODES, failure.code)
    if (code === undefined) return fallback(failure, debug)
    const details = {
      security: failure.code,
      ...(failure.reason === undefined ? {} : { reason: failure.reason }),
      ...(failure.challenge === undefined ? {} : { challenge: failure.challenge }),
    }
    return { code, message: failure.message, details: withStack(details, failure, debug) }
  },
  component: (failure, debug) => {
    const code = mappedCode(COMPONENT_ERROR_CODES, failure.code)
    if (code === undefined) return fallback(failure, debug)
    return { code, message: failure.message, details: withStack({ component: failure.code }, failure, debug) }
  },
  workspace: (failure, debug) => {
    if (!WORKSPACE_CODES.has(failure.code)) return fallback(failure, debug)
    const code = failure.code as WorkspaceFailureCode
    return {
      code: code === 'disposed' ? 'unavailable' : code,
      message: failure.message,
      details: withStack({ workspace: code }, failure, debug),
    }
  },
  domain: (failure, debug) => fallback(failure, debug),
} satisfies { readonly [K in FailureKind]: (failure: Failure, debug: boolean) => FailurePayload }

/** 唯一分类入口：结构识别后查表；未识别一律固定内部信息。 */
export function toFailure(error: unknown, debug = false): FailurePayload {
  if (!isFailure(error)) {
    const stack = debug ? debugFrames(error) : undefined
    return {
      code: 'internal',
      message: '内部操作失败',
      details: stack === undefined ? undefined : { stack },
    }
  }
  return HANDLERS[error.kind](error, debug)
}
