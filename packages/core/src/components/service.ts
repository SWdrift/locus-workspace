import { randomUUID } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { connect } from 'node:net'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { stringify } from 'yaml'
import { i18n } from '../i18n/core.ts'
import { ComponentFailure } from './errors.ts'
import { parseComponent } from './parse.ts'
import { createComponentRunner } from './runner.ts'
import { createComponentStateStore } from './sqlite-store.ts'
import type {
  ComponentCommandResult,
  ComponentConfig,
  ComponentDeployView,
  ComponentExternalView,
  ComponentProbe,
  ComponentProblem,
  ComponentRunner,
  ComponentServiceOptions,
  ComponentsService,
  ComponentSpec,
  ComponentView,
  DeployState,
  ExternalState,
  HttpProbe,
  TcpProbe,
} from './types.ts'

interface RegistryEntry {
  readonly id: string
  readonly source: 'package' | 'dynamic'
  readonly path: string
  readonly spec?: ComponentSpec
  readonly codeVersion?: string
  readonly needsUpgrade: boolean
  readonly error?: string
}

interface DescriptorLocation {
  readonly path: string
  readonly form: 'file' | 'folder'
}

const DESCRIPTOR_FILE = 'component.yaml'
const PROBE_TIMEOUT_MS = 15_000
const DEPLOY_TIMEOUT_MS = 300_000
const DETAIL_LIMIT = 500

