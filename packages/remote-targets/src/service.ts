import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import type { CredentialRef } from '@locus/core'
import { normalizeTargetFromSpec, parseAddSpecText } from './config.ts'
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
  type RemoteTarget,
  type RemoteSecurity,
  type RemoteCredentialSlot,
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

/** 目标定义写 YAML，探测结果写 SQLite；传输一律经系统 SSH/Plink。 */
export function createRemoteTargetsService(options: {
  readonly root: string
  readonly runner?: CommandRunner
  readonly components?: ComponentGate
  readonly security?: RemoteSecurity
}): RemoteTargetsService {
  if (!isAbsolute(options.root)) {
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

  async function withCredential<T>(
    target: RemoteTarget,
    operation: 'probe' | 'exec' | 'shell',
    command: readonly string[],
    consume: (credentialPath: string) => Promise<T>,
  ): Promise<T> {
    if (options.security === undefined) throw new RemoteTargetsFailure('access-denied', '远程执行需要组合根注入 Core 授权与凭据交付')
    const auth = target.identity.auth
    if (auth.credential === undefined) {
      throw new RemoteTargetsFailure('migration-required', `目标 ${target.id} 仍使用旧文件认证；需要显式迁移到 CredentialRef`)
    }
    const slot = credentialSlot(auth.method)
    return options.security.withCredential(target.id, slot, auth.credential, { operation, command }, async (values) => {
      const secret = slot === 'ssh-password' ? values.password : values.privateKey
      if (secret === undefined) throw new RemoteTargetsFailure('invalid-spec', `目标 ${target.id} 缺少 ${slot} 字段`)
      if (slot === 'ssh-private-key' && values.passphrase !== undefined) {
        throw new RemoteTargetsFailure('encrypted-key-unsupported', '私钥带口令；不会自动去除口令，需先确定口令交付方案')
      }
      return withCredentialFile(secret, (path) => consume(path))
    })
  }

  function addTarget(id: string, spec: unknown, addOptions?: AddOptions): RemoteTarget {
    const target = normalizeTargetFromSpec(spec, id)
    if (target.identity.auth.credential === undefined) {
      throw new RemoteTargetsFailure('migration-required', '新目标必须使用 identity.auth.credential；旧 path/root 仅用于迁移读取')
    }
    const targets = store.load()
    if (targets.some((item) => item.id === target.id)) {
      throw new RemoteTargetsFailure('target-exists', `目标已存在：${target.id}`)
    }
    if (addOptions?.dryRun !== true) {
      // known_hosts 默认位于目标目录；不创建或保存任何秘密文件。
      mkdirSync(dirname(resolveUnderRoot(root, `credentials/${target.id}/known_hosts`)), {
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
      if (auth.credential !== undefined) throw new RemoteTargetsFailure('already-migrated', `目标 ${target.id} 已使用 CredentialRef`)
      if (auth.path === undefined || (auth.method !== 'key' && auth.method !== 'password')) {
        throw new RemoteTargetsFailure('invalid-spec', `目标 ${target.id} 缺少可迁移的旧认证文件`)
      }
      return { method: auth.method, path: resolveUnderRoot(auth.root ?? root, auth.path) }
    },
    useCredential(reference, credential): RemoteTarget {
      if (!/^credential:[a-z][a-z0-9-]*$/.test(credential)) throw new RemoteTargetsFailure('invalid-spec', '必须使用 credential:<id> 引用')
      const targets = store.load()
      const target = resolveTarget(targets, reference)
      const auth = target.identity.auth
      if (auth.credential !== undefined) throw new RemoteTargetsFailure('already-migrated', `目标 ${target.id} 已使用 CredentialRef`)
      if (auth.method !== 'key' && auth.method !== 'password') {
        throw new RemoteTargetsFailure('invalid-spec', `目标 ${target.id} 的旧认证方式不可迁移`)
      }
      const method = auth.method === 'key' ? 'private-key' : 'password'
      const migrated: RemoteTarget = {
        ...target,
        identity: { ...target.identity, auth: { method, credential: credential as CredentialRef } },
      }
      store.save(targets.map((item) => (item.id === target.id ? migrated : item)))
      return migrated
    },
    async probe(reference): Promise<ProbeResult> {
      const target = resolveTarget(store.load(), reference)
      requireTransport(target)
      const probe = await withCredential(target, 'probe', ['whoami'], async (credentialPath) => {
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
    async exec(reference, command): Promise<ExecResult> {
      const target = resolveTarget(store.load(), reference)
      requireCapability(target, 'exec')
      requireTransport(target)
      if (command.length === 0) {
        throw new RemoteTargetsFailure('invalid-spec', 'exec 需要至少一条远端命令')
      }
      return withCredential(target, 'exec', command, async (credentialPath) => {
        const invocation = buildSshInvocation(target, root, command, credentialPath)
        const result = await runner.run(invocation.command, invocation.args)
        return { targetId: target.id, ...result }
      })
    },
    async shell(reference): Promise<number> {
      const target = resolveTarget(store.load(), reference)
      requireCapability(target, 'shell')
      requireTransport(target)
      return withCredential(target, 'shell', [], async (credentialPath) => {
        const invocation = buildSshInvocation(target, root, [], credentialPath)
        return runner.interactive(invocation.command, invocation.args)
      })
    },
    dispose() {
      state.dispose()
    },
  }
}
