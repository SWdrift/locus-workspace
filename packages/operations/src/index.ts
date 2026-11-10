import Ajv, { type ErrorObject, type Schema, type ValidateFunction } from 'ajv'
import type {
  CapabilityDescriptor,
  OperationAvailability,
  OperationCatalogService,
  OperationDefinition,
  OperationInvocationContext,
  OperationInvocationError,
  OperationInvocationResult,
  OperationProvider,
  OperationProviderAvailability,
  OperationProviderBinder,
  OperationRegistration,
} from '@locus/contracts'

export interface OperationCatalogOptions {
  /** 由宿主提供的 Workspace 能力选择检查；只有调用上下文带 Workspace 时使用。 */
  readonly isCapabilitySelected?: (workspaceId: string, capability: CapabilityDescriptor) => boolean
}

export interface OperationCatalog extends OperationCatalogService {
  dispose(): void
}

interface CatalogEntry {
  readonly definition: OperationDefinition
  readonly bind: OperationProviderBinder
  readonly validateInput: ValidateFunction
  readonly validateOutput: ValidateFunction
}

type Unavailable = Extract<OperationAvailability, { state: 'unavailable' }>

function isUnavailable(value: OperationAvailability | undefined): value is Unavailable {
  return value?.state === 'unavailable'
}