/** 组件注册表、物化与生命周期；状态读写经独立的 SQLite Store。 */
export function createComponentService(options: ComponentServiceOptions): ComponentsService {
  const dataDirectory = resolve(options.dataDirectory)
  const componentsRoot = join(dataDirectory, 'components')
  const runner = options.runner ?? createComponentRunner()
  const stateStore = createComponentStateStore(dataDirectory)
  const packageIds = new Set<string>()
  const packageDefinitions: ComponentSpec[] = []
  for (const definition of options.definitions ?? []) {
    const spec = parseComponent(definition, { allowContract: true })
    requireRegistrableId(spec.id)
    if (spec.kind !== 'locus') {
      throw new ComponentFailure('invalid-spec', i18n.t('component.package-kind-mismatch', { id: spec.id }))
    }
    if (packageIds.has(spec.id)) {
      throw new ComponentFailure('invalid-spec', i18n.t('component.package-id-duplicate', { id: spec.id }))
    }
    packageIds.add(spec.id)
    packageDefinitions.push(spec)
  }
  let disposed = false

  function assertActive(): void {
    if (disposed) throw new Error(i18n.t('component.released'))
  }

  function locate(id: string): DescriptorLocation | { readonly conflict: string } | undefined {
    const file = join(componentsRoot, `${id}.yaml`)
    const folder = join(componentsRoot, id, DESCRIPTOR_FILE)
    const hasFile = existsSync(file)
    const hasFolder = existsSync(folder)
    if (hasFile && hasFolder) {
      return { conflict: i18n.t('component.location-conflict', { file, folder }) }
    }
    if (hasFile) return { path: file, form: 'file' }
    if (hasFolder) return { path: folder, form: 'folder' }
    return undefined
  }

  function writeDefinition(path: string, spec: ComponentSpec): void {
    try {
      mkdirSync(dirname(path), { recursive: true })
      const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
      writeFileSync(temporary, stringify(serialize(spec)), 'utf8')
      renameSync(temporary, path)
    } catch (error) {
      throw new ComponentFailure('io', i18n.t('component.write-definition-failed', { path, detail: messageOf(error) }))
    }
  }

  function readDefinition(path: string): ComponentSpec {
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    } catch (error) {
      throw new ComponentFailure('io', i18n.t('component.read-definition-failed', { path, detail: messageOf(error) }))
    }
    const spec = parseComponent(text)
    requireRegistrableId(spec.id)
    return spec
  }

  function materialize(): void {
    for (const spec of packageDefinitions) {
      const location = locate(spec.id)
      if (location !== undefined) continue
      writeDefinition(join(componentsRoot, `${spec.id}.yaml`), spec)
    }
  }

  function packageEntry(spec: ComponentSpec): RegistryEntry {
    const location = locate(spec.id)
    if (location === undefined) {
      return {
        id: spec.id,
        source: 'package',
        path: join(componentsRoot, `${spec.id}.yaml`),
        codeVersion: spec.version,
        needsUpgrade: false,
        error: i18n.t('component.definition-file-missing'),
      }
    }
    if ('conflict' in location) {
      return {
        id: spec.id,
        source: 'package',
        path: join(componentsRoot, `${spec.id}.yaml`),
        codeVersion: spec.version,
        needsUpgrade: false,
        error: location.conflict,
      }
    }
    try {
      const parsed = readDefinition(location.path)
      if (parsed.id !== spec.id) {
        throw new ComponentFailure(
          'invalid-definition',
          i18n.t('component.definition-id-mismatch', { actual: parsed.id, expected: spec.id }),
        )
      }
      // YAML 只保存描述性元数据；operation 与凭据字段来自包代码，不写回可编辑文件。
      const merged = parseComponent(
        {
          ...parsed,
          ...(spec.operations === undefined ? {} : { operations: spec.operations }),
          ...(spec.credentials === undefined ? {} : { credentials: spec.credentials }),
        },
        { allowContract: true },
      )
      return {
        id: spec.id,
        source: 'package',
        path: location.path,
        spec: merged,
        codeVersion: spec.version,
        needsUpgrade: parsed.version !== spec.version,
      }
    } catch (error) {
      return {
        id: spec.id,
        source: 'package',
        path: location.path,
        codeVersion: spec.version,
        needsUpgrade: false,
        error: messageOf(error),
      }
    }
  }

  function dynamicIds(): string[] {
    if (!existsSync(componentsRoot)) return []
    const ids = new Set<string>()
    for (const entry of readdirSync(componentsRoot, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      if (entry.isFile() && entry.name.endsWith('.yaml')) {
        ids.add(entry.name.slice(0, -'.yaml'.length))
      } else if (entry.isDirectory() && existsSync(join(componentsRoot, entry.name, DESCRIPTOR_FILE))) {
        ids.add(entry.name)
      }
    }
    return [...ids].filter(id => !packageIds.has(id))
  }

  function dynamicEntry(id: string): RegistryEntry {
    const location = locate(id)
    if (location === undefined) {
      return {
        id,
        source: 'dynamic',
        path: join(componentsRoot, `${id}.yaml`),
        needsUpgrade: false,
        error: i18n.t('component.definition-file-missing'),
      }
    }
    if ('conflict' in location) {
      return { id, source: 'dynamic', path: join(componentsRoot, id), needsUpgrade: false, error: location.conflict }
    }
    try {
      const parsed = readDefinition(location.path)
      if (parsed.id !== id) {
        throw new ComponentFailure(
          'invalid-definition',
          i18n.t('component.definition-id-mismatch', { actual: parsed.id, expected: id }),
        )
      }
      return { id, source: 'dynamic', path: location.path, spec: parsed, needsUpgrade: false }
    } catch (error) {
      return { id, source: 'dynamic', path: location.path, needsUpgrade: false, error: messageOf(error) }
    }
  }

  function entries(): RegistryEntry[] {
    materialize()
    const result = packageDefinitions.map(packageEntry)
    for (const id of dynamicIds()) result.push(dynamicEntry(id))
    return result
  }

  function entryById(id: string): RegistryEntry {
    const found = entries().find(entry => entry.id === id)
    if (found === undefined) {
      throw new ComponentFailure('component-not-found', i18n.t('component.not-found', { id }))
    }
    if (found.error !== undefined) {
      throw new ComponentFailure(
        'invalid-definition',
        i18n.t('component.definition-problem', { path: found.path, detail: found.error }),
      )
    }
    return found
  }

  function configPath(spec: ComponentSpec): string | undefined {
    if (typeof spec.config !== 'string') return undefined
    const target = resolve(dataDirectory, spec.config)
    const base = resolve(dataDirectory)
    if (target !== base && !target.startsWith(base + sep)) {
      throw new ComponentFailure('invalid-spec', i18n.t('component.config-outside-data', { config: spec.config }))
    }
    return target
  }

  function externalOf(
    entry: RegistryEntry,
    byId: ReadonlyMap<string, RegistryEntry>,
    seen: ReadonlySet<string>,
  ): ComponentExternalView | undefined {
    const spec = entry.spec
    if (spec === undefined) return undefined
    if (spec.kind === 'external') {
      const row = stateStore.read(entry.id)
      return {
        state: row?.externalState ?? null,
        detail: row?.externalDetail ?? '',
        ...(row?.externalCheckedAt == null ? {} : { checkedAt: row.externalCheckedAt }),
        source: 'probe',
      }
    }
    const requires = spec.requires ?? []
    if (requires.length === 0) return undefined
    if (seen.has(entry.id)) {
      return { state: 'abnormal', detail: i18n.t('component.dependency-cycle'), source: 'derived' }
    }
    const nextSeen = new Set(seen)
    nextSeen.add(entry.id)
    let worst: ExternalState = 'healthy'
    let checkedAt: string | undefined
    const details: string[] = []
    for (const dependency of requires) {
      const target = byId.get(dependency)
      if (target === undefined) {
        return {
          state: null,
          detail: i18n.t('component.dependency-missing', { dependency }),
          source: 'derived',
        }
      }
      if (target.spec === undefined || target.error !== undefined) {
        return {
          state: null,
          detail: i18n.t('component.dependency-unavailable', { dependency }),
          source: 'derived',
        }
      }
      const view = externalOf(target, byId, nextSeen)
      if (view === undefined) continue
      if (view.state === null) {
        return {
          state: null,
          detail: i18n.t('component.dependency-unprobed', { dependency }),
          source: 'derived',
        }
      }
      if (EXTERNAL_RANK[view.state] > EXTERNAL_RANK[worst]) worst = view.state
      details.push(i18n.t('component.dependency-state', { dependency, state: view.state }))
      if (view.checkedAt !== undefined && (checkedAt === undefined || view.checkedAt > checkedAt)) {
        checkedAt = view.checkedAt
      }
    }
    return {
      state: worst,
      detail: details.length === 0 ? i18n.t('component.dependency-no-external') : details.join('；'),
      ...(checkedAt === undefined ? {} : { checkedAt }),
      source: 'derived',
    }
  }

  function viewOf(entry: RegistryEntry, all: readonly RegistryEntry[]): ComponentView {
    const spec = entry.spec
    if (spec === undefined) {
      throw new ComponentFailure(
        'invalid-definition',
        i18n.t('component.definition-problem', {
          path: entry.path,
          detail: entry.error ?? i18n.t('component.definition-unavailable'),
        }),
      )
    }
    const byId = new Map(all.map(item => [item.id, item]))
    const external = externalOf(entry, byId, new Set())
    const row = stateStore.read(entry.id)
    const configuredPath = configPath(spec)
    const deploy: ComponentDeployView =
      spec.deploy === undefined
        ? { state: 'not-deployable', detail: i18n.t('component.deploy-not-declared') }
        : {
            state: row?.deployState ?? 'not-deployed',
            detail: row?.deployDetail ?? i18n.t('component.deploy-not-run'),
            ...(row?.deployCheckedAt == null ? {} : { checkedAt: row.deployCheckedAt }),
          }
    return {
      id: spec.id,
      name: spec.name,
      summary: spec.summary,
      kind: spec.kind,
      version: spec.version,
      ...(entry.codeVersion === undefined ? {} : { codeVersion: entry.codeVersion }),
      needsUpgrade: entry.needsUpgrade,
      requires: spec.requires ?? [],
      ...(spec.operations === undefined ? {} : { operations: spec.operations }),
      ...(spec.credentials === undefined ? {} : { credentials: spec.credentials }),
      source: entry.source,
      definitionPath: entry.path,
      ...(configuredPath === undefined ? {} : { configPath: configuredPath }),
      ...(spec.info === undefined ? {} : { info: spec.info }),
      ...(external === undefined ? {} : { external }),
      deploy,
    }
  }

  function show(id: string): ComponentView {
    const all = entries()
    const entry = all.find(item => item.id === id)
    if (entry === undefined) {
      throw new ComponentFailure('component-not-found', i18n.t('component.not-found', { id }))
    }
    return viewOf(entry, all)
  }

  function requireDynamicTarget(id: string): void {
    requireRegistrableId(id)
    if (packageIds.has(id)) {
      throw new ComponentFailure('component-package', i18n.t('component.package-readonly', { id }))
    }
    if (locate(id) !== undefined) {
      throw new ComponentFailure('component-exists', i18n.t('component.exists', { id }))
    }
  }

  function addExternalText(text: string): ComponentView {
    const spec = parseComponent(text)
    if (spec.kind !== 'external') {
      throw new ComponentFailure('invalid-spec', i18n.t('component.external-only'))
    }
    requireDynamicTarget(spec.id)
    writeDefinition(join(componentsRoot, `${spec.id}.yaml`), spec)
    return show(spec.id)
  }

  return {
    list() {
      assertActive()
      const all = entries()
      const components: ComponentView[] = []
      const problems: ComponentProblem[] = []
      for (const entry of all) {
        if (entry.error !== undefined || entry.spec === undefined) {
          problems.push({
            id: entry.id,
            source: entry.source,
            path: entry.path,
            error: entry.error ?? i18n.t('component.definition-unavailable'),
          })
          continue
        }
        try {
          components.push(viewOf(entry, all))
        } catch (error) {
          problems.push({
            id: entry.id,
            source: entry.source,
            path: entry.path,
            error: messageOf(error),
          })
        }
      }
      components.sort((left, right) => left.id.localeCompare(right.id))
      problems.sort((left, right) => left.id.localeCompare(right.id))
      return { components, problems }
    },
    show(id) {
      assertActive()
      return show(id)
    },
    addFromText(text) {
      assertActive()
      return addExternalText(text)
    },
    addFromPath(path) {
      assertActive()
      const source = resolve(path)
      let stats
      try {
        stats = statSync(source)
      } catch (error) {
        throw new ComponentFailure('io', i18n.t('component.read-source-failed', { source, detail: messageOf(error) }))
      }
      if (!stats.isDirectory()) {
        let text: string
        try {
          text = readFileSync(source, 'utf8')
        } catch (error) {
          throw new ComponentFailure(
            'io',
            i18n.t('component.read-definition-source-failed', { source, detail: messageOf(error) }),
          )
        }
        return addExternalText(text)
      }
      const descriptor = join(source, DESCRIPTOR_FILE)
      if (!existsSync(descriptor)) {
        throw new ComponentFailure(
          'invalid-spec',
          i18n.t('component.folder-descriptor-missing', { file: DESCRIPTOR_FILE, source }),
        )
      }
      const spec = readDefinition(descriptor)
      if (spec.kind !== 'external') {
        throw new ComponentFailure('invalid-spec', i18n.t('component.external-only'))
      }
      requireDynamicTarget(spec.id)
      const destination = join(componentsRoot, spec.id)
      const temporary = join(componentsRoot, `.${spec.id}.${randomUUID()}.tmp`)
      try {
        mkdirSync(componentsRoot, { recursive: true })
        cpSync(source, temporary, { recursive: true })
        renameSync(temporary, destination)
      } catch (error) {
        rmSync(temporary, { recursive: true, force: true })
        throw new ComponentFailure(
          'io',
          i18n.t('component.copy-definition-failed', { source, detail: messageOf(error) }),
        )
      }
      return show(spec.id)
    },
    remove(id) {
      assertActive()
      const entry = entryById(id)
      if (entry.source === 'package') {
        throw new ComponentFailure('component-package', i18n.t('component.package-delete', { id }))
      }
      try {
        rmSync(entry.path, { force: true })
        if (entry.path.endsWith(DESCRIPTOR_FILE)) {
          const folder = dirname(entry.path)
          if (basename(folder) === id) rmSync(folder, { recursive: true, force: true })
        }
      } catch (error) {
        throw new ComponentFailure(
          'io',
          i18n.t('component.delete-definition-failed', { path: entry.path, detail: messageOf(error) }),
        )
      }
      stateStore.remove(id)
    },
    upgrade(id) {
      assertActive()
      const entry = entryById(id)
      if (entry.source !== 'package') {
        throw new ComponentFailure('component-package', i18n.t('component.upgrade-package-only', { id }))
      }
      const code = packageDefinitions.find(spec => spec.id === id)
      if (code === undefined) {
        throw new ComponentFailure('component-not-found', i18n.t('component.package-definition-missing', { id }))
      }
      const current = entry.spec
      const config = current?.config ?? code.config
      const upgraded = withConfig(code, config)
      writeDefinition(entry.path, upgraded)
      return show(id)
    },
    async probe(id) {
      assertActive()
      const entry = entryById(id)
      const spec = entry.spec
      if (spec === undefined) {
        throw new ComponentFailure(
          'invalid-definition',
          i18n.t('component.definition-problem', {
            path: entry.path,
            detail: i18n.t('component.definition-unavailable'),
          }),
        )
      }
      if (spec.kind === 'locus') {
        if ((spec.requires ?? []).length === 0) {
          throw new ComponentFailure('no-external', i18n.t('component.no-external-state', { id }))
        }
        return show(id)
      }
      if (spec.probe === undefined) {
        throw new ComponentFailure('no-probe', i18n.t('component.no-probe', { id }))
      }
      const outcome = await executeProbe(spec.probe, runner)
      stateStore.recordExternal(id, outcome.state, outcome.detail, new Date().toISOString())
      return show(id)
    },
    async deploy(id) {
      assertActive()
      const entry = entryById(id)
      const spec = entry.spec
      if (spec === undefined) {
        throw new ComponentFailure(
          'invalid-definition',
          i18n.t('component.definition-problem', {
            path: entry.path,
            detail: i18n.t('component.definition-unavailable'),
          }),
        )
      }
      if (spec.deploy === undefined) {
        throw new ComponentFailure('no-deploy', i18n.t('component.no-deploy', { id }))
      }
      const timeoutMs = spec.deploy.timeoutMs ?? DEPLOY_TIMEOUT_MS
      const result = await runner.run(spec.deploy.argv, { timeoutMs })
      const classified = classifyDeploy(result)
      stateStore.recordDeploy(id, classified.state, classified.detail, new Date().toISOString())
      return show(id)
    },
    dispose() {
      if (disposed) return
      disposed = true
      stateStore.dispose()
    },
  }
}

