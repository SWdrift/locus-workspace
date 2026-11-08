import { execFile } from 'node:child_process'
import type { ExecFileException } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { connect as tcpConnect } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import {
  type CapabilityDescriptor,
  type ConnectionAttempt,
  type ConnectionCheck,
  type ConnectionInspection,
  type ConnectionOpen,
  type ConnectionProfile,
  type ConnectionResolved,
  type ConnectivityService,
  type LocusService,
  type RemoteMachineService,
} from '@locus/contracts'
import { ConnectivityStore } from './store.ts'

/** 稳定的 Cordis 插件名。 */
export const name = 'locus-connectivity'

/** Connection Profile 依赖 Remote Machine 的公开机器用例。 */
export const inject = ['locus', 'locusRemoteMachine']

/** 提供方声明；Tag 只用于分类，不代表权限或当前可达性。 */
export const capability: CapabilityDescriptor = Object.freeze({
  id: 'locus.connectivity',
  provider: '@locus/connectivity',
  tags: Object.freeze(['connectivity']),
})

export interface ConnectivityCommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly error: {
    readonly code?: string | number
    readonly killed?: boolean
    readonly signal?: string
  } | null
}

export type TcpProbeResult = 'listening' | 'refused' | 'timeout' | 'error'

export interface ConnectivityServiceOptions {
  /** 测试或替换 SSH 传输的窄 seam；默认使用本机 OpenSSH。 */
  readonly run?: (args: readonly string[], signal?: AbortSignal) => Promise<ConnectivityCommandResult>
  /** FRP visitor 本地端口探测 seam；不连接远端。 */
  readonly probeTcp?: (host: string, port: number) => Promise<TcpProbeResult>
}

function executeSsh(args: readonly string[], signal?: AbortSignal): Promise<ConnectivityCommandResult> {
  const { promise, resolve } = Promise.withResolvers<ConnectivityCommandResult>()
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

function probeTcp(host: string, port: number): Promise<TcpProbeResult> {
  const { promise, resolve } = Promise.withResolvers<TcpProbeResult>()
  const socket = tcpConnect({ host, port })
  let settled = false
  const finish = (result: TcpProbeResult): void => {
    if (settled) return
    settled = true
    socket.destroy()
    resolve(result)
  }
  socket.setTimeout(1500)
  socket.once('connect', () => finish('listening'))
  socket.once('timeout', () => finish('timeout'))
  socket.once('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'ECONNREFUSED') finish('refused')
    else finish('error')
  })
  return promise
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return `${homedir()}/${path.slice(2)}`
  return path
}

function baseOptions(): string[] {
  return [
    '-o', 'ConnectTimeout=5',
    '-o', 'ConnectionAttempts=1',
    '-o', 'ClearAllForwardings=yes',
    '-o', 'ForwardAgent=no',
    '-o', 'ForwardX11=no',
    '-o', 'PermitLocalCommand=no',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'KbdInteractiveAuthentication=no',
  ]
}

function applyProfileOptions(args: string[], profile: ConnectionProfile, verify: boolean): void {
  if (profile.sshConfigFile !== undefined) args.push('-F', profile.sshConfigFile)
  args.push(...baseOptions())
  if (verify) args.push('-o', 'BatchMode=yes')
  if (profile.identityFile !== undefined) args.push('-i', profile.identityFile, '-o', 'IdentitiesOnly=yes')
  if (profile.knownHostsFile !== undefined) args.push('-o', `UserKnownHostsFile=${profile.knownHostsFile}`)
  if (profile.proxyJump !== undefined) args.push('-J', profile.proxyJump)
  if (profile.user !== undefined) args.push('-l', profile.user)
  if (profile.port !== undefined) args.push('-p', String(profile.port))
}

function commandArguments(profile: ConnectionProfile, mode: 'inspect' | 'verify' | 'open'): string[] {
  const args: string[] = []
  applyProfileOptions(args, profile, mode !== 'open')
  if (mode === 'inspect') {
    args.push('-G', profile.target)
  } else if (mode === 'verify') {
    args.push('-T', profile.target, 'hostname')
  } else {
    args.push(profile.target)
  }
  return args
}

function parseSshConfig(output: string): Map<string, string[]> {
  const values = new Map<string, string[]>()
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf(' ')
    if (separator <= 0) continue
    const key = line.slice(0, separator).toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (value.length === 0) continue
    const existing = values.get(key)
    if (existing) existing.push(value)
    else values.set(key, [value])
  }
  return values
}