function now(): string {
  return new Date().toISOString()
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatErrors(errors: readonly ErrorObject[] | null | undefined): readonly string[] {
  return (errors ?? []).map((error) => {
    const params = error.params as { readonly missingProperty?: unknown }
    const missing = typeof params.missingProperty === 'string' ? params.missingProperty : undefined
    const path = missing === undefined
      ? (error.instancePath.length === 0 ? '/' : error.instancePath)
      : `${error.instancePath}/${missing}`
    return `${path} ${error.message ?? '不符合 Schema'}`
  })
}

function unavailable(
  code: Extract<OperationAvailability, { state: 'unavailable' }>['code'],
  message: string,
): Unavailable {
  return { state: 'unavailable', code, message }
}

function failure(
  operationId: string,
  startedAt: string,
  code: OperationInvocationError['code'],
  message: string,
  details?: readonly string[],
): OperationInvocationResult {
  return {
    ok: false,
    operationId,
    startedAt,
    finishedAt: now(),
    error: {
      code,
      message,
      ...(details === undefined || details.length === 0 ? {} : { details }),
    },
  }
}

/**
 * 创建轻量 Operation Catalog：发现 Definition、按调用解析 Provider、校验输入输出。
 * 不持有领域语义，不授予权限；Provider 的外部可用性通过 availability 暴露，
 * invoke 仍执行领域操作，让不可达等结果保持为领域 Outcome。
 */
export function createOperationCatalog(options: OperationCatalogOptions = {}): OperationCatalog {
  const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true })
  const entries = new Map<string, CatalogEntry>()
  const compiled = new WeakMap<OperationDefinition, { input: ValidateFunction; output: ValidateFunction }>()
  let disposed = false

  function assertActive(): void {
    if (disposed) throw new Error('Operation Catalog 已释放')
  }

  function validatorsFor(definition: OperationDefinition): { input: ValidateFunction; output: ValidateFunction } {
    const existing = compiled.get(definition)
    if (existing) return existing
    const validators = {
      input: ajv.compile(definition.input as Schema),
      output: ajv.compile(definition.output as Schema),
    }
    compiled.set(definition, validators)
    return validators
  }

  function capabilityFailure(
    definition: OperationDefinition,
    context: OperationInvocationContext | undefined,
  ): OperationAvailability | undefined {
    if (definition.capability === undefined || context?.workspaceId === undefined) return undefined
    const selected = options.isCapabilitySelected?.(context.workspaceId, definition.capability) ?? false
    if (selected) return undefined
    return unavailable(
      'capability-not-selected',
      `Workspace ${context.workspaceId} 尚未选择能力 ${definition.capability.id}（${definition.capability.provider}）。`,
    )
  }

  function providerFailure(
    definition: OperationDefinition,
    bind: OperationProviderBinder,
  ): { provider: OperationProvider } | { failure: Unavailable } {
    const provider = bind()
    if (provider === undefined) {
      return {
        failure: unavailable('provider-missing', `操作 ${definition.id} 的提供方未加载。`),
      }
    }
    if (provider.operationId !== definition.id || provider.version !== definition.version) {
      return {
        failure: unavailable(
          'contract-mismatch',
          `操作 ${definition.id} 的提供方版本不匹配：期望 ${definition.version}，实际 ${String(provider.version)}。`,
        ),
      }
    }
    return { provider }
  }

  function availability(
    operationId: string,
    context?: OperationInvocationContext,
  ): Promise<OperationAvailability> {
    assertActive()
    const entry = entries.get(operationId)
    if (entry === undefined) {
      return Promise.resolve(unavailable('definition-missing', `操作 ${operationId} 的定义未安装。`))
    }
    const resolved = providerFailure(entry.definition, entry.bind)
    if ('failure' in resolved) return Promise.resolve(resolved.failure)
    const capability = capabilityFailure(entry.definition, context)
    if (capability !== undefined) return Promise.resolve(capability)
    let pending: OperationProviderAvailability | Promise<OperationProviderAvailability>
    try {
      pending = resolved.provider.availability()
    } catch (error) {
      return Promise.resolve(unavailable('provider-unavailable', messageOf(error)))
    }
    return Promise.resolve(pending).then(
      (result) => result.available
        ? { state: 'available' as const }
        : unavailable('provider-unavailable', result.error ?? `操作 ${operationId} 的提供方当前不可用。`),
      (error: unknown) => unavailable('provider-unavailable', messageOf(error)),
    )
  }

  function registration(
    definition: OperationDefinition,
    bind: OperationProviderBinder,
  ): OperationRegistration {
    assertActive()
    if (entries.has(definition.id)) throw new Error(`操作 ${definition.id} 已注册，不能重复注册。`)
    const validators = validatorsFor(definition)
    entries.set(definition.id, {
      definition,
      bind,
      validateInput: validators.input,
      validateOutput: validators.output,
    })
    let active = true
    return () => {
      if (!active) return
      active = false
      if (entries.get(definition.id)?.definition === definition) entries.delete(definition.id)
    }
  }

  async function invoke(
    operation: OperationDefinition | string,
    input: unknown,
    context: OperationInvocationContext = {},
  ): Promise<OperationInvocationResult> {
    assertActive()
    const startedAt = now()
    const operationId = typeof operation === 'string' ? operation : operation.id
    const entry = entries.get(operationId)
    if (entry === undefined) {
      return failure(operationId, startedAt, 'definition-missing', `操作 ${operationId} 的定义未安装。`)
    }
    if (typeof operation !== 'string' && operation.version !== entry.definition.version) {
      return failure(
        operationId,
        startedAt,
        'contract-mismatch',
        `操作 ${operationId} 的调用契约版本已变化：期望 ${operation.version}，当前 ${entry.definition.version}。`,
      )
    }
    const definition = typeof operation === 'string' ? entry.definition : operation
    const resolved = providerFailure(definition, entry.bind)
    if ('failure' in resolved) {
      return failure(
        operationId,
        startedAt,
        resolved.failure.code === 'provider-missing' ? 'provider-missing' : 'contract-mismatch',
        resolved.failure.message,
      )
    }
    const capability = capabilityFailure(definition, context)
    if (isUnavailable(capability)) {
      return failure(operationId, startedAt, 'capability-not-selected', capability.message)
    }
    const validators = validatorsFor(definition)
    if (!validators.input(input)) {
      return failure(
        operationId,
        startedAt,
        'invalid-input',
        `输入不符合操作 ${operationId} 的契约。`,
        formatErrors(validators.input.errors),
      )
    }
    let value: unknown
    try {
      value = await resolved.provider.execute(input, context)
    } catch (error) {
      return failure(operationId, startedAt, 'invocation-error', messageOf(error))
    }
    if (!validators.output(value)) {
      return failure(
        operationId,
        startedAt,
        'invalid-output',
        `操作 ${operationId} 的返回值不符合契约。`,
        formatErrors(validators.output.errors),
      )
    }
    return { ok: true, operationId, value, startedAt, finishedAt: now() }
  }

  return {
    register: registration,
    list() {
      assertActive()
      return [...entries.values()]
        .map((entry) => entry.definition)
        .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    },
    get(operationId) {
      assertActive()
      return entries.get(operationId)?.definition
    },
    availability,
    invoke,
    dispose() {
      if (disposed) return
      disposed = true
      entries.clear()
    },
  }
}