function requireRegistrableId(id: string): void {
  if (id === 'locus') {
    throw new ComponentFailure('invalid-spec', i18n.t('component.id-reserved'))
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function summarize(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map(value => value.trim())
    .find(value => value.length > 0)
  return (line ?? '').slice(0, DETAIL_LIMIT)
}

function serialize(spec: ComponentSpec): Record<string, unknown> {
  const output: Record<string, unknown> = {
    id: spec.id,
    version: spec.version,
    name: spec.name,
    summary: spec.summary,
    kind: spec.kind,
  }
  if (spec.requires !== undefined) output.requires = spec.requires
  if (spec.config !== undefined) output.config = spec.config
  if (spec.probe !== undefined) output.probe = spec.probe
  if (spec.deploy !== undefined) output.deploy = spec.deploy
  if (spec.info !== undefined) output.info = spec.info
  return output
}

function withConfig(spec: ComponentSpec, config: ComponentConfig | undefined): ComponentSpec {
  return parseComponent(
    {
      id: spec.id,
      version: spec.version,
      name: spec.name,
      summary: spec.summary,
      kind: spec.kind,
      ...(spec.requires === undefined ? {} : { requires: spec.requires }),
      ...(spec.operations === undefined ? {} : { operations: spec.operations }),
      ...(spec.credentials === undefined ? {} : { credentials: spec.credentials }),
      ...(config === undefined ? {} : { config }),
      ...(spec.probe === undefined ? {} : { probe: spec.probe }),
      ...(spec.deploy === undefined ? {} : { deploy: spec.deploy }),
      ...(spec.info === undefined ? {} : { info: spec.info }),
    },
    { allowContract: true },
  )
}

function classifyProbe(
  argv: readonly string[],
  result: ComponentCommandResult,
  onFailure: 'stopped' | 'abnormal',
): { state: ExternalState; detail: string } {
  if (result.errorCode === 'ENOENT') {
    return {
      state: 'absent',
      detail: i18n.t('component.executable-missing', { path: argv[0] ?? '' }),
    }
  }
  if (result.timedOut) {
    return { state: 'abnormal', detail: i18n.t('component.probe-timeout') }
  }
  if (result.exitCode === 0) {
    return {
      state: 'healthy',
      detail: summarize(result.stdout) || summarize(result.stderr) || i18n.t('component.probe-succeeded'),
    }
  }
  return {
    state: onFailure,
    detail:
      summarize(result.stderr) || summarize(result.stdout) || i18n.t('component.exit-code', { code: result.exitCode }),
  }
}

function classifyDeploy(result: ComponentCommandResult): { state: DeployState; detail: string } {
  if (result.exitCode === 0 && result.errorCode === null) {
    return {
      state: 'deployed',
      detail: summarize(result.stdout) || summarize(result.stderr) || i18n.t('component.deploy-succeeded'),
    }
  }
  return {
    state: 'failed',
    detail: summarize(result.stderr) || summarize(result.stdout) || i18n.t('component.deploy-failed'),
  }
}

interface ProbeOutcome {
  readonly state: ExternalState
  readonly detail: string
}

function probeTcp(probe: TcpProbe): Promise<ProbeOutcome> {
  const { promise, resolve } = Promise.withResolvers<ProbeOutcome>()
  const endpoint = `${probe.host}:${probe.port}`
  const timeoutMs = probe.timeoutMs ?? PROBE_TIMEOUT_MS
  const socket = connect({ host: probe.host, port: probe.port })
  let settled = false
  const finish = (outcome: ProbeOutcome): void => {
    if (settled) return
    settled = true
    socket.destroy()
    resolve(outcome)
  }
  socket.setTimeout(timeoutMs)
  socket.once('connect', () =>
    finish({ state: 'healthy', detail: i18n.t('component.endpoint-reachable', { endpoint }) }),
  )
  socket.once('timeout', () =>
    finish({ state: 'abnormal', detail: i18n.t('component.endpoint-timeout', { endpoint }) }),
  )
  socket.once('error', (error: NodeJS.ErrnoException) => {
    finish({
      state: probe.onFailure ?? 'abnormal',
      detail: `${endpoint} ${error.code ?? error.message}`,
    })
  })
  return promise
}

async function probeHttp(probe: HttpProbe): Promise<ProbeOutcome> {
  const timeoutMs = probe.timeoutMs ?? PROBE_TIMEOUT_MS
  const expectStatus = probe.expectStatus ?? 200
  try {
    const response = await fetch(probe.url, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.body !== null) {
      await response.body.cancel().catch(() => undefined)
    }
    if (response.status === expectStatus) {
      return {
        state: 'healthy',
        detail: i18n.t('component.http-ok', { url: probe.url, status: response.status }),
      }
    }
    return {
      state: probe.onFailure ?? 'abnormal',
      detail: i18n.t('component.http-status', {
        url: probe.url,
        status: response.status,
        expected: expectStatus,
      }),
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { state: 'abnormal', detail: i18n.t('component.http-timeout', { url: probe.url }) }
    }
    return {
      state: probe.onFailure ?? 'abnormal',
      detail: `${probe.url} ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function executeProbe(probe: ComponentProbe, runner: ComponentRunner): Promise<ProbeOutcome> {
  if (probe.kind === 'tcp') return probeTcp(probe)
  if (probe.kind === 'http') return probeHttp(probe)
  const timeoutMs = probe.timeoutMs ?? PROBE_TIMEOUT_MS
  const result = await runner.run(probe.argv, { timeoutMs })
  return classifyProbe(probe.argv, result, probe.onFailure ?? 'abnormal')
}

const EXTERNAL_RANK: Record<ExternalState, number> = {
  healthy: 1,
  abnormal: 2,
  stopped: 3,
  absent: 4,
}
