import { execFile } from 'node:child_process'
import type { ExecFileException } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import {
  REMOTE_MACHINE_NAMESPACE,
  type CapabilityDescriptor,
  type LocusService,
  type MachineAddress,
  type MachineObservation,
  type MachineObservationSource,
  type RemoteMachineService,
  type ResourceReference,
} from '@locus/contracts'
import { RemoteMachineStore } from './store.ts'

/** 稳定的 Cordis 插件名。 */
export const name = 'locus-remote-machine'

/** 只依赖公开的 Locus 用例；不要求 Core 装配领域插件。 */
export const inject = ['locus']

/** 提供方声明；Tag 只用于分类，不代表权限或当前可达性。 */
export const capability: CapabilityDescriptor = Object.freeze({
  id: 'locus.remote-machine',
  provider: '@locus/remote-machine',
  tags: Object.freeze(['environment']),
})

export interface RemoteCommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly error: {
    readonly code?: string | number
    readonly killed?: boolean
    readonly signal?: string
  } | null
}

export interface RemoteMachineServiceOptions {
  /** 测试或替换 SSH 传输的窄 seam；默认使用本机 OpenSSH。 */
  readonly run?: (args: readonly string[], signal?: AbortSignal) => Promise<RemoteCommandResult>
}

function executeSsh(args: readonly string[], signal?: AbortSignal): Promise<RemoteCommandResult> {
  const { promise, resolve } = Promise.withResolvers<RemoteCommandResult>()
  execFile('ssh', [...args], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 64 * 1024,
    env: {
      ...process.env,
      LC_ALL: 'C',
      LANG: 'C',
      SSH_ASKPASS_REQUIRE: 'never',
    },
    ...(signal === undefined ? {} : { signal }),
  }, (error: ExecFileException | null, stdout, stderr) => {
    resolve({
      stdout,
      stderr,
      error: error === null
        ? null
        : {
          ...(error.code === undefined || error.code === null ? {} : { code: error.code }),
          ...(error.killed === undefined ? {} : { killed: error.killed }),
          ...(error.signal === undefined ? {} : { signal: error.signal }),
        },
    })
  })
  return promise
}

function failure(result: RemoteCommandResult): { state: MachineObservation['state']; error: string } {
  const error = result.error
  if (error?.code === 'ENOENT') {
    return { state: 'unavailable', error: '当前环境未找到 OpenSSH；机器登记与关联仍可用，远程观察不可用。' }
  }
  if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return { state: 'error', error: 'SSH 观察输出超过 64 KiB 上限' }
  }
  if (error?.killed || error?.signal === 'SIGTERM') {
    return { state: 'unreachable', error: 'SSH 观察超过 10 秒时限，已终止' }
  }
  const detail = result.stderr.toLowerCase()
  if (/permission denied|authentication failed|no supported authentication methods/.test(detail)) {
    return { state: 'denied', error: 'SSH 认证被拒绝；未读取或保存任何凭据。' }
  }
  if (/host key verification failed|remote host identification has changed/.test(detail)) {
    return { state: 'denied', error: 'SSH 主机密钥校验失败；未自动信任新主机。' }
  }
  if (/connection refused|connection timed out|operation timed out|could not resolve|no route to host|network is unreachable|banner exchange/.test(detail)) {
    return { state: 'unreachable', error: 'SSH 通路当前不可达；这不证明机器不存在或已下线。' }
  }
  return {
    state: 'error',
    error: `SSH 观察失败 (${String(error?.code ?? error?.signal ?? 'UNKNOWN')})`,
  }
}

function sourceOf(address: MachineAddress): MachineObservationSource {
  return {
    kind: 'ssh',
    addressId: address.id,
    endpoint: address.value,
    ...(address.port === undefined ? {} : { port: address.port }),
  }
}

function observedHostname(stdout: string): string | undefined {
  const line = stdout.trim().split(/\r?\n/, 1)[0] ?? ''
  const hostname = line.replace(/[\p{Cc}]/gu, '').trim().slice(0, 255)
  return hostname.length === 0 ? undefined : hostname
}

