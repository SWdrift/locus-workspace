import { existsSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { normalizeTargetFromSpec, parseAddSpecText } from './config.ts'
import { buildSshInvocation, createProcessRunner, resolveUnderRoot } from './ssh.ts'
import { createStateStore } from './state.ts'
import { createTargetStore } from './store.ts'
import {
  RemoteTargetsFailure,
  type AddOptions,
  type CommandRunner,
  type ComponentGate,
  type ExecResult,
  type ProbeResult,
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

/** 目标定义写 YAML，探测结果写 SQLite；传输一律经系统 SSH/Plink。 */
export function createRemoteTargetsService(options: {
  readonly root: string
  readonly runner?: CommandRunner
  readonly components?: ComponentGate
}): RemoteTargetsService {
  if (!isAbsolute(options.root)) {
    throw new RemoteTargetsFailure('invalid-spec', 'remote-targets 根目录必须是绝对路径')
  }
  const root = options.root
  const store = createTargetStore(root)
  const state = createStateStore(root)
  const runner = options.runner ?? createProcessRunner()
  const gate = options.components
  const TRANSPORT_COMPONENT: Record<'key' | 'password', string> = {
    key: 'openssh',
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
        `目标 ${target.id} 需要组件 ${componentId}，但它未登记；` +
          `先运行 locus component add examples/components/${componentId}.yaml`,
      )
    }
    if (availability.state !== 'healthy') {
      throw new RemoteTargetsFailure(
        'component-unavailable',
        `目标 ${target.id} 需要组件 ${componentId}，当前状态：${availability.state ?? '未探查'}；` +
          `运行 locus component probe ${componentId} 或 locus component show ${componentId}`,
      )
    }
  }

  function requireCredential(target: RemoteTarget): void {
    const path = resolveUnderRoot(
      target.identity.auth.root ?? root,
      target.identity.auth.path,
    )
    if (!existsSync(path)) {
      throw new RemoteTargetsFailure(
        'credential-missing',
        `缺少凭据文件：${target.identity.auth.path}`,
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

  function addTarget(id: string, spec: unknown, addOptions?: AddOptions): RemoteTarget {
    const target = normalizeTargetFromSpec(spec, id)
    const targets = store.load()
    if (targets.some((item) => item.id === target.id)) {
      throw new RemoteTargetsFailure('target-exists', `目标已存在：${target.id}`)
    }
    if (addOptions?.dryRun !== true) {
      // 只创建默认凭据目录；外部 auth.root 不在此处写入，避免修改已有目录。
      if (target.identity.auth.root === undefined) {
        mkdirSync(dirname(resolveUnderRoot(root, target.identity.auth.path)), {
          recursive: true,
          mode: 0o700,
        })
      }
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
    async probe(reference): Promise<ProbeResult> {
      const target = resolveTarget(store.load(), reference)
      requireTransport(target)
      requireCredential(target)
      const invocation = buildSshInvocation(target, root, ['whoami'])
      const result = await runner.run(invocation.command, invocation.args, { timeoutMs: 15_000 })
      const detail = (result.exitCode === 0 ? result.stdout : result.stderr).trim()
        || `退出码 ${result.exitCode}`
      const probe: ProbeResult = {
        targetId: target.id,
        ok: result.exitCode === 0,
        detail: detail.slice(0, 500),
        checkedAt: new Date().toISOString(),
      }
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
      requireCredential(target)
      const invocation = buildSshInvocation(target, root, command)
      const result = await runner.run(invocation.command, invocation.args)
      return { targetId: target.id, ...result }
    },
    async shell(reference): Promise<number> {
      const target = resolveTarget(store.load(), reference)
      requireCapability(target, 'shell')
      requireTransport(target)
      requireCredential(target)
      const invocation = buildSshInvocation(target, root, [])
      return runner.interactive(invocation.command, invocation.args)
    },
    dispose() {
      state.dispose()
    },
  }
}
