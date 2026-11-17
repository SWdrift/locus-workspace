import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { normalizeTargetFromSpec, parseAddSpecText, targetBinding } from './config.ts'
import { withCredentialFile } from './credentials.ts'
import { buildSshInvocation, createProcessRunner, resolveUnderRoot } from './ssh.ts'
import { createStateStore } from './state.ts'
import { createTargetStore } from './store.ts'
import {
  RemoteTargetsFailure,
  type AddOptions,
  type AuthMethod,
  type CommandRunner,
  type ComponentGate,
  type CredentialMigration,
  type ExecResult,
  type ProbeResult,
  type RemoteCredentialMaterial,
  type RemoteCredentialSlot,
  type RemoteService,
  type RemoteTarget,
  type RemoteTargetsService,
} from './types.ts'

function resolveTarget(targets: readonly RemoteTarget[], reference: string): RemoteTarget {
  const exact = targets.find((target) => target.id === reference)
  if (exact !== undefined) return exact

  const prefixed = targets.filter((target) => target.id.startsWith(reference))
  const [prefixMatch] = prefixed
  if (prefixed.length === 1 && prefixMatch !== undefined) return prefixMatch
  if (prefixed.length > 1) {
    throw new RemoteTargetsFailure(
      'ambiguous-target',
      `目标前缀不唯一：${reference}；候选：${prefixed.map((target) => target.id).join(', ')}`,
    )
  }

  const labelled = targets.filter((target) => target.resource.label === reference)
  const [labelMatch] = labelled
  if (labelled.length === 1 && labelMatch !== undefined) return labelMatch
  if (labelled.length > 1) {
    throw new RemoteTargetsFailure(
      'ambiguous-target',
      `目标标签不唯一：${reference}；候选：${labelled.map((target) => target.id).join(', ')}`,
    )
  }

  throw new RemoteTargetsFailure('target-not-found', `找不到目标：${reference}`)
}

function credentialSlot(method: AuthMethod): RemoteCredentialSlot {
  return method === 'password' ? 'ssh-password' : 'ssh-private-key'
}

function powershellCommand(script: string): readonly string[] {
  return [
    'powershell.exe',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ]
}

function parseServiceOutput(stdout: string): readonly RemoteService[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new RemoteTargetsFailure('io', '无法解析远端服务列表')
  }
  const values = Array.isArray(parsed) ? parsed : [parsed]
  const services: RemoteService[] = []
  for (const value of values) {
    if (value === null || typeof value !== 'object') continue
    const item = value as Record<string, unknown>
    if (typeof item.Name === 'string' && typeof item.Status === 'string') {
      services.push({ name: item.Name, status: item.Status })
    }
  }
  return Object.freeze(services.sort((left, right) => left.name.localeCompare(right.name)))
}