function first(values: Map<string, string[]>, key: string): string | undefined {
  return values.get(key)?.[0]
}

function isNone(value: string | undefined): boolean {
  return value === undefined || value === '' || value.toLowerCase() === 'none'
}

function splitPaths(value: string | undefined): readonly string[] {
  if (isNone(value)) return []
  return (value ?? '').split(/\s+/).filter((item) => item.length > 0)
}

function inspectChecks(
  profile: ConnectionProfile,
  resolved: ConnectionResolved,
  values: Map<string, string[]>,
  frpProbe: TcpProbeResult | undefined,
): ConnectionCheck[] {
  const checks: ConnectionCheck[] = [
    { code: 'effective-config', state: 'ok', message: 'OpenSSH 已解析有效配置。' },
    { code: 'target', state: 'ok', message: `目标解析为 ${resolved.hostname}:${resolved.port}，用户 ${resolved.user}。` },
  ]
  if (profile.sshConfigFile !== undefined && !existsSync(expandHome(profile.sshConfigFile))) {
    checks.push({ code: 'config-file', state: 'error', message: '指定的 SSH 配置文件不存在。' })
  }
  if (profile.identityFile !== undefined) {
    checks.push(existsSync(expandHome(profile.identityFile))
      ? { code: 'identity-file', state: 'ok', message: '指定的身份文件存在；未读取其内容。' }
      : { code: 'identity-file', state: 'error', message: '指定的身份文件不存在。' })
  } else {
    checks.push({
      code: 'identity-file',
      state: 'ok',
      message: `使用 OpenSSH 默认身份候选（${resolved.identityFileCount} 个）；未输出路径。`,
    })
  }
  if (profile.knownHostsFile !== undefined) {
    checks.push(existsSync(expandHome(profile.knownHostsFile))
      ? { code: 'known-hosts', state: 'ok', message: '指定的 known_hosts 文件存在；未读取其内容。' }
      : { code: 'known-hosts', state: 'error', message: '指定的 known_hosts 文件不存在。' })
  } else {
    const knownHosts = splitPaths(first(values, 'userknownhostsfile'))
    const existing = knownHosts.some((path) => existsSync(expandHome(path)))
    checks.push(existing
      ? { code: 'known-hosts', state: 'ok', message: '使用 OpenSSH 默认 known_hosts；未输出路径。' }
      : { code: 'known-hosts', state: 'warning', message: '默认 known_hosts 不存在；首次连接会因主机密钥未知而失败。' })
  }
  const effectiveProxyJump = first(values, 'proxyjump')
  const effectiveProxyCommand = first(values, 'proxycommand')
  if (profile.transport === 'proxy-jump' && isNone(effectiveProxyJump) && isNone(effectiveProxyCommand)) {
    checks.push({ code: 'proxy-jump', state: 'error', message: 'Profile 声明 proxy-jump，但 OpenSSH 未解析出跳板。' })
  } else if (profile.transport !== 'proxy-jump' && (!isNone(effectiveProxyJump) || !isNone(effectiveProxyCommand))) {
    checks.push({
      code: 'proxy-jump',
      state: 'warning',
      message: 'OpenSSH 配置还包含 ProxyJump/ProxyCommand；实际路径会经过额外通路。',
    })
  } else {
    checks.push({ code: 'proxy-jump', state: 'ok', message: '连接路径与 Profile transport 一致。' })
  }
  if (profile.transport === 'frp') {
    if (frpProbe === 'listening') {
      checks.push({ code: 'frp-visitor', state: 'ok', message: '本地 visitor 端口正在监听。' })
    } else {
      checks.push({
        code: 'frp-visitor',
        state: 'error',
        message: frpProbe === 'refused'
          ? '本地 visitor 端口拒绝连接；FRPP visitor 可能未启动。'
          : '本地 visitor 端口不可达；只验证了本地入口，不代表远端隧道状态。',
      })
    }
  }
  return checks
}

function inspectionState(checks: readonly ConnectionCheck[]): ConnectionInspection['state'] {
  if (checks.some((check) => check.state === 'error')) return 'error'
  if (checks.some((check) => check.state === 'warning')) return 'warning'
  return 'ready'
}

