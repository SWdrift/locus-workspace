import type {
  CapabilityDescriptor,
  ConnectionInspection,
  ConnectionProfile,
  ConnectivityService,
  FilesystemLocation,
  FilesystemObservation,
  FilesystemService,
  GiteaRepository,
  GiteaRepositorySuggestion,
  GiteaRun,
  GiteaRunListObservation,
  GiteaInstance,
  GiteaService,
  GitObservation,
  GitService,
  LocusService,
  RemoteMachine,
  RemoteMachineService,
  SessionService,
  SessionSummary,
  Workspace,
  WorkspaceRelation,
} from '@locus/contracts'
import {
  FILESYSTEM_NAMESPACE_PREFIX,
  GIT_NAMESPACE_PREFIX,
  GITEA_REPOSITORY_NAMESPACE,
  REMOTE_MACHINE_NAMESPACE,
  SESSION_NAMESPACE_PREFIX,
} from '@locus/contracts'

export interface WorkspaceOverviewServices {
  readonly locus: LocusService
  readonly filesystem?: FilesystemService
  readonly git?: GitService
  readonly gitea?: GiteaService
  readonly session?: SessionService
  readonly remoteMachine?: RemoteMachineService
  readonly connectivity?: ConnectivityService
}

export interface WorkspaceOverviewOptions {
  /** 默认只读取长期关系和本地配置；显式观察才访问原生资源或只读 API。 */
  readonly observe?: boolean
  /** 单次外部观察的宿主时限；底层服务仍保留自己的超时上限。 */
  readonly timeoutMs?: number
}

export interface OverviewProviderStatus {
  id: string
  selected: boolean
  selectedProvider?: string
  loaded: boolean
  provider?: string
  /** null 表示尚未检查；false 表示已加载但不可用或提供方不匹配。 */
  available: boolean | null
  error?: string
}

export interface OverviewRelation {
  readonly relationId: string
  readonly kind: WorkspaceRelation['kind']
  readonly reference: WorkspaceRelation['target']
  readonly source: WorkspaceRelation['source']
}

export interface OverviewFilesystemLocation {
  readonly location: FilesystemLocation
  state: 'not-observed' | FilesystemObservation['state']
  observation?: FilesystemObservation
  confirmedRelations: string[]
  actions: string[]
  error?: string
}

export interface OverviewFilesystem {
  state: 'unavailable' | 'empty' | 'configured' | 'observed'
  locations: OverviewFilesystemLocation[]
  relations: OverviewRelation[]
  error?: string
}

export interface OverviewGitRepository {
  readonly locationId: string
  readonly locationPath: string
  state: 'not-observed' | GitObservation['state']
  observation?: GitObservation
  confirmedRelations: string[]
  actions: string[]
  error?: string
}

export interface OverviewGit {
  state: 'unavailable' | 'empty' | 'not-observed' | 'observed'
  repositories: OverviewGitRepository[]
  relations: OverviewRelation[]
  error?: string
}

export interface OverviewGiteaHead {
  state: 'matched' | 'no-local-git' | 'unmatched' | 'ambiguous' | 'no-commit'
  runsState?: GiteaRunListObservation['state']
  commit?: string
  locationId?: string
  remoteName?: string
  runs: readonly GiteaRun[]
  note: string
  error?: string
}

export interface OverviewGiteaRepository {
  readonly relationId: string
  readonly reference: WorkspaceRelation['target']
  state: 'not-observed' | 'unavailable' | GiteaRunListObservation['state']
  observedAt?: string
  instanceId?: string
  instance?: { readonly id: string; readonly name: string; readonly baseUrl: string }
  repository?: GiteaRepository
  latestRun?: GiteaRun
  head?: OverviewGiteaHead
  actions: string[]
  error?: string
}

export interface OverviewGiteaSuggestion extends GiteaRepositorySuggestion {
  readonly locationId: string
  readonly locationPath: string
  readonly branch?: string | null
  readonly commit?: string | null
  readonly actions: string[]
}

export interface OverviewGitea {
  state: 'unavailable' | 'empty' | 'not-observed' | 'observed'
  repositories: OverviewGiteaRepository[]
  suggestions: OverviewGiteaSuggestion[]
  error?: string
}

export interface OverviewSessionLink {
  readonly relationId: string
  readonly reference: WorkspaceRelation['target']
  readonly sourceId: string
  sourceLabel?: string
  state: 'not-observed' | 'unavailable' | SessionSummary['state']
  summary?: SessionSummary
  actions: string[]
  error?: string
}

export interface OverviewSessions {
  state: 'unavailable' | 'empty' | 'not-observed' | 'observed'
  links: OverviewSessionLink[]
  error?: string
}

export interface OverviewMachine {
  readonly relationId: string
  readonly machineId: string
  state: 'ready' | 'unavailable'
  machine?: RemoteMachine
  profileCount: number | null
  actions: string[]
  error?: string
}

export interface OverviewMachines {
  state: 'unavailable' | 'empty' | 'ready'
  items: OverviewMachine[]
  error?: string
}

export interface OverviewProfile {
  readonly id: string
  readonly machineId: string
  readonly name: string
  readonly transport: ConnectionProfile['transport']
  readonly target: string
  readonly port?: number
  readonly user?: string
  readonly proxyJump?: string
  readonly identityConfigured: boolean
  readonly knownHostsConfigured: boolean
  readonly sshConfigConfigured: boolean
}

export interface OverviewConnection {
  readonly machineRelationId?: string
  readonly profile: OverviewProfile
  state: 'not-observed' | ConnectionInspection['state']
  inspection?: ConnectionInspection
  actions: string[]
  error?: string
}

export interface OverviewConnectivity {
  state: 'unavailable' | 'empty' | 'not-observed' | 'observed'
  profiles: OverviewConnection[]
  error?: string
}

