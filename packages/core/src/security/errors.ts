import { DomainFailure } from '../errors.ts'
import { ComponentFailure } from '../components/errors.ts'
import { InvocationFailure } from '../invocation/errors.ts'
import type { SecurityChallenge } from './types.ts'

export type SecurityFailureCode =
  | 'security-unavailable'
  | 'security-uninitialized'
  | 'security-already-initialized'
  | 'security-disposed'
  | 'access-denied'
  | 'authentication-required'
  | 'authentication-failed'
  | 'authentication-cancelled'
  | 'authentication-unavailable'
  | 'authentication-rate-limited'
  | 'challenge-expired'
  | 'challenge-revoked'
  | 'grant-expired'
  | 'grant-consumed'
  | 'grant-revoked'
  | 'credential-missing'
  | 'credential-fields-mismatch'
  | 'provider-unavailable'
  | 'credential-too-large'
  | 'delivery-failed'
  | 'operation-failed'
  | 'io'

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

const MESSAGES: Record<SecurityFailureCode, string> = {
  'security-unavailable': '安全存储尚未配置或无法使用',
  'security-uninitialized': 'Root 安全身份尚未初始化',
  'security-already-initialized': 'Root 安全身份已初始化',
  'security-disposed': '安全服务已释放',
  'access-denied': '拒绝访问',
  'authentication-required': '该操作需要可信 Host 完成 Root 认证',
  'authentication-failed': 'Root 密码验证失败',
  'authentication-cancelled': 'Root 认证已取消',
  'authentication-unavailable': 'Root 认证当前不可用',
  'authentication-rate-limited': 'Root 认证已暂时锁定',
  'challenge-expired': 'Root 认证挑战已过期',
  'challenge-revoked': 'Root 认证挑战已撤销或已经使用',
  'grant-expired': 'Root 操作授权已过期',
  'grant-consumed': 'Root 操作授权已经消费',
  'grant-revoked': 'Root 操作授权已经撤销',
  'credential-missing': '指定凭据尚未录入',
  'credential-fields-mismatch': '凭据字段与当前声明不一致，请重新登记',
  'provider-unavailable': '凭据保管服务不可用',
  'credential-too-large': '凭据超出保管服务容量限制',
  'delivery-failed': '凭据交付失败',
  'operation-failed': '受保护操作执行失败',
  io: '安全存储或凭据保管操作失败',
}

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
    super(MESSAGES[code])
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
  if (
    error instanceof SecurityFailure &&
    Object.hasOwn(MESSAGES, error.code) &&
    error.code !== 'authentication-required'
  ) {
    return new SecurityFailure(
      error.code,
      error.reason !== undefined && REASON_SET.has(error.reason) ? { reason: error.reason } : undefined,
    )
  }
  return new SecurityFailure('operation-failed')
}