function configFailure(result: ConnectivityCommandResult): string {
  const error = result.error
  if (error?.code === 'ENOENT') return '当前环境未找到 OpenSSH。'
  if (error?.killed || error?.signal === 'SIGTERM') return 'OpenSSH 配置解析超过 10 秒时限。'
  return `OpenSSH 配置解析失败 (${String(error?.code ?? error?.signal ?? 'UNKNOWN')})。`
}

function attemptFailure(result: ConnectivityCommandResult): ConnectionAttempt['state'] {
  const error = result.error
  if (error?.code === 'ENOENT') return 'unavailable'
  if (error?.killed || error?.signal === 'SIGTERM') return 'unreachable'
  const detail = result.stderr.toLowerCase()
  if (/bad configuration option|no such identity|could not resolve hostname|invalid configuration|no matching host key/.test(detail)) {
    return 'config-error'
  }
  if (/host key verification failed|remote host identification has changed/.test(detail)) {
    return 'host-key'
  }
  if (/permission denied|authentication failed|no supported authentication methods/.test(detail)) {
    return 'denied'
  }
  if (/connection refused|connection closed|connection reset/.test(detail)) {
    return 'target-unavailable'
  }
  if (/connection timed out|operation timed out|network is unreachable|no route to host|connection failed/.test(detail)) {
    return 'unreachable'
  }
  return 'error'
}

function attemptMessage(state: ConnectionAttempt['state']): string {
  switch (state) {
    case 'config-error': return 'SSH 配置或目标不可解析；未尝试绕过配置。'
    case 'denied': return 'SSH 认证被拒绝；未读取或保存任何凭据。'
    case 'host-key': return 'SSH 主机密钥校验失败；未自动信任未知或变化的主机。'
    case 'target-unavailable': return 'SSH 目标当前拒绝连接；这不证明机器永久离线。'
    case 'unreachable': return 'SSH 通路当前不可达；这不证明机器不存在。'
    case 'unavailable': return '当前环境未找到 OpenSSH。'
    default: return 'SSH 连接尝试失败 (UNKNOWN)。'
  }
}

function observedHostname(stdout: string): string | undefined {
  const line = stdout.trim().split(/\r?\n/, 1)[0] ?? ''
  const hostname = line.replace(/[\p{Cc}]/gu, '').trim().slice(0, 255)
  return hostname.length === 0 ? undefined : hostname
}

function attemptSource(profile: ConnectionProfile): ConnectionAttempt['source'] {
  return {
    kind: 'ssh',
    transport: profile.transport,
    target: profile.target,
    ...(profile.port === undefined ? {} : { port: profile.port }),
    ...(profile.user === undefined ? {} : { user: profile.user }),
    ...(profile.proxyJump === undefined ? {} : { proxyJump: profile.proxyJump }),
  }
}