export interface OverviewAttention {
  readonly code: string
  readonly domain: 'workspace' | 'filesystem' | 'git' | 'gitea' | 'session' | 'machine' | 'connectivity'
  readonly message: string
}

export interface WorkspaceOverview {
  readonly workspace: {
    readonly id: string
    readonly name: string
    readonly createdAt: string
    readonly capabilities: readonly CapabilityDescriptor[]
  }
  readonly mode: 'relations' | 'observed'
  readonly generatedAt: string
  readonly durationMs: number
  readonly timings: {
    readonly totalMs: number
    readonly filesystemMs: number
    readonly gitMs: number
    readonly giteaMs: number
    readonly sessionMs: number
    readonly connectivityMs: number
  }
  providers: OverviewProviderStatus[]
  filesystem: OverviewFilesystem
  git: OverviewGit
  gitea: OverviewGitea
  sessions: OverviewSessions
  machines: OverviewMachines
  connectivity: OverviewConnectivity
  otherRelations: OverviewRelation[]
  attention: OverviewAttention[]
  next: string[]
}

const KNOWN_RELATION_NAMESPACES = [
  FILESYSTEM_NAMESPACE_PREFIX,
  GIT_NAMESPACE_PREFIX,
  GITEA_REPOSITORY_NAMESPACE,
  REMOTE_MACHINE_NAMESPACE,
  SESSION_NAMESPACE_PREFIX,
] as const

const OBSERVE_TIMEOUT_MS = 10_000
const MAX_HEAD_RUNS = 3
const MAX_NEXT_ACTIONS = 12

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function relationView(relation: WorkspaceRelation): OverviewRelation {
  return {
    relationId: relation.id,
    kind: relation.kind,
    reference: relation.target,
    source: relation.source,
  }
}

function selectedCapability(workspace: Workspace, id: string): CapabilityDescriptor | undefined {
  return workspace.capabilities.find((capability) => capability.id === id)
}

function providerStatus(
  workspace: Workspace,
  id: string,
  provider: CapabilityDescriptor | undefined,
): OverviewProviderStatus {
  const selected = selectedCapability(workspace, id)
  const loaded = provider !== undefined
  const sameProvider = selected === undefined || provider === undefined || selected.provider === provider.provider
  const error = !loaded
    ? '提供方未加载；长期关系和已保存配置仍保留。'
    : !sameProvider
      ? `已加载提供方 ${provider.provider} 与保存选择 ${selected?.provider} 不同；未自动替换。`
      : undefined
  return {
    id,
    selected: selected !== undefined,
    ...(selected === undefined ? {} : { selectedProvider: selected.provider }),
    loaded,
    ...(provider === undefined ? {} : { provider: provider.provider }),
    available: !loaded || !sameProvider ? false : id === 'locus.filesystem' ? true : null,
    ...(error === undefined ? {} : { error }),
  }
}

async function checkProviderAvailability(
  provider: OverviewProviderStatus,
  service: { availability(): Promise<{ available: boolean; error?: string }> } | undefined,
): Promise<void> {
  if (!provider.selected || provider.available !== null || service === undefined) return
  try {
    const result = await service.availability()
    provider.available = result.available
    if (result.error !== undefined) provider.error = result.error
  } catch (error) {
    provider.available = false
    provider.error = describe(error)
  }
}

function profileView(profile: ConnectionProfile): OverviewProfile {
  return {
    id: profile.id,
    machineId: profile.machineId,
    name: profile.name,
    transport: profile.transport,
    target: profile.target,
    ...(profile.port === undefined ? {} : { port: profile.port }),
    ...(profile.user === undefined ? {} : { user: profile.user }),
    ...(profile.proxyJump === undefined ? {} : { proxyJump: profile.proxyJump }),
    identityConfigured: profile.identityFile !== undefined,
    knownHostsConfigured: profile.knownHostsFile !== undefined,
    sshConfigConfigured: profile.sshConfigFile !== undefined,
  }
}

function timeoutSignal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs)
}

function sameReference(left: WorkspaceRelation['target'], right: WorkspaceRelation['target']): boolean {
  return left.namespace === right.namespace && left.id === right.id
}

