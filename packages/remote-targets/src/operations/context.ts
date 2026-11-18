import { join } from 'node:path'
import { InvocationFailure } from '@locus/core/invocation'
import type { InvocationErrorCode, OperationContext } from '@locus/core/invocation'
import { createRemoteTargetsService } from '../service.ts'
import { RemoteTargetsFailure } from '../types.ts'
import type { RemoteTargetsFailureCode, RemoteTargetsService } from '../types.ts'

const ERROR_CODES: Readonly<Record<RemoteTargetsFailureCode, InvocationErrorCode>> = {
  'invalid-spec': 'invalid-argument',
  'target-exists': 'conflict',
  'target-not-found': 'not-found',
  'ambiguous-target': 'conflict',
  'unsupported-protocol': 'unsupported-scheme',
  'credential-missing': 'not-found',
  'credential-too-large': 'unavailable',
  'capability-unsupported': 'unsupported-method',
  'target-config-mismatch': 'conflict',
  'component-unavailable': 'unavailable',
  'access-denied': 'forbidden',
  'migration-required': 'conflict',
  'already-migrated': 'conflict',
  'encrypted-key-unsupported': 'invalid-argument',
  'delivery-failed': 'unavailable',
  io: 'internal',
}

/** 生命周期与协议错误转换只在 operation 边界处理，直接服务保留领域错误。 */
export async function withService<T>(
  context: OperationContext,
  consume: (service: RemoteTargetsService) => T | Promise<T>,
): Promise<T> {
  let service: RemoteTargetsService | undefined
  try {
    service = createRemoteTargetsService({
      root: join(context.dataDirectory, 'remote-targets'),
      components: context.components,
    })
    return await consume(service)
  } catch (error) {
    if (error instanceof RemoteTargetsFailure) {
      throw new InvocationFailure(ERROR_CODES[error.code], error.message, {
        details: { domain: error.code, ...error.details },
        cause: error,
      })
    }
    throw error
  } finally {
    service?.dispose()
  }
}
