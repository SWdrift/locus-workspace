import { ComponentFailure } from '../components/errors.ts'
import type { ComponentFailureCode } from '../components/errors.ts'
import { SecurityFailure } from '../security/errors.ts'
import type { SecurityFailureCode } from '../security/errors.ts'
import { WorkspaceFailure } from '../workspaces/errors.ts'
import type { InvocationErrorCode, InvocationFailureResult } from './types.ts'

export { DomainFailure } from '../errors.ts'

/** 协议级失败；领域 operation 在边界显式转换自身错误。 */
export class InvocationFailure extends Error {
  readonly code: InvocationErrorCode
  readonly details: Readonly<Record<string, unknown>> | undefined

  constructor(code: InvocationErrorCode, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message)
    this.name = 'InvocationFailure'
    this.code = code
    this.details = details
  }
}

export function errorResult(
  uri: string,
  requestId: string,
  code: InvocationErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): InvocationFailureResult {
  return Object.freeze({
    ok: false,
    uri,
    requestId,
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

export function toFailure(error: unknown): {
  code: InvocationErrorCode
  message: string
  details?: Readonly<Record<string, unknown>>
} {
  if (error instanceof InvocationFailure) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    }
  }
  if (error instanceof SecurityFailure) {
    return {
      code: SECURITY_ERROR_CODES[error.code],
      message: error.message,
      details: {
        security: error.code,
        ...(error.reason === undefined ? {} : { reason: error.reason }),
        ...(error.challenge === undefined ? {} : { challenge: error.challenge }),
      },
    }
  }
  if (error instanceof ComponentFailure) {
    return {
      code: COMPONENT_ERROR_CODES[error.code],
      message: error.message,
      details: { component: error.code },
    }
  }
  if (error instanceof WorkspaceFailure) {
    return {
      code: error.code === 'disposed' ? 'unavailable' : error.code,
      message: error.message,
      details: { workspace: error.code },
    }
  }
  if (error instanceof Error) return { code: 'internal', message: '内部操作失败' }
  return { code: 'internal', message: '未知错误' }
}