/** 创建连接配置、检查、验证和原生命令入口；不启动 SSH/FRP 运行时。 */
export function createConnectivityService(
  locus: LocusService,
  remoteMachine: RemoteMachineService,
  options: ConnectivityServiceOptions = {},
): ConnectivityService & { dispose(): Promise<void> } {
  const store = new ConnectivityStore(locus.dataDirectory)
  const execute = options.run ?? executeSsh
  const probe = options.probeTcp ?? probeTcp
  const pending = new Set<Promise<unknown>>()
  let disposed = false
  let disposal: Promise<void> | undefined

  function assertActive(): void {
    if (disposed) throw new Error('Connectivity 服务已释放')
  }

  function requireMachine(machineId: string): void {
    remoteMachine.get(machineId)
  }

  function requireProfile(profileId: string): ConnectionProfile {
    assertActive()
    return store.get(profileId)
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

  function inspect(profileId: string, signal?: AbortSignal): Promise<ConnectionInspection> {
    return withPending(async () => {
      const profile = requireProfile(profileId)
      requireMachine(profile.machineId)
      const result = await execute(commandArguments(profile, 'inspect'), signal)
      const observedAt = new Date().toISOString()
      if (result.error) {
        return {
          profileId: profile.id,
          machineId: profile.machineId,
          transport: profile.transport,
          target: profile.target,
          state: result.error.code === 'ENOENT' ? 'unavailable' as const : 'error' as const,
          observedAt,
          checks: [{ code: 'ssh', state: 'error', message: configFailure(result) }],
          error: configFailure(result),
        }
      }
      const values = parseSshConfig(result.stdout)
      const hostname = first(values, 'hostname') ?? profile.target
      const parsedPort = Number(first(values, 'port') ?? profile.port ?? 22)
      const port = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
        ? parsedPort
        : profile.port ?? 22
      const user = first(values, 'user') ?? profile.user ?? 'unknown'
      const proxyJumpValue = first(values, 'proxyjump')
      const resolvedProxyJump = proxyJumpValue === undefined || isNone(proxyJumpValue)
        ? undefined
        : proxyJumpValue
      const resolved: ConnectionResolved = {
        hostname,
        port,
        user,
        ...(resolvedProxyJump === undefined ? {} : { proxyJump: resolvedProxyJump }),
        identityFileCount: values.get('identityfile')?.length ?? 0,
        knownHostsFileCount: splitPaths(first(values, 'userknownhostsfile')).length,
        strictHostKeyChecking: first(values, 'stricthostkeychecking') ?? 'unknown',
      }
      const frpProbe = profile.transport === 'frp' && profile.port !== undefined
        ? await probe(profile.target, profile.port)
        : undefined
      const checks = inspectChecks(profile, resolved, values, frpProbe)
      const state = inspectionState(checks)
      const error = checks.find((check) => check.state === 'error')?.message
      return {
        profileId: profile.id,
        machineId: profile.machineId,
        transport: profile.transport,
        target: profile.target,
        state,
        observedAt,
        checks,
        resolved,
        ...(error === undefined ? {} : { error }),
      }
    })
  }

  return {
    capability,
    availability() {
      return withPending(async () => {
        const result = await execute(['-V'])
        return result.error
          ? {
            available: false,
            error: '当前环境未找到可用的 OpenSSH；Profile 配置仍可保存，检查与验证不可用。',
          }
          : { available: true }
      })
    },
    list(machineId) {
      assertActive()
      if (machineId !== undefined) requireMachine(machineId)
      return store.list(machineId)
    },
    get(profileId) {
      return requireProfile(profileId)
    },
    add(machineId, profile) {
      assertActive()
      requireMachine(machineId)
      return store.add(machineId, profile)
    },
    update(profileId, changes) {
      assertActive()
      return store.update(profileId, changes)
    },
    remove(profileId) {
      assertActive()
      store.remove(profileId)
    },
    inspect(profileId, signal) {
      return inspect(profileId, signal)
    },
    verify(profileId, signal) {
      return withPending(async () => {
        const profile = requireProfile(profileId)
        requireMachine(profile.machineId)
        const startedAt = new Date().toISOString()
        const started = Date.now()
        const result = await execute(commandArguments(profile, 'verify'), signal)
        const finishedAt = new Date().toISOString()
        const durationMs = Date.now() - started
        if (result.error) {
          const state = attemptFailure(result)
          return {
            profileId: profile.id,
            machineId: profile.machineId,
            transport: profile.transport,
            state,
            source: attemptSource(profile),
            startedAt,
            finishedAt,
            durationMs,
            error: attemptMessage(state),
          }
        }
        const hostname = observedHostname(result.stdout)
        if (hostname === undefined) {
          return {
            profileId: profile.id,
            machineId: profile.machineId,
            transport: profile.transport,
            state: 'error' as const,
            source: attemptSource(profile),
            startedAt,
            finishedAt,
            durationMs,
            error: 'SSH 命令成功，但没有返回可用的主机名。',
          }
        }
        return {
          profileId: profile.id,
          machineId: profile.machineId,
          transport: profile.transport,
          state: 'connected' as const,
          source: attemptSource(profile),
          startedAt,
          finishedAt,
          durationMs,
          host: { hostname },
        }
      })
    },
    open(profileId): ConnectionOpen {
      const profile = requireProfile(profileId)
      requireMachine(profile.machineId)
      return {
        mode: 'native',
        command: ['ssh', ...commandArguments(profile, 'open')],
        note: '当前 DSH CLI 没有可移交的 Agent/Web 终端；执行该原生命令进入 SSH。Locus 不保存终端状态。',
      }
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

/** 将连接配置用例提供给当前 fiber；卸载不删除 Profile 或 Remote Machine。 */
export function apply(ctx: Context): void {
  const service = createConnectivityService(
    ctx.get('locus') as LocusService,
    ctx.get('locusRemoteMachine') as RemoteMachineService,
  )
  ctx.provide('locusConnectivity', service)
  ctx.effect(() => () => service.dispose())
}
