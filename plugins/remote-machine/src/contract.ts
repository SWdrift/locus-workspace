import type { Context } from '@deepseek-ai/cordis'
import type {
  OperationCatalogService,
  OperationDefinition,
  OperationProvider,
  OperationRegistration,
  OperationSchema,
  RemoteMachineService,
} from '@locus/contracts'
import { capability } from './capability.ts'

/** 稳定的 Cordis 插件名；只声明操作，不加载领域实现。 */
export const name = 'locus-remote-machine-contract'

export const inject = ['locusOperations']

const input: OperationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['machine'],
  properties: {
    machine: { type: 'string', minLength: 1 },
    address: { type: 'string', minLength: 1 },
  },
}

const output: OperationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['machineId', 'scope', 'source', 'state', 'observedAt'],
  properties: {
    machineId: { type: 'string', minLength: 1 },
    scope: { const: 'single-address' },
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'addressId', 'endpoint'],
      properties: {
        kind: { const: 'ssh' },
        addressId: { type: 'string', minLength: 1 },
        endpoint: { type: 'string', minLength: 1 },
        port: { type: 'integer', minimum: 1, maximum: 65535 },
      },
    },
    state: { enum: ['observed', 'unreachable', 'denied', 'unavailable', 'error'] },
    observedAt: { type: 'string', minLength: 1 },
    host: {
      type: 'object',
      additionalProperties: false,
      required: ['hostname'],
      properties: { hostname: { type: 'string', minLength: 1 } },
    },
    error: { type: 'string' },
  },
}

/** 只读 SSH 观察的公开契约；不包括 CLI 语法或具体应用格式。 */
export const machineObserveDefinition: OperationDefinition = Object.freeze({
  id: 'machine.observe',
  version: 1,
  description: '通过 OpenSSH 对一个 ssh 地址做只读观察；不代表机器全局在线',
  input,
  output,
  capability,
  prerequisites: Object.freeze(['Remote Machine 提供方已加载', '机器已登记且存在 ssh 地址']),
  effects: Object.freeze(['只读取远端 hostname；不修改远端状态']),
  requiresConfirmation: true,
  outcome: '返回 MachineObservation；state 非 observed 仍是领域结果，不是调用错误。',
})

function providerFor(service: RemoteMachineService): OperationProvider {
  return {
    operationId: machineObserveDefinition.id,
    version: machineObserveDefinition.version,
    availability: () => service.availability(),
    execute(inputValue, context) {
      const value = inputValue as { readonly machine: string; readonly address?: string }
      return service.observe(value.machine, value.address, context.signal)
    },
  }
}

/** 非 Cordis 消费方也可注册同一契约；提供方在调用时解析。 */
export function registerRemoteMachineOperations(
  catalog: OperationCatalogService,
  resolve: () => RemoteMachineService | undefined,
): OperationRegistration {
  return catalog.register(machineObserveDefinition, () => {
    const service = resolve()
    return service === undefined ? undefined : providerFor(service)
  })
}

/** Definition 随本 fiber 安装；Provider 缺省时仍可被发现。 */
export function apply(ctx: Context): void {
  const catalog = ctx.get('locusOperations') as OperationCatalogService
  ctx.effect(() => registerRemoteMachineOperations(
    catalog,
    () => ctx.get('locusRemoteMachine') as RemoteMachineService | undefined,
  ))
}