/** 目标定义写 YAML，探测结果写 SQLite；传输一律经系统 SSH/Plink。 */
export function createRemoteTargetsService(options: {
  readonly root: string
  readonly runner?: CommandRunner
  readonly components?: ComponentGate
}): RemoteTargetsService {
  if (!options.root.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(options.root)) {
    throw new RemoteTargetsFailure('invalid-spec', 'remote-targets 根目录必须是绝对路径')
  }
  const root = options.root
  const store = createTargetStore(root)
  const state = createStateStore(root)
  const runner = options.runner ?? createProcessRunner()
  const gate = options.components
  const TRANSPORT_COMPONENT: Record<AuthMethod, string> = {
    key: 'openssh',
    'private-key': 'openssh',
    password: 'plink',
  }

  /** 传输前置：组件未登记或状态非 healthy 时明确失败，不静默改用其他客户端。 */
  function requireTransport(target: RemoteTarget): void {
    if (gate === undefined) return
    const componentId = TRANSPORT_COMPONENT[target.identity.auth.method]
    const availability = gate.get(componentId)
    if (availability === undefined) {
      throw new RemoteTargetsFailure(
        'component-unavailable',
        `目标 ${target.id} 需要组件 ${componentId}，但它未登记`,
      )
    }
    if (availability.state !== 'healthy') {
      throw new RemoteTargetsFailure(
        'component-unavailable',
        `目标 ${target.id} 需要组件 ${componentId}，当前状态：${availability.state ?? '未探查'}`,
      )
    }
  }

  function requireCapability(target: RemoteTarget, capability: 'exec' | 'shell'): void {
    if (!target.access.capabilities.includes(capability)) {
      throw new RemoteTargetsFailure(
        'capability-unsupported',
        `目标 ${target.id} 未授权能力：${capability}`,
      )
    }
  }

  function requireCmd(target: RemoteTarget, operation: string): void {
    if (target.connectivity.remoteShell !== 'cmd') {
      throw new RemoteTargetsFailure(
        'capability-unsupported',
        `目标 ${target.id} 的 remoteShell 是 ${target.connectivity.remoteShell}；${operation} 仅支持 cmd`,
      )
    }
  }

  async function withPotential<T>(
    target: RemoteTarget,
    material: RemoteCredentialMaterial,
    consume: (credentialPath: string) => Promise<T>,
  ): Promise<T> {
    const auth = target.identity.auth
    if (auth.method === 'key' || auth.path !== undefined) {
      throw new RemoteTargetsFailure(
        'migration-required',
        `目标 ${target.id} 仍使用旧文件认证；需要显式迁移到 Core 凭据绑定`,
      )
    }
    const slot = credentialSlot(auth.method)
    if (material.slot !== slot) {
      throw new RemoteTargetsFailure('invalid-spec', `目标认证方式与凭据槽不匹配：需要 ${slot}`)
    }
    if (material.values.targetBinding !== targetBinding(target)) {
      throw new RemoteTargetsFailure(
        'target-config-mismatch',
        `目标 ${target.id} 配置已变化；需要 Root 重新登记或确认`,
      )
    }
    const secret = slot === 'ssh-password' ? material.values.password : material.values.privateKey
    if (secret === undefined) throw new RemoteTargetsFailure('credential-missing', `目标 ${target.id} 缺少 ${slot} 字段`)
    if (slot === 'ssh-private-key' && material.values.passphrase !== undefined) {
      throw new RemoteTargetsFailure('encrypted-key-unsupported', '私钥带口令；不会自动去除口令，需先确定口令交付方案')
    }
    return withCredentialFile(secret, consume)
  }

  function addTarget(id: string, spec: unknown, addOptions?: AddOptions): RemoteTarget {
    const target = normalizeTargetFromSpec(spec, id)
    if (target.identity.auth.method !== 'private-key' && target.identity.auth.method !== 'password') {
      throw new RemoteTargetsFailure(
        'migration-required',
        '新目标必须使用 method: private-key 或 password；旧 path/root 仅用于迁移读取',
      )
    }
    const targets = store.load()
    if (targets.some((item) => item.id === target.id)) {
      throw new RemoteTargetsFailure('target-exists', `目标已存在：${target.id}`)
    }
    if (addOptions?.dryRun !== true) {
      // known_hosts 默认位于目标目录；不创建或保存任何秘密文件。
      mkdirSync(dirname(resolveUnderRoot(root, `trust/${target.id}/known_hosts`)), {
        recursive: true,
        mode: 0o700,
      })
      store.save([...targets, target])
    }
    return target
  }

  return {
    list() {
      return store.load()
    },
    show(reference) {
      const target = resolveTarget(store.load(), reference)
      const lastProbe = state.last(target.id)
      return lastProbe === undefined ? target : { ...target, lastProbe }
    },
    add(id, spec, addOptions) {
      return addTarget(id, spec, addOptions)
    },
    addFromText(id, text, addOptions) {
      return addTarget(id, parseAddSpecText(text, id), addOptions)
    },
    remove(reference) {
      const targets = store.load()
      const target = resolveTarget(targets, reference)
      store.save(targets.filter((item) => item.id !== target.id))
    },
    credentialMigration(reference): CredentialMigration {
      const target = resolveTarget(store.load(), reference)
      const auth = target.identity.auth
      if (auth.method !== 'key' && (auth.path === undefined || auth.method !== 'password')) {
        throw new RemoteTargetsFailure('already-migrated', `目标 ${target.id} 已使用 Core 凭据绑定`)
      }
      if (auth.path === undefined) {
        throw new RemoteTargetsFailure('invalid-spec', `目标 ${target.id} 缺少可迁移的旧认证文件`)
      }
      return { method: auth.method === 'key' ? 'key' : 'password', path: resolveUnderRoot(auth.root ?? root, auth.path) }
    },
    useCredential(reference) {
      const targets = store.load()
      const target = resolveTarget(targets, reference)
      const auth = target.identity.auth
      if (auth.method !== 'key' && auth.path === undefined) {
        throw new RemoteTargetsFailure('already-migrated', `目标 ${target.id} 已使用 Core 凭据绑定`)
      }
      if (auth.method !== 'key' && auth.method !== 'password') {
        throw new RemoteTargetsFailure('invalid-spec', `目标 ${target.id} 的旧认证方式不可迁移`)
      }
      const method: 'private-key' | 'password' = auth.method === 'key' ? 'private-key' : 'password'
      const migrated: RemoteTarget = {
        ...target,
        identity: { ...target.identity, auth: { method } },
      }
      store.save(targets.map((item) => (item.id === target.id ? migrated : item)))
      return migrated
    },
    async probe(reference, material): Promise<ProbeResult> {
      const target = resolveTarget(store.load(), reference)
      requireTransport(target)
      const probe = await withPotential(target, material, async (credentialPath) => {
        const invocation = buildSshInvocation(target, root, ['whoami'], credentialPath)
        const result = await runner.run(invocation.command, invocation.args, { timeoutMs: 15_000 })
        const detail = (result.exitCode === 0 ? result.stdout : result.stderr).trim()
          || `退出码 ${result.exitCode}`
        return {
          targetId: target.id,
          ok: result.exitCode === 0,
          detail: detail.slice(0, 500),
          checkedAt: new Date().toISOString(),
        } satisfies ProbeResult
      })
      state.record(probe)
      return probe
    },
    async exec(reference, command, material): Promise<ExecResult> {
      const target = resolveTarget(store.load(), reference)
      requireCapability(target, 'exec')
      requireTransport(target)
      if (command.length === 0) {
        throw new RemoteTargetsFailure('invalid-spec', 'exec 需要至少一条远端命令')
      }
      return withPotential(target, material, async (credentialPath) => {
        const invocation = buildSshInvocation(target, root, command, credentialPath)
        const result = await runner.run(invocation.command, invocation.args)
        return { targetId: target.id, ...result }
      })
    },
    async shell(reference, material): Promise<number> {
      const target = resolveTarget(store.load(), reference)
      requireCapability(target, 'shell')
      requireTransport(target)
      return withPotential(target, material, async (credentialPath) => {
        const invocation = buildSshInvocation(target, root, [], credentialPath)
        return runner.interactive(invocation.command, invocation.args)
      })
    },
    async system(reference, material): Promise<ProbeResult> {
      const target = resolveTarget(store.load(), reference)
      requireTransport(target)
      const probe = await withPotential(target, material, async (credentialPath) => {
        const invocation = buildSshInvocation(
          target,
          root,
          ['hostname'],
          credentialPath,
        )
        const result = await runner.run(invocation.command, invocation.args, { timeoutMs: 15_000 })
        const detail = (result.exitCode === 0 ? result.stdout : result.stderr).trim()
          || `退出码 ${result.exitCode}`
        return {
          targetId: target.id,
          ok: result.exitCode === 0,
          detail: detail.slice(0, 500),
          checkedAt: new Date().toISOString(),
        } satisfies ProbeResult
      })
      state.record(probe)
      return probe
    },
    async services(reference, material): Promise<readonly RemoteService[]> {
      const target = resolveTarget(store.load(), reference)
      requireTransport(target)
      requireCmd(target, 'services')
      return withPotential(target, material, async (credentialPath) => {
        const invocation = buildSshInvocation(
          target,
          root,
          powershellCommand('Get-Service | Select-Object Name,Status | ConvertTo-Json -Compress'),
          credentialPath,
        )
        const result = await runner.run(invocation.command, invocation.args, { timeoutMs: 30_000 })
        if (result.exitCode !== 0) {
          throw new RemoteTargetsFailure('io', result.stderr.trim() || `退出码 ${result.exitCode}`)
        }
        return parseServiceOutput(result.stdout)
      })
    },
    async restartService(reference, name, material): Promise<RemoteService> {
      if (!/^[A-Za-z0-9_. -]{1,128}$/.test(name)) {
        throw new RemoteTargetsFailure('invalid-spec', `服务名不合法：${name}`)
      }
      const target = resolveTarget(store.load(), reference)
      requireTransport(target)
      requireCmd(target, 'restart')
      return withPotential(target, material, async (credentialPath) => {
        const escaped = name.replace(/'/g, "''")
        const invocation = buildSshInvocation(
          target,
          root,
          powershellCommand(
            `Restart-Service -Name '${escaped}' -ErrorAction Stop; ` +
            `Get-Service -Name '${escaped}' | Select-Object Name,Status | ConvertTo-Json -Compress`,
          ),
          credentialPath,
        )
        const result = await runner.run(invocation.command, invocation.args, { timeoutMs: 60_000 })
        if (result.exitCode !== 0) {
          throw new RemoteTargetsFailure('io', result.stderr.trim() || `退出码 ${result.exitCode}`)
        }
        const [service] = parseServiceOutput(result.stdout)
        if (service === undefined) throw new RemoteTargetsFailure('io', '无法解析服务状态')
        return service
      })
    },
    dispose() {
      state.dispose()
    },
  }
}