/** 创建机器资料与只读 SSH 观察用例；观察不持久化，也不修改远端系统。 */
export function createRemoteMachineService(
  locus: LocusService,
  options: RemoteMachineServiceOptions = {},
): RemoteMachineService & { dispose(): Promise<void> } {
  const store = new RemoteMachineStore(locus.dataDirectory)
  const execute = options.run ?? executeSsh
  const pending = new Set<Promise<unknown>>()
  let disposed = false
  let disposal: Promise<void> | undefined

  function assertActive(): void {
    if (disposed) throw new Error('Remote Machine 服务已释放')
  }

  async function withPending<T>(action: () => Promise<T>): Promise<T> {
    assertActive()
    const operation = action()
    pending.add(operation)
    try {
      return await operation
    } finally {
      pending.delete(operation)
    }
  }

  function requireMachine(machineId: string) {
    assertActive()
    return store.get(machineId)
  }

  function reference(machineId: string): ResourceReference {
    return { namespace: REMOTE_MACHINE_NAMESPACE, id: requireMachine(machineId).id }
  }

  return {
    capability,
    availability() {
      return withPending(async () => {
        const result = await execute(['-V'])
        return result.error
          ? {
            available: false,
            error: '当前环境未找到可用的 OpenSSH；机器登记、资料与关联仍可用，远程观察不可用。',
          }
          : { available: true }
      })
    },
    register(name, description) {
      assertActive()
      return store.register(name, description)
    },
    list() {
      assertActive()
      return store.list()
    },
    get(machineId) {
      return requireMachine(machineId)
    },
    update(machineId, changes) {
      assertActive()
      return store.update(machineId, changes)
    },
    addAddress(machineId, address) {
      assertActive()
      return store.addAddress(machineId, address)
    },
    updateAddress(machineId, addressId, changes) {
      assertActive()
      return store.updateAddress(machineId, addressId, changes)
    },
    removeAddress(machineId, addressId) {
      assertActive()
      return store.removeAddress(machineId, addressId)
    },
    reference(machineId) {
      return reference(machineId)
    },
    observe(machineId, addressId, signal) {
      return withPending(async () => {
        const machine = requireMachine(machineId)
        const address = addressId === undefined
          ? machine.addresses.find((item) => item.kind === 'ssh')
          : machine.addresses.find((item) => item.id === addressId)
        if (!address) {
          throw new Error(
            addressId === undefined
              ? `Remote Machine ${machine.id} 没有 SSH 地址；先添加 ssh 地址再观察。`
              : `Remote Machine ${machine.id} 中不存在地址：${addressId}`,
          )
        }
        if (address.kind !== 'ssh') {
          throw new Error(`地址 ${address.id} 不是 ssh 类型；Remote Machine 当前只通过 SSH 观察。`)
        }
        const observedAt = new Date().toISOString()
        const source = sourceOf(address)
        const result = await execute([
          '-o', 'BatchMode=yes',
          '-o', 'ConnectTimeout=5',
          '-o', 'ConnectionAttempts=1',
          '-o', 'ClearAllForwardings=yes',
          '-o', 'ForwardAgent=no',
          '-o', 'ForwardX11=no',
          '-o', 'PermitLocalCommand=no',
          ...(address.port === undefined ? [] : ['-p', String(address.port)]),
          address.value,
          'hostname',
        ], signal)
        if (result.error) {
          return {
            machineId: machine.id,
            scope: 'single-address',
            source,
            observedAt,
            ...failure(result),
          }
        }
        const hostname = observedHostname(result.stdout)
        if (hostname === undefined) {
          return {
            machineId: machine.id,
            scope: 'single-address',
            source,
            state: 'error',
            observedAt,
            error: 'SSH 命令成功，但没有返回可用的主机名。',
          }
        }
        return {
          machineId: machine.id,
          scope: 'single-address',
          source,
          state: 'observed',
          observedAt,
          host: { hostname },
        }
      })
    },
    dispose() {
      if (!disposal) {
        disposed = true
        disposal = Promise.allSettled(pending).then(() => {
          store.close()
        })
      }
      return disposal
    },
  }
}

/** 将领域用例提供给当前 fiber；卸载不会删除机器资料、地址或 Workspace 关联。 */
export function apply(ctx: Context): void {
  const service = createRemoteMachineService(ctx.get('locus') as LocusService)
  ctx.provide('locusRemoteMachine', service)
  ctx.effect(() => () => service.dispose())
}
