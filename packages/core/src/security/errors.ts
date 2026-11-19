import { DomainFailure } from '../errors.ts'
import { ComponentFailure } from '../components/errors.ts'
import { i18n } from '../i18n/core.ts'
import { InvocationFailure } from '../invocation/errors.ts'
import type { SecurityChallenge } from './types.ts'

export const SECURITY_FAILURE_CODES = [
  'security-unavailable',
  'security-uninitialized',
  'security-already-initialized',
  'security-disposed',
  'access-denied',
  'authentication-required',
  'authentication-failed',
  'authentication-cancelled',
  'authentication-unavailable',
  'authentication-rate-limited',
  'challenge-expired',
  'challenge-revoked',
  'grant-expired',
  'grant-consumed',
  'grant-revoked',
  'credential-missing',
  'credential-fields-mismatch',
  'provider-unavailable',
  'credential-too-large',
  'delivery-failed',
  'operation-failed',
  'io',
] as const
export type SecurityFailureCode = (typeof SECURITY_FAILURE_CODES)[number]

const ACCESS_DENIED_REASONS = [
  'untrusted-component',
  'unauthorized-component',
  'unsupported-capability',
  'undeclared-capability',
  'resource-mismatch',
  'credential-binding-mismatch',
  'credential-reference-owned',
  'credential-declaration-mismatch',
  'credential-write-requires-root',
  'unsupported-operation',
  'invalid-resource-key',
  'invalid-request',
  'invalid-session',
  'session-ended',
  'invalid-challenge',
  'invalid-grant',
] as const
export type AccessDeniedReason = (typeof ACCESS_DENIED_REASONS)[number]
const REASON_SET = new Set<string>(ACCESS_DENIED_REASONS)

const SECURITY_CODES: ReadonlySet<string> = new Set(SECURITY_FAILURE_CODES)

/** 错误不携带 Provider/消费者原始异常，避免其请求配置与秘密被输出。 */
export class SecurityFailure extends Error {
  readonly kind = 'security' as const
  readonly code: SecurityFailureCode
  readonly reason: AccessDeniedReason | undefined
  readonly challenge: SecurityChallenge | undefined

  constructor(
    code: SecurityFailureCode,
    options?: { readonly reason?: AccessDeniedReason; readonly challenge?: SecurityChallenge },
  ) {
    super(i18n.t(`security.code.${code}`))
    this.name = 'SecurityFailure'
    this.code = code
    this.reason = options?.reason
    this.challenge = options?.challenge
  }
}

export function deny(reason: AccessDeniedReason): never {
  throw new SecurityFailure('access-denied', { reason })
}

/** 只保留可判定的 Provider 分类，永不透传后端异常对象。 */
export function providerFailure(error: unknown): SecurityFailure {
  if (
    error instanceof SecurityFailure &&
    (error.code === 'credential-too-large' || error.code === 'provider-unavailable' || error.code === 'io')
  )
    return new SecurityFailure(error.code)
  return new SecurityFailure('provider-unavailable')
}

/** 已分类的领域错误原样穿透；通用异常仍收为固定安全分类，避免泄漏秘密。 */
export function domainOrOperationFailure(error: unknown): never {
  if (
    error instanceof SecurityFailure ||
    error instanceof DomainFailure ||
    error instanceof InvocationFailure ||
    error instanceof ComponentFailure
  )
    throw error
  throw new SecurityFailure('operation-failed')
}

/** 回调错误只保留固定分类，不接受自造挑战、原始错误或额外属性。 */
export function operationFailure(error: unknown): SecurityFailure {
  if (error instanceof SecurityFailure && SECURITY_CODES.has(error.code) && error.code !== 'authentication-required') {
    return new SecurityFailure(
      error.code,
      error.reason !== undefined && REASON_SET.has(error.reason) ? { reason: error.reason } : undefined,
    )
  }
  return new SecurityFailure('operation-failed')
}
