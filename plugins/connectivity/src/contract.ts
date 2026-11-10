import type { Context } from '@deepseek-ai/cordis'
import type {
  ConnectivityService,
  OperationCatalogService,
  OperationDefinition,
  OperationProvider,
  OperationRegistration,
  OperationSchema,
} from '@locus/contracts'
import { capability } from './capability.ts'

/** 稳定的 Cordis 插件名；只声明操作，不加载领域实现。 */
export const name = 'locus-connectivity-contract'

export const inject = ['locusOperations']

const input: OperationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['profile'],
  properties: {
    profile: { type: 'string', minLength: 1 },
  },
}

const output: OperationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['profileId', 'machineId', 'transport', 'state', 'source', 'startedAt', 'finishedAt', 'durationMs'],
  properties: {
    profileId: { type: 'string', minLength: 1 },
    machineId: { type: 'string', minLength: 1 },
    transport: { enum: ['direct', 'proxy-jump', 'frp'] },
    state: {
      enum: [
        'connected',
        'config-error',
        'denied',
        'host-key',
        'unreachable',
        'target-unavailable',
        'unavailable',
        'error',
      ],
    },
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'transport', 'target'],
      properties: {
        kind: { const: 'ssh' },
        transport: { enum: ['direct', 'proxy-jump', 'frp'] },
        target: { type: 'string', minLength: 1 },
        port: { type: 'integer', minimum: 1, maximum: 65535 },
        user: { type: 'string' },
        proxyJump: { type: 'string' },
      },
    },
    startedAt: { type: 'string', minLength: 1 },
    finishedAt: { type: 'string', minLength: 1 },
    durationMs: { type: 'number', minimum: 0 },
    host: {
      type: 'object',
      additionalProperties: false,
      required: ['hostname'],
      properties: { hostname: { type: 'string', minLength: 1 } },
    },
    error: { type: 'string' },
  },
}

/** 一次只读 hostname 验证的公开契约；不包括 CLI 语法或具体应用格式。 */
export const connectVerifyDefinition: OperationDefinition = Object.freeze({
  id: 'connect.verify',
  version: 1,
  description: '通过 OpenSSH 执行一次只读 hostname 验证；不修改远端状态',
  input,
  output,
  capability,
  prerequisites: Object.freeze([
    'Connectivity 提供方已加载',
    'Profile 属于已登记的 Machine',
    'OpenSSH 可用且主机密钥校验通过',
  ]),
  effects: Object.freeze(['只执行一次只读 hostname；不修改 Profile、SSH 配置或远端状态']),
  requiresConfirmation: true,
  outcome: '返回 ConnectionAttempt；state 非 connected 仍是领域结果，不是调用错误。',
})

function providerFor(service: ConnectivityService): OperationProvider {
  return {
    operationId: connectVerifyDefinition.id,
    version: connectVerifyDefinition.version,
    availability: () => service.availability(),
    execute(inputValue, context) {
      const value = inputValue as { readonly profile: string }
      return service.verify(value.profile, context.signal)
    },
  }
}

/** 非 Cordis 消费方也可注册同一契约；提供方在调用时解析。 */
export function registerConnectivityOperations(
  catalog: OperationCatalogService,
  resolve: () => ConnectivityService | undefined,
): OperationRegistration {
  return catalog.register(connectVerifyDefinition, () => {
    const service = resolve()
    return service === undefined ? undefined : providerFor(service)
  })
}

/** Definition 随本 fiber 安装；Provider 缺省时仍可被发现。 */
export function apply(ctx: Context): void {
  const catalog = ctx.get('locusOperations') as OperationCatalogService
  ctx.effect(() => registerConnectivityOperations(
    catalog,
    () => ctx.get('locusConnectivity') as ConnectivityService | undefined,
  ))
}
