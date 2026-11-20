import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { normalizeTargetFromSpec, parseAddSpecText, targetBinding } from './config.ts'
import { withCredentialFile } from './credentials.ts'
import { i18n } from './i18n.ts'
import { buildSshInvocation, createProcessRunner, resolveUnderRoot } from './ssh.ts'
import { createProbeStore } from './probe-store.ts'
import { createTargetStore } from './target-store.ts'
import { RemoteTargetsFailure } from './types.ts'
import type {
  AddOptions,
  AuthMethod,
  CommandRunner,
  ComponentGate,
  ExecResult,
  ProbeResult,
  RemoteCredentialMaterial,
  RemoteCredentialSlot,
  RemoteService,
  RemoteTarget,
  RemoteTargetMigrationSource,
  RemoteTargetsService,
} from './types.ts'

/** 目标定义写 YAML，探测结果写 SQLite；传输一律经系统 SSH/Plink。 */
export function createRemoteTargetsService(options: {
  readonly root: string
  readonly runner?: CommandRunner
  readonly components?: ComponentGate
}): RemoteTargetsService {
  if (!options.root.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(options.root)) {
    throw new RemoteTargetsFailure('invalid-spec', i18n.t('service.root-absolute'))
  }
  const root = options.root
  const store = createTargetStore(root)
  const state = createProbeStore(root)
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
        i18n.t('service.component-missing', { target: target.id, component: componentId }),
      )
    }
    if (availability.state !== 'healthy') {
      throw new RemoteTargetsFailure(
        'component-unavailable',
        i18n.t('service.component-state', {
          target: target.id,
          component: componentId,
          state: availability.state ?? i18n.t('state.not-probed'),
        }),
      )
    }
  }

  function requireCapability(target: RemoteTarget, capability: 'exec' | 'shell'): void {
    if (!target.access.capabilities.includes(capability)) {
      throw new RemoteTargetsFailure(
        'capability-unsupported',
        i18n.t('service.capability-denied', { target: target.id, capability }),
      )
    }
  }

  function requireCmd(target: RemoteTarget, operation: string): void {
    if (target.connectivity.remoteShell !== 'cmd') {
      throw new RemoteTargetsFailure(
        'capability-unsupported',
        i18n.t('service.cmd-only', {
          target: target.id,
          shell: target.connectivity.remoteShell,
          operation,
        }),
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
      throw new RemoteTargetsFailure('migration-required', i18n.t('service.legacy-auth', { target: target.id }))
    }
    const slot = credentialSlot(auth.method)
    if (material.slot !== slot) {
      throw new RemoteTargetsFailure('invalid-spec', i18n.t('service.slot-mismatch', { slot }))
    }
    if (material.values.targetBinding !== targetBinding(target)) {
      throw new RemoteTargetsFailure('target-config-mismatch', i18n.t('service.config-changed', { target: target.id }))
    }
    const secret = slot === 'ssh-password' ? material.values.password : material.values.privateKey
    if (secret === undefined)
      throw new RemoteTargetsFailure(
        'credential-missing',
        i18n.t('service.credential-field-missing', { target: target.id, slot }),
      )
    if (slot === 'ssh-private-key' && material.values.passphrase !== undefined) {
      throw new RemoteTargetsFailure('encrypted-key-unsupported', i18n.t('service.encrypted-key'))
    }
    return withCredentialFile(secret, consume)
  }

  function addTarget(id: string, spec: unknown, addOptions?: AddOptions): RemoteTarget {
    const target = normalizeTargetFromSpec(spec, id)
    if (target.identity.auth.method !== 'private-key' && target.identity.auth.method !== 'password') {
      throw new RemoteTargetsFailure('migration-required', i18n.t('service.new-auth-method'))
    }
    const targets = store.load()
    if (targets.some(item => item.id === target.id)) {
      throw new RemoteTargetsFailure('target-exists', i18n.t('service.exists', { target: target.id }))
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
      state.remove(target.id)
      store.save(targets.filter(item => item.id !== target.id))
    },
    credentialMigration(reference): RemoteTargetMigrationSource {
      const target = resolveTarget(store.load(), reference)
      const auth = target.identity.auth
      if (auth.method !== 'key' && (auth.path === undefined || auth.method !== 'password')) {
        throw new RemoteTargetsFailure('already-migrated', i18n.t('service.already-bound', { target: target.id }))
      }
      if (auth.path === undefined) {
        throw new RemoteTargetsFailure('invalid-spec', i18n.t('service.legacy-file-missing', { target: target.id }))
      }
      return {
        method: auth.method === 'key' ? 'key' : 'password',
        path: resolveUnderRoot(auth.root ?? root, auth.path),
      }
    },
    useCredential(reference) {
      const targets = store.load()
      const target = resolveTarget(targets, reference)
      const auth = target.identity.auth
      if (auth.method !== 'key' && auth.path === undefined) {
        throw new RemoteTargetsFailure('already-migrated', i18n.t('service.already-bound', { target: target.id }))
      }
      if (auth.method !== 'key' && auth.method !== 'password') {
        throw new RemoteTargetsFailure(
          'invalid-spec',
          i18n.t('service.legacy-auth-unmigratable', { target: target.id }),
        )
      }
      const method: 'private-key' | 'password' = auth.method === 'key' ? 'private-key' : 'password'
      const migrated: RemoteTarget = {
        ...target,
        identity: { ...target.identity, auth: { method } },
      }
      store.save(targets.map(item => (item.id === target.id ? migrated : item)))
      return migrated
    },
    async probe(reference, material): Promise<ProbeResult> {
      const target = resolveTarget(store.load(), reference)
      requireTransport(target)
      const probe = await withPotential(target, material, async credentialPath => {
        const invocation = buildSshInvocation(target, root, ['whoami'], credentialPath)
        const result = await runner.run(invocation.command, invocation.args, { timeoutMs: 15_000 })
        const detail =
          (result.exitCode === 0 ? result.stdout : result.stderr).trim() ||
          i18n.t('service.exit-code', { code: result.exitCode })
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
        throw new RemoteTargetsFailure('invalid-spec', i18n.t('service.exec-empty'))
      }
      return withPotential(target, material, async credentialPath => {
        const invocation = buildSshInvocation(target, root, command, credentialPath)
        const result = await runner.run(invocation.command, invocation.args)
        return { targetId: target.id, ...result }
      })
    },
    async shell(reference, material): Promise<number> {
      const target = resolveTarget(store.load(), reference)
      requireCapability(target, 'shell')
      requireTransport(target)
      return withPotential(target, material, async credentialPath => {
        const invocation = buildSshInvocation(target, root, [], credentialPath)
        return runner.interactive(invocation.command, invocation.args)
      })
    },
    async system(reference, material): Promise<ProbeResult> {
      const target = resolveTarget(store.load(), reference)
      requireTransport(target)
      const probe = await withPotential(target, material, async credentialPath => {
        const invocation = buildSshInvocation(target, root, ['hostname'], credentialPath)
        const result = await runner.run(invocation.command, invocation.args, { timeoutMs: 15_000 })
        const detail =
          (result.exitCode === 0 ? result.stdout : result.stderr).trim() ||
          i18n.t('service.exit-code', { code: result.exitCode })
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
      return withPotential(target, material, async credentialPath => {
        const invocation = buildSshInvocation(
          target,
          root,
          powershellCommand('Get-Service | Select-Object Name,Status | ConvertTo-Json -Compress'),
          credentialPath,
        )
        const result = await runner.run(invocation.command, invocation.args, { timeoutMs: 30_000 })
        if (result.exitCode !== 0) {
          throw new RemoteTargetsFailure(
            'io',
            result.stderr.trim() || i18n.t('service.exit-code', { code: result.exitCode }),
          )
        }
        return parseServiceOutput(result.stdout)
      })
    },
    async restartService(reference, name, material): Promise<RemoteService> {
      if (!/^[A-Za-z0-9_. -]{1,128}$/.test(name)) {
        throw new RemoteTargetsFailure('invalid-spec', i18n.t('service.service-name-invalid', { name }))
      }
      const target = resolveTarget(store.load(), reference)
      requireTransport(target)
      requireCmd(target, 'restart')
      return withPotential(target, material, async credentialPath => {
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
          throw new RemoteTargetsFailure(
            'io',
            result.stderr.trim() || i18n.t('service.exit-code', { code: result.exitCode }),
          )
        }
        const [service] = parseServiceOutput(result.stdout)
        if (service === undefined) throw new RemoteTargetsFailure('io', i18n.t('service.service-state-unparsable'))
        return service
      })
    },
    dispose() {
      state.dispose()
    },
  }
}

function resolveTarget(targets: readonly RemoteTarget[], reference: string): RemoteTarget {
  const exact = targets.find(target => target.id === reference)
  if (exact !== undefined) return exact

  const prefixed = targets.filter(target => target.id.startsWith(reference))
  const [prefixMatch] = prefixed
  if (prefixed.length === 1 && prefixMatch !== undefined) return prefixMatch
  if (prefixed.length > 1) {
    throw new RemoteTargetsFailure(
      'ambiguous-target',
      i18n.t('service.prefix-ambiguous', {
        reference,
        candidates: prefixed.map(target => target.id).join(', '),
      }),
    )
  }

  const labelled = targets.filter(target => target.resource.label === reference)
  const [labelMatch] = labelled
  if (labelled.length === 1 && labelMatch !== undefined) return labelMatch
  if (labelled.length > 1) {
    throw new RemoteTargetsFailure(
      'ambiguous-target',
      i18n.t('service.label-ambiguous', {
        reference,
        candidates: labelled.map(target => target.id).join(', '),
      }),
    )
  }

  throw new RemoteTargetsFailure('target-not-found', i18n.t('service.not-found', { reference }))
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
    throw new RemoteTargetsFailure('io', i18n.t('service.services-unparsable'))
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