function quoteArgument(value: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`
}

function command(parts: readonly string[]): string {
  return parts.map(quoteArgument).join(' ')
}

function addNext(target: string[], value: string): void {
  if (target.length < MAX_NEXT_ACTIONS && !target.includes(value)) target.push(value)
}

function runAttention(
  domain: OverviewAttention['domain'],
  code: string,
  message: string,
): OverviewAttention {
  return { domain, code, message }
}

function providerById(providers: readonly OverviewProviderStatus[], id: string): OverviewProviderStatus {
  const provider = providers.find((item) => item.id === id)
  if (provider === undefined) throw new Error(`Overview 缺少提供方状态：${id}`)
  return provider
}

function runProblem(run: GiteaRun): boolean {
  return run.outcome === 'failure' || run.outcome === 'cancelled' || run.outcome === 'unknown'
}

function headNote(head: Omit<OverviewGiteaHead, 'note'>): string {
  if (head.state === 'no-local-git') return '没有可用于对应的本地 Git 仓库或 Remote。'
  if (head.state === 'unmatched') return '本地 Remote 与仓库完整名称不一致；可重新生成候选或显式确认关联。'
  if (head.state === 'ambiguous') return '多个本地仓库指向同一 Gitea 仓库；先明确应使用哪一个 HEAD。'
  if (head.state === 'no-commit') return '本地仓库尚无提交；无法对应当前 HEAD 的 CI。'
  if (head.runsState === 'empty') return '当前提交没有匹配的 Run；查看近期 Run、提交与工作流触发条件。CI 无结果不表示失败。'
  if (head.runsState !== undefined && head.runsState !== 'available') {
    return `本地 HEAD 的 Run 查询为 ${head.runsState}；这不表示没有 CI。`
  }
  if (head.runs.some(runProblem)) return '已找到本地 HEAD 的 Run，但结论需要查看详情。'
  return '本地 HEAD 有对应 Run；CI 结果不代表部署成功。'
}

function withHeadNote(head: Omit<OverviewGiteaHead, 'note'>): OverviewGiteaHead {
  return { ...head, note: headNote(head) }
}

export async function buildWorkspaceOverview(
  services: WorkspaceOverviewServices,
  workspaceId: string,
  options: WorkspaceOverviewOptions = {},
): Promise<WorkspaceOverview> {
  const started = Date.now()
  const observe = options.observe === true
  const timeoutMs = options.timeoutMs ?? OBSERVE_TIMEOUT_MS
  const workspace = services.locus.workspaces.get(workspaceId)
  const relations = workspace.relations
  const fsRelations = relations.filter((relation) =>
    relation.target.namespace.startsWith(FILESYSTEM_NAMESPACE_PREFIX))
  const gitRelations = relations.filter((relation) =>
    relation.target.namespace.startsWith(GIT_NAMESPACE_PREFIX))
  const giteaRelations = relations.filter((relation) =>
    relation.target.namespace === GITEA_REPOSITORY_NAMESPACE)
  const sessionRelations = relations.filter((relation) =>
    relation.target.namespace.startsWith(SESSION_NAMESPACE_PREFIX))
  const machineRelations = relations.filter((relation) =>
    relation.target.namespace === REMOTE_MACHINE_NAMESPACE)
  const otherRelations = relations.filter((relation) =>
    !KNOWN_RELATION_NAMESPACES.some((namespace) =>
      namespace.endsWith(':')
        ? relation.target.namespace.startsWith(namespace)
        : relation.target.namespace === namespace))

  const providers = [
    providerStatus(workspace, 'locus.filesystem', services.filesystem?.capability),
    providerStatus(workspace, 'locus.git', services.git?.capability),
    providerStatus(workspace, 'locus.gitea', services.gitea?.capability),
    providerStatus(workspace, 'locus.session', services.session?.capability),
    providerStatus(workspace, 'locus.remote-machine', services.remoteMachine?.capability),
    providerStatus(workspace, 'locus.connectivity', services.connectivity?.capability),
  ]
  const fsSelected = selectedCapability(workspace, 'locus.filesystem') !== undefined
  const gitSelected = selectedCapability(workspace, 'locus.git') !== undefined
  const giteaSelected = selectedCapability(workspace, 'locus.gitea') !== undefined
  const sessionSelected = selectedCapability(workspace, 'locus.session') !== undefined
  const connectivitySelected = selectedCapability(workspace, 'locus.connectivity') !== undefined

  let filesystemMs = 0
  let gitMs = 0
  let giteaMs = 0
  let sessionMs = 0
  let connectivityMs = 0

  let locations: readonly FilesystemLocation[] = []
  let filesystemListError: string | undefined
  if (services.filesystem !== undefined && (fsSelected || fsRelations.length > 0)) {
    const start = Date.now()
    try {
      locations = services.filesystem.locations(workspaceId)
    } catch (error) {
      filesystemListError = describe(error)
    }
    filesystemMs += Date.now() - start
  } else if (services.filesystem === undefined && (fsSelected || fsRelations.length > 0)) {
    filesystemListError = 'Filesystem 能力不可用：profile 未加载 locusFilesystem；已保存关系保留。'
  }

  let profileList: readonly ConnectionProfile[] | undefined
  let connectivityListError: string | undefined
  if (services.connectivity !== undefined && machineRelations.length > 0) {
    const start = Date.now()
    try {
      profileList = services.connectivity.list()
    } catch (error) {
      connectivityListError = describe(error)
    }
    connectivityMs += Date.now() - start
  } else if (services.connectivity === undefined && machineRelations.length > 0) {
    connectivityListError = 'Connectivity 能力不可用：profile 未加载 locusConnectivity；Profile 配置保留。'
  }
  const profileCount = (machineId: string): number | null => profileList === undefined
    ? null
    : profileList.filter((profile) => profile.machineId === machineId).length

  const machineItems: OverviewMachine[] = machineRelations.map((relation) => {
    if (services.remoteMachine === undefined) {
      return {
        relationId: relation.id,
        machineId: relation.target.id,
        state: 'unavailable',
        profileCount: profileCount(relation.target.id),
        actions: [command(['capability', 'list', workspaceId])],
        error: 'Remote Machine 能力不可用：profile 未加载 locusRemoteMachine；已保存关系保留。',
      }
    }
    try {
      const machine = services.remoteMachine.get(relation.target.id)
      return {
        relationId: relation.id,
        machineId: relation.target.id,
        state: 'ready',
        machine,
        profileCount: profileCount(machine.id),
        actions: [command(['machine', 'show', machine.id])],
      }
    } catch (error) {
      return {
        relationId: relation.id,
        machineId: relation.target.id,
        state: 'unavailable',
        profileCount: profileCount(relation.target.id),
        actions: [command(['machine', 'list'])],
        error: describe(error),
      }
    }
  })
  for (const item of machineItems) {
    if (item.machine === undefined || item.profileCount !== 0 || services.connectivity === undefined) continue
    if (!connectivitySelected) {
      addNext(item.actions, command(['capability', 'configure', workspaceId, 'connectivity']))
      continue
    }
    const address = item.machine.addresses.find((value) => value.kind === 'ssh')
    if (address === undefined) continue
    const parts = [
      'connect', 'profile', 'add', item.machine.id, 'default', '--target', address.value,
    ]
    if (address.port !== undefined) parts.push('--port', String(address.port))
    addNext(item.actions, command(parts))
  }

  const connections: OverviewConnection[] = (profileList ?? [])
    .filter((profile) => machineRelations.some((relation) => relation.target.id === profile.machineId))
    .map((profile) => {
      const relation = machineRelations.find((item) => item.target.id === profile.machineId)
      return {
        ...(relation === undefined ? {} : { machineRelationId: relation.id }),
        profile: profileView(profile),
        state: 'not-observed',
        actions: connectivitySelected
          ? [command(['connect', 'inspect', profile.id])]
          : [command(['capability', 'configure', workspaceId, 'connectivity'])],
      }
    })

  const fsRelationsView = fsRelations.map(relationView)
  const gitRelationsView = gitRelations.map(relationView)
  const sessionLinks: OverviewSessionLink[] = sessionRelations.map((relation) => ({
    relationId: relation.id,
    reference: relation.target,
    sourceId: relation.target.namespace.slice(SESSION_NAMESPACE_PREFIX.length),
    state: 'not-observed',
    actions: services.session === undefined
      ? [command(['capability', 'list', workspaceId])]
      : sessionSelected
        ? [command(['session', 'show', relation.target.id])]
        : [command(['capability', 'configure', workspaceId, 'session'])],
  }))
  let giteaRepositories: OverviewGiteaRepository[] = giteaRelations.map((relation) => ({
    relationId: relation.id,
    reference: relation.target,
    state: services.gitea === undefined ? 'unavailable' : 'not-observed',
    actions: services.gitea === undefined
      ? [command(['capability', 'list', workspaceId])]
      : giteaSelected
        ? [command(['gitea', 'runs', workspaceId, relation.id])]
        : [command(['capability', 'configure', workspaceId, 'gitea'])],
    ...(services.gitea === undefined
      ? { error: 'Gitea 能力不可用：profile 未加载 locusGitea；已保存关系保留。' }
      : {}),
  }))

  const gitRepositories: OverviewGitRepository[] = gitSelected || gitRelations.length > 0
    ? locations.map((location) => ({
      locationId: location.id,
      locationPath: location.path,
      state: 'not-observed',
      confirmedRelations: [],
      actions: services.git === undefined
        ? [command(['capability', 'list', workspaceId])]
        : [command(['git', 'inspect', workspaceId, location.id])],
    }))
    : []
  const filesystemLocations: OverviewFilesystemLocation[] = locations.map((location) => ({
    location,
    state: 'not-observed',
    confirmedRelations: fsRelations
      .filter((relation) => sameReference(relation.target, location.reference))
      .map((relation) => relation.id),
    actions: [command(['fs', 'inspect', workspaceId, location.id])],
  }))

  let gitObservations: GitObservation[] = []
  let filesystemError = filesystemListError
  let gitError: string | undefined = services.git === undefined && (gitSelected || gitRelations.length > 0)
    ? 'Git 能力不可用：profile 未加载 locusGit；已保存关系保留。'
    : undefined
  let giteaError: string | undefined
  let sessionError: string | undefined = services.session === undefined && sessionRelations.length > 0
    ? 'Session 能力不可用：profile 未加载 locusSession；已保存关联保留。'
    : undefined
  let giteaSuggestions: OverviewGiteaSuggestion[] = []

  if (observe) {
    const availability = Promise.all([
      checkProviderAvailability(providerById(providers, 'locus.git'), services.git),
      checkProviderAvailability(providerById(providers, 'locus.gitea'), services.gitea),
      checkProviderAvailability(providerById(providers, 'locus.session'), services.session),
      checkProviderAvailability(providerById(providers, 'locus.remote-machine'), services.remoteMachine),
      checkProviderAvailability(providerById(providers, 'locus.connectivity'), services.connectivity),
    ])

    if (locations.length > 0) {
      if (gitSelected && services.git !== undefined) {
        const start = Date.now()
        const results = await Promise.all(locations.map(async (location) => {
          try {
            return { location, observation: await services.git!.inspect(workspaceId, location.id) }
          } catch (error) {
            return { location, error: describe(error) }
          }
        }))
        gitMs += Date.now() - start
        gitObservations = results.flatMap((result) => 'observation' in result ? [result.observation] : [])
        for (const result of results) {
          const index = gitRepositories.findIndex((item) => item.locationId === result.location.id)
          if (index < 0) continue
          if ('observation' in result) {
            const observation = result.observation
            gitRepositories[index] = {
              ...gitRepositories[index]!,
              state: observation.state,
              observation,
              confirmedRelations: gitRelations
                .filter((relation) => observation.reference !== undefined &&
                  sameReference(relation.target, observation.reference))
                .map((relation) => relation.id),
            }
            const fsIndex = filesystemLocations.findIndex((item) => item.location.id === result.location.id)
            if (fsIndex >= 0) filesystemLocations[fsIndex] = {
              ...filesystemLocations[fsIndex]!,
              state: observation.filesystem.state,
              observation: observation.filesystem,
            }
          } else {
            gitRepositories[index] = {
              ...gitRepositories[index]!,
              state: 'error',
              error: result.error,
            }
            if (services.filesystem !== undefined && fsSelected) {
              try {
                const filesystem = await services.filesystem.inspect(workspaceId, result.location.id)
                const fsIndex = filesystemLocations.findIndex((item) => item.location.id === result.location.id)
                if (fsIndex >= 0) filesystemLocations[fsIndex] = {
                  ...filesystemLocations[fsIndex]!,
                  state: filesystem.state,
                  observation: filesystem,
                }
              } catch (error) {
                filesystemError = describe(error)
              }
            }
          }
        }
      } else if (fsSelected && services.filesystem !== undefined) {
        const start = Date.now()
        const results = await Promise.all(locations.map(async (location) => {
          try {
            return { location, observation: await services.filesystem!.inspect(workspaceId, location.id) }
          } catch (error) {
            return { location, error: describe(error) }
          }
        }))
        filesystemMs += Date.now() - start
        for (const result of results) {
          const index = filesystemLocations.findIndex((item) => item.location.id === result.location.id)
          if (index < 0) continue
          filesystemLocations[index] = 'observation' in result
            ? {
              ...filesystemLocations[index]!,
              state: result.observation.state,
              observation: result.observation,
            }
            : {
              ...filesystemLocations[index]!,
              state: 'error',
              error: result.error,
            }
        }
      }
    }

    if (sessionRelations.length > 0 && services.session !== undefined && sessionSelected) {
      const start = Date.now()
      const observed = await Promise.all(sessionRelations.map(async (relation) => {
        try {
          return {
            relation,
            summary: await services.session!.inspectReference(relation.target, timeoutSignal(timeoutMs)),
          }
        } catch (error) {
          return { relation, error: describe(error) }
        }
      }))
      sessionMs += Date.now() - start
      for (const result of observed) {
        const index = sessionLinks.findIndex((item) => item.relationId === result.relation.id)
        if (index < 0) continue
        sessionLinks[index] = 'summary' in result
          ? {
            ...sessionLinks[index]!,
            state: result.summary.state,
            sourceLabel: result.summary.source.label,
            summary: result.summary,
            ...(result.summary.error === undefined ? {} : { error: result.summary.error }),
          }
          : {
            ...sessionLinks[index]!,
            state: 'unavailable',
            error: result.error,
          }
        const link = sessionLinks[index]!
        if (link.state === 'live' || link.state === 'persisted') {
          addNext(link.actions, command(['session', 'open', link.reference.id]))
        } else {
          addNext(link.actions, command(['session', 'list']))
        }
      }
    }

    if (giteaRepositories.length > 0 && services.gitea !== undefined && giteaSelected) {
      const start = Date.now()
      let instances: readonly GiteaInstance[] = []
      try {
        instances = services.gitea.listInstances()
      } catch (error) {
        giteaError = describe(error)
      }
      const observed = await Promise.all(giteaRepositories.map(async (item) => {
        try {
          return {
            item,
            observation: await services.gitea!.runs(
              item.reference, { limit: 1 }, timeoutSignal(timeoutMs),
            ),
          }
        } catch (error) {
          return { item, error: describe(error) }
        }
      }))
      for (const result of observed) {
        const index = giteaRepositories.findIndex((item) => item.relationId === result.item.relationId)
        if (index < 0) continue
        if ('observation' in result) {
          const observation = result.observation
          const instance = instances.find((value) => value.id === observation.instanceId)
          giteaRepositories[index] = {
            ...giteaRepositories[index]!,
            state: observation.state,
            observedAt: observation.observedAt,
            instanceId: observation.instanceId,
            ...(instance === undefined
              ? {}
              : { instance: { id: instance.id, name: instance.name, baseUrl: instance.baseUrl } }),
            ...(observation.repository === undefined ? {} : { repository: observation.repository }),
            ...(observation.runs[0] === undefined ? {} : { latestRun: observation.runs[0] }),
            actions: observation.state === 'available' || observation.state === 'empty'
              ? giteaRepositories[index]!.actions
              : observation.repository !== undefined &&
                (observation.state === 'actions-disabled' || observation.state === 'unsupported')
                ? [command([
                  'gitea', 'repo', 'inspect', observation.instanceId,
                  observation.repository.fullName,
                ])]
                : [command(['gitea', 'instance', 'verify', observation.instanceId])],
            ...(observation.error === undefined ? {} : { error: observation.error }),
          }
        } else {
          giteaRepositories[index] = {
            ...giteaRepositories[index]!,
            state: 'error',
            error: result.error,
          }
        }
      }

      const localRepositories = gitObservations.filter((observation) =>
        observation.state === 'repository' && observation.remotes !== undefined &&
        observation.remotes.length > 0)
      const candidates: OverviewGiteaSuggestion[] = []
      for (const observation of localRepositories) {
        for (const suggestion of services.gitea.suggest(observation.remotes ?? [])) {
          if (candidates.some((item) =>
            item.locationId === observation.locationId &&
            item.instanceId === suggestion.instanceId &&
            item.fullName === suggestion.fullName)) continue
          candidates.push({
            ...suggestion,
            locationId: observation.locationId,
            locationPath: observation.filesystem.path,
            ...(observation.branch === undefined ? {} : { branch: observation.branch }),
            ...(observation.commit === undefined ? {} : { commit: observation.commit }),
            actions: [command([
              'gitea', 'repo', 'link', workspaceId, suggestion.instanceId, suggestion.fullName,
            ])],
          })
        }
      }
      const confirmed = new Set(giteaRepositories.flatMap((item) =>
        item.repository === undefined
          ? []
          : [`${item.repository.instanceId}:${item.repository.fullName}`]))
      const suggestions = candidates.filter((item) =>
        !confirmed.has(`${item.instanceId}:${item.fullName}`))
      giteaSuggestions = suggestions

      const headObserved = await Promise.all(giteaRepositories.map(async (item) => {
        if (item.repository === undefined) return item
        const matches = candidates.filter((candidate) =>
          candidate.instanceId === item.repository!.instanceId &&
          candidate.fullName === item.repository!.fullName)
        const uniqueLocations = [...new Map(matches.map((candidate) =>
          [candidate.locationId, candidate])).values()]
        if (uniqueLocations.length === 0) {
          const localGitCount = gitObservations.filter((observation) =>
            observation.state === 'repository').length
          return {
            ...item,
            head: withHeadNote({
              state: localGitCount === 0 ? 'no-local-git' as const : 'unmatched' as const,
              runs: [],
            }),
          }
        }
        if (uniqueLocations.length > 1) {
          return {
            ...item,
            head: withHeadNote({
              state: 'ambiguous' as const,
              runs: [],
              error: '多个本地仓库指向同一 Gitea 仓库；未猜测应该使用哪一个 HEAD。',
            }),
          }
        }
        const local = uniqueLocations[0]!
        if (local.commit === null || local.commit === undefined) {
          return {
            ...item,
            head: withHeadNote({
              state: 'no-commit' as const,
              locationId: local.locationId,
              remoteName: local.remoteName,
              runs: [],
              error: '本地仓库尚无提交；无法对应当前 HEAD 的 CI。',
            }),
          }
        }
        if (item.state === 'empty') {
          return {
            ...item,
            head: withHeadNote({
              state: 'matched' as const,
              runsState: 'empty' as const,
              commit: local.commit,
              locationId: local.locationId,
              remoteName: local.remoteName,
              runs: [],
            }),
          }
        }
        try {
          const runs = await services.gitea!.runs(
            item.reference,
            { headSha: local.commit, limit: MAX_HEAD_RUNS },
            timeoutSignal(timeoutMs),
          )
          return {
            ...item,
            head: withHeadNote({
              state: 'matched' as const,
              runsState: runs.state,
              commit: local.commit,
              locationId: local.locationId,
              remoteName: local.remoteName,
              runs: runs.runs,
              ...(runs.error === undefined ? {} : { error: runs.error }),
            }),
          }
        } catch (error) {
          return {
            ...item,
            head: withHeadNote({
              state: 'matched' as const,
              runsState: 'error' as const,
              commit: local.commit,
              locationId: local.locationId,
              remoteName: local.remoteName,
              runs: [],
              error: describe(error),
            }),
          }
        }
      }))
      giteaRepositories = headObserved
      for (const item of giteaRepositories) {
        const firstRun = item.head?.runs[0] ?? item.latestRun
        if (firstRun !== undefined) {
          addNext(item.actions, command([
            'gitea', 'run', 'show', workspaceId, item.relationId, String(firstRun.id),
          ]))
        }
        if ((item.head?.state === 'unmatched' || item.head?.state === 'no-local-git') &&
          gitRepositories[0] !== undefined) {
          addNext(item.actions, command([
            'gitea', 'repo', 'suggest', workspaceId, gitRepositories[0].locationId,
          ]))
        }
      }
      giteaMs += Date.now() - start
    } else if (giteaRepositories.length > 0 && services.gitea === undefined) {
      giteaError = 'Gitea 能力不可用：profile 未加载 locusGitea；已保存关系保留。'
    }

    if (connections.length > 0 && services.connectivity !== undefined && connectivitySelected) {
      const start = Date.now()
      const observed = await Promise.all(connections.map(async (item) => {
        try {
          return {
            item,
            inspection: await services.connectivity!.inspect(item.profile.id, timeoutSignal(timeoutMs)),
          }
        } catch (error) {
          return { item, error: describe(error) }
        }
      }))
      for (const result of observed) {
        const index = connections.findIndex((item) => item.profile.id === result.item.profile.id)
        if (index < 0) continue
        connections[index] = 'inspection' in result
          ? {
            ...connections[index]!,
            state: result.inspection.state,
            inspection: result.inspection,
            ...(result.inspection.error === undefined ? {} : { error: result.inspection.error }),
          }
          : {
            ...connections[index]!,
            state: 'error',
            error: result.error,
          }
        const connection = connections[index]!
        if (connection.state === 'warning' || connection.state === 'error' ||
          connection.state === 'unavailable') {
          addNext(connection.actions, command(['connect', 'verify', connection.profile.id]))
        }
      }
      connectivityMs += Date.now() - start
    }

    await availability
  }

  const gitConfirmed = new Set(gitRepositories.flatMap((item) => item.confirmedRelations))
  const provider = (id: string): OverviewProviderStatus => providerById(providers, id)
  const providerActive = (id: string): boolean => {
    const current = provider(id)
    return current.selected && current.loaded && current.available !== false
  }
  const giteaAccess = new Map<string, {
    state: string
    error?: string
    repositories: string[]
  }>()
  if (providerActive('locus.gitea')) {
    for (const item of giteaRepositories) {
      if (item.state === 'available' || item.state === 'empty' || item.state === 'not-observed') continue
      const key = `${item.state}\u0000${item.error ?? ''}`
      const group = giteaAccess.get(key)
      const repository = item.repository?.fullName ?? item.relationId
      if (group === undefined) {
        giteaAccess.set(key, {
          state: item.state,
          ...(item.error === undefined ? {} : { error: item.error }),
          repositories: [repository],
        })
      } else {
        group.repositories.push(repository)
      }
    }
  }

  const ciAttention: OverviewAttention[] = []
  if (providerActive('locus.gitea')) {
    for (const item of giteaRepositories) {
      const headRuns = item.head?.runs ?? []
      const headFailure = headRuns.find(runProblem)
      const latest = item.latestRun
      if (headFailure !== undefined) {
        ciAttention.push(runAttention(
          'gitea',
          'gitea-ci-problem',
          `Gitea ${item.repository?.fullName ?? item.relationId} 的本地 HEAD Run #${headFailure.runNumber} 为 ${headFailure.outcome}。`,
        ))
      } else if (latest !== undefined && runProblem(latest)) {
        ciAttention.push(runAttention(
          'gitea',
          'gitea-ci-problem',
          `Gitea ${item.repository?.fullName ?? item.relationId} 最近 Run #${latest.runNumber} 为 ${latest.outcome}。`,
        ))
      } else if (latest?.outcome === 'running' || latest?.outcome === 'pending' ||
        headRuns.some((run) => run.outcome === 'running' || run.outcome === 'pending')) {
        ciAttention.push(runAttention(
          'gitea',
          'gitea-ci-active',
          `Gitea ${item.repository?.fullName ?? item.relationId} 有 Run 仍在运行或等待；结果尚未确定。`,
        ))
      }
      if (item.head?.state === 'matched' && item.head.runsState !== undefined &&
        item.head.runsState !== 'available' && item.head.runsState !== 'empty') {
        ciAttention.push(runAttention(
          'gitea',
          'gitea-head-query-problem',
          `Gitea ${item.repository?.fullName ?? item.relationId} 的本地 HEAD Run 查询为 ${item.head.runsState}；这不表示没有 CI。`,
        ))
      }
    }
  }

  const attention: OverviewAttention[] = [
    ...providers
      .filter((provider) => provider.selected && !provider.loaded)
      .map((provider) => runAttention(
        'workspace',
        'capability-provider-missing',
        `${provider.id} 已保存能力选择，但提供方未加载；${provider.error ?? '长期关系保留。'}`,
      )),
    ...providers
      .filter((provider) => provider.selected && provider.loaded && provider.error !== undefined)
      .map((provider) => runAttention(
        'workspace',
        'capability-provider-mismatch',
        `${provider.id} 的提供方状态不一致：${provider.error}`,
      )),
    ...(providerActive('locus.filesystem') ? filesystemLocations
      .filter((item) => item.observation !== undefined && item.observation.state !== 'accessible')
      .map((item) => runAttention(
        'filesystem',
        `filesystem-${item.observation!.state}`,
        `Filesystem 位置 ${item.location.id} (${item.location.path}) 当前为 ${item.observation!.state}${item.observation!.error === undefined ? '' : `：${item.observation!.error}`}。`,
      )) : []),
    ...(filesystemError === undefined || !providerActive('locus.filesystem')
      ? []
      : [runAttention('filesystem', 'filesystem-error', filesystemError)]),
    ...(providerActive('locus.git') ? gitRepositories
      .filter((item) => item.observation !== undefined &&
        (item.observation.state === 'error' || item.observation.state === 'unavailable'))
      .map((item) => runAttention(
        'git',
        `git-${item.observation!.state}`,
        `Git 位置 ${item.locationPath} 当前为 ${item.observation!.state}${item.observation!.error === undefined ? '' : `：${item.observation!.error}`}。`,
      )) : []),
    ...(providerActive('locus.git') ? gitRepositories
      .filter((item) => item.observation?.dirty === true)
      .map((item) => runAttention(
        'git',
        'git-worktree-dirty',
        `Git 仓库 ${item.observation!.root ?? item.locationPath} 有未提交变化。`,
      )) : []),
    ...(observe && providerActive('locus.git')
      ? gitRelations
        .filter((relation) => !gitConfirmed.has(relation.id))
        .map((relation) => runAttention(
          'git',
          'git-confirmed-unobserved',
          `已确认 Git 关联 ${relation.id} 未能在当前 Filesystem 位置中重新观察到。`,
        ))
      : []),
    ...(gitError === undefined || !providerActive('locus.git')
      ? []
      : [runAttention('git', 'git-error', gitError)]),
    ...[...giteaAccess.values()].map((group) => runAttention(
      'gitea',
      `gitea-${group.state}`,
      `Gitea ${group.state}${group.error === undefined ? '' : `：${group.error}`}；涉及 ${group.repositories.length} 个关联${group.repositories.length > 0 ? `（${group.repositories.slice(0, 3).join('、')}${group.repositories.length > 3 ? '…' : ''}）` : ''}。`,
    )),
    ...ciAttention,
    ...(giteaError === undefined || !providerActive('locus.gitea')
      ? []
      : [runAttention('gitea', 'gitea-error', giteaError)]),
    ...(sessionError === undefined || !providerActive('locus.session')
      ? []
      : [runAttention('session', 'session-error', sessionError)]),
    ...(providerActive('locus.remote-machine') ? machineItems
      .filter((item) => item.state === 'unavailable')
      .map((item) => runAttention(
        'machine',
        'machine-unavailable',
        `Machine 关联 ${item.relationId} 当前不可读取${item.error === undefined ? '' : `：${item.error}`}。`,
      )) : []),
    ...(providerActive('locus.connectivity') ? connections
      .filter((item) => item.state === 'error' || item.state === 'unavailable' || item.state === 'warning')
      .map((item) => runAttention(
        'connectivity',
        `connectivity-${item.state}`,
        `Connection Profile ${item.profile.name} 检查为 ${item.state}${item.error === undefined ? '' : `：${item.error}`}。`,
      )) : []),
    ...(connectivityListError === undefined || !providerActive('locus.connectivity')
      ? []
      : [runAttention('connectivity', 'connectivity-error', connectivityListError)]),
  ]

  const filesystemState: OverviewFilesystem['state'] = services.filesystem === undefined && (fsSelected || fsRelations.length > 0)
    ? 'unavailable'
    : locations.length === 0 && fsRelationsView.length === 0
      ? 'empty'
      : observe && fsSelected ? 'observed' : 'configured'
  const gitState: OverviewGit['state'] = services.git === undefined && (gitSelected || gitRelationsView.length > 0)
    ? 'unavailable'
    : locations.length === 0 && gitRelationsView.length === 0
      ? 'empty'
      : observe && gitSelected ? 'observed' : 'not-observed'
  const giteaState: OverviewGitea['state'] = services.gitea === undefined && giteaRepositories.length > 0
    ? 'unavailable'
    : giteaRepositories.length === 0
      ? 'empty'
      : observe && giteaSelected ? 'observed' : 'not-observed'
  const sessionState: OverviewSessions['state'] = services.session === undefined && sessionLinks.length > 0
    ? 'unavailable'
    : sessionLinks.length === 0
      ? 'empty'
      : observe && sessionSelected ? 'observed' : 'not-observed'
  const machineState: OverviewMachines['state'] = services.remoteMachine === undefined && machineItems.length > 0
    ? 'unavailable'
    : machineItems.length === 0
      ? 'empty'
      : 'ready'
  const connectivityState: OverviewConnectivity['state'] = services.connectivity === undefined &&
    machineRelations.length > 0
    ? 'unavailable'
    : connections.length === 0
      ? 'empty'
      : observe && connectivitySelected ? 'observed' : 'not-observed'

  const suggestions = giteaSuggestions
  const next: string[] = []
  addNext(next, command(['workspace', 'show', workspace.id]))
  if (!observe && (locations.length > 0 || relations.length > 0)) {
    addNext(next, command(['workspace', 'overview', workspace.id, '--observe']))
  }
  if (workspace.capabilities.length === 0 || providers.some((item) => item.selected && !item.loaded)) {
    addNext(next, command(['capability', 'list', workspace.id]))
  }
  const capabilityFor = (id: string, name: string, hasRelations: boolean): void => {
    const current = providerById(providers, id)
    if (!hasRelations || current.selected || !current.loaded) return
    addNext(next, command(['capability', 'configure', workspace.id, name]))
  }
  capabilityFor('locus.filesystem', 'filesystem', fsRelations.length > 0)
  capabilityFor('locus.git', 'git', gitRelations.length > 0)
  capabilityFor('locus.gitea', 'gitea', giteaRepositories.length > 0)
  capabilityFor('locus.session', 'session', sessionLinks.length > 0)
  capabilityFor('locus.remote-machine', 'remote-machine', machineItems.length > 0)
  capabilityFor('locus.connectivity', 'connectivity', machineItems.length > 0)
  for (const item of filesystemLocations) for (const action of item.actions) addNext(next, action)
  for (const item of gitRepositories) for (const action of item.actions) addNext(next, action)
  for (const item of giteaRepositories) for (const action of item.actions) addNext(next, action)
  for (const item of suggestions) for (const action of item.actions) addNext(next, action)
  for (const item of sessionLinks) for (const action of item.actions) addNext(next, action)
  for (const item of machineItems) for (const action of item.actions) addNext(next, action)
  for (const item of connections) for (const action of item.actions) addNext(next, action)
  if (locations.length > 0) {
    addNext(next, command(['fs', 'locations', workspace.id]))
    addNext(next, command(['fs', 'inspect', workspace.id, locations[0]!.id]))
  }
  const firstGit = gitRepositories.find((item) => item.state === 'repository')
  if (firstGit !== undefined) {
    addNext(next, command(['git', 'inspect', workspace.id, firstGit.locationId]))
    if (observe && services.gitea !== undefined) {
      addNext(next, command(['gitea', 'repo', 'suggest', workspace.id, firstGit.locationId]))
    }
  }
  if (giteaRepositories.length > 0) {
    const first = giteaRepositories[0]!
    addNext(next, command(['gitea', 'status', workspace.id]))
    if (first.latestRun !== undefined) {
      addNext(next, command(['gitea', 'run', 'show', workspace.id, first.relationId, String(first.latestRun.id)]))
    }
  }
  if (sessionLinks.length > 0) {
    const first = sessionLinks[0]!
    addNext(next, command(['session', 'links', workspace.id]))
    if (first.state === 'live' || first.state === 'persisted') {
      addNext(next, command(['session', 'open', first.reference.id]))
    }
  } else if (providerActive('locus.session') && services.session !== undefined) {
    addNext(next, command(['session', 'list']))
  }
  const firstMachine = machineItems.find((item) => item.machine !== undefined)
  if (firstMachine !== undefined) {
    addNext(next, command(['machine', 'show', firstMachine.machineId]))
    const ssh = firstMachine.machine!.addresses.find((address) => address.kind === 'ssh')
    if (ssh !== undefined) {
      addNext(next, command(['machine', 'observe', firstMachine.machineId, ssh.id]))
    }
  }
  const firstConnection = connections[0]
  if (firstConnection !== undefined) {
    addNext(next, command(['connect', 'inspect', firstConnection.profile.id]))
  }

  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      createdAt: workspace.createdAt,
      capabilities: workspace.capabilities,
    },
    mode: observe ? 'observed' : 'relations',
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    timings: {
      totalMs: Date.now() - started,
      filesystemMs,
      gitMs,
      giteaMs,
      sessionMs,
      connectivityMs,
    },
    providers,
    filesystem: {
      state: filesystemState,
      locations: filesystemLocations,
      relations: fsRelationsView,
      ...(filesystemError === undefined ? {} : { error: filesystemError }),
    },
    git: {
      state: gitState,
      repositories: gitRepositories,
      relations: gitRelationsView,
      ...(gitError === undefined ? {} : { error: gitError }),
    },
    gitea: {
      state: giteaState,
      repositories: giteaRepositories,
      suggestions,
      ...(giteaError === undefined ? {} : { error: giteaError }),
    },
    sessions: {
      state: sessionState,
      links: sessionLinks,
      ...(sessionError === undefined ? {} : { error: sessionError }),
    },
    machines: {
      state: machineState,
      items: machineItems,
      ...(services.remoteMachine === undefined && machineItems.length > 0
        ? { error: 'Remote Machine 能力不可用：profile 未加载 locusRemoteMachine；已保存关系保留。' }
        : {}),
    },
    connectivity: {
      state: connectivityState,
      profiles: connections,
      ...(connectivityListError === undefined ? {} : { error: connectivityListError }),
    },
    otherRelations: otherRelations.map(relationView),
    attention,
    next,
  }
}

