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
  error?: string
}

export interface OverviewGiteaRepository {
  readonly relationId: string
  readonly reference: WorkspaceRelation['target']
  state: 'not-observed' | 'unavailable' | GiteaRunListObservation['state']
  observedAt?: string
  instance?: { readonly id: string; readonly name: string; readonly baseUrl: string }
  repository?: GiteaRepository
  latestRun?: GiteaRun
  head?: OverviewGiteaHead
  error?: string
}

export interface OverviewGiteaSuggestion extends GiteaRepositorySuggestion {
  readonly locationId: string
  readonly locationPath: string
  readonly branch?: string | null
  readonly commit?: string | null
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

function headProblem(head: OverviewGiteaHead): boolean {
  return head.state === 'unmatched' || head.state === 'ambiguous' || head.state === 'no-commit' ||
    (head.runsState !== undefined && head.runsState !== 'available') ||
    head.runs.some(runProblem)
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
      }
    } catch (error) {
      return {
        relationId: relation.id,
        machineId: relation.target.id,
        state: 'unavailable',
        profileCount: profileCount(relation.target.id),
        error: describe(error),
      }
    }
  })

  const connections: OverviewConnection[] = (profileList ?? [])
    .filter((profile) => machineRelations.some((relation) => relation.target.id === profile.machineId))
    .map((profile) => {
      const relation = machineRelations.find((item) => item.target.id === profile.machineId)
      return {
        ...(relation === undefined ? {} : { machineRelationId: relation.id }),
        profile: profileView(profile),
        state: 'not-observed',
      }
    })

  const fsRelationsView = fsRelations.map(relationView)
  const gitRelationsView = gitRelations.map(relationView)
  const sessionLinks: OverviewSessionLink[] = sessionRelations.map((relation) => ({
    relationId: relation.id,
    reference: relation.target,
    sourceId: relation.target.namespace.slice(SESSION_NAMESPACE_PREFIX.length),
    state: 'not-observed',
  }))
  let giteaRepositories: OverviewGiteaRepository[] = giteaRelations.map((relation) => ({
    relationId: relation.id,
    reference: relation.target,
    state: services.gitea === undefined ? 'unavailable' : 'not-observed',
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
    }))
    : []
  const filesystemLocations: OverviewFilesystemLocation[] = locations.map((location) => ({
    location,
    state: 'not-observed',
    confirmedRelations: fsRelations
      .filter((relation) => sameReference(relation.target, location.reference))
      .map((relation) => relation.id),
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

    if (sessionRelations.length > 0 && services.session !== undefined) {
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
      }
    }

    if (giteaRepositories.length > 0 && services.gitea !== undefined) {
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
            ...(instance === undefined
              ? {}
              : { instance: { id: instance.id, name: instance.name, baseUrl: instance.baseUrl } }),
            ...(observation.repository === undefined ? {} : { repository: observation.repository }),
            ...(observation.runs[0] === undefined ? {} : { latestRun: observation.runs[0] }),
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
            head: {
              state: localGitCount === 0 ? 'no-local-git' as const : 'unmatched' as const,
              runs: [],
            },
          }
        }
        if (uniqueLocations.length > 1) {
          return {
            ...item,
            head: {
              state: 'ambiguous' as const,
              runs: [],
              error: '多个本地仓库指向同一 Gitea 仓库；未猜测应该使用哪一个 HEAD。',
            },
          }
        }
        const local = uniqueLocations[0]!
        if (local.commit === null || local.commit === undefined) {
          return {
            ...item,
            head: {
              state: 'no-commit' as const,
              locationId: local.locationId,
              remoteName: local.remoteName,
              runs: [],
              error: '本地仓库尚无提交；无法对应当前 HEAD 的 CI。',
            },
          }
        }
        if (item.state === 'empty') {
          return {
            ...item,
            head: {
              state: 'matched' as const,
              runsState: 'empty' as const,
              commit: local.commit,
              locationId: local.locationId,
              remoteName: local.remoteName,
              runs: [],
            },
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
            head: {
              state: 'matched' as const,
              runsState: runs.state,
              commit: local.commit,
              locationId: local.locationId,
              remoteName: local.remoteName,
              runs: runs.runs,
              ...(runs.error === undefined ? {} : { error: runs.error }),
            },
          }
        } catch (error) {
          return {
            ...item,
            head: {
              state: 'matched' as const,
              runsState: 'error' as const,
              commit: local.commit,
              locationId: local.locationId,
              remoteName: local.remoteName,
              runs: [],
              error: describe(error),
            },
          }
        }
      }))
      giteaRepositories = headObserved
      giteaMs += Date.now() - start
    } else if (giteaRepositories.length > 0 && services.gitea === undefined) {
      giteaError = 'Gitea 能力不可用：profile 未加载 locusGitea；已保存关系保留。'
    }

    if (connections.length > 0 && services.connectivity !== undefined) {
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
      }
      connectivityMs += Date.now() - start
    }

    await availability
  }

  const gitConfirmed = new Set(gitRepositories.flatMap((item) => item.confirmedRelations))
  const suggestions = giteaSuggestions

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
    ...filesystemLocations
      .filter((item) => item.observation !== undefined && item.observation.state !== 'accessible')
      .map((item) => runAttention(
        'filesystem',
        `filesystem-${item.observation!.state}`,
        `Filesystem 位置 ${item.location.id} (${item.location.path}) 当前为 ${item.observation!.state}${item.observation!.error === undefined ? '' : `：${item.observation!.error}`}。`,
      )),
    ...(filesystemError === undefined
      ? []
      : [runAttention('filesystem', 'filesystem-error', filesystemError)]),
    ...gitRepositories
      .filter((item) => item.observation !== undefined &&
        (item.observation.state === 'error' || item.observation.state === 'unavailable'))
      .map((item) => runAttention(
        'git',
        `git-${item.observation!.state}`,
        `Git 位置 ${item.locationPath} 当前为 ${item.observation!.state}${item.observation!.error === undefined ? '' : `：${item.observation!.error}`}。`,
      )),
    ...gitRepositories
      .filter((item) => item.observation?.dirty === true)
      .map((item) => runAttention(
        'git',
        'git-worktree-dirty',
        `Git 仓库 ${item.observation!.root ?? item.locationPath} 有未提交变化。`,
      )),
    ...(observe
      ? gitRelations
        .filter((relation) => !gitConfirmed.has(relation.id))
        .map((relation) => runAttention(
          'git',
          'git-confirmed-unobserved',
          `已确认 Git 关联 ${relation.id} 未能在当前 Filesystem 位置中重新观察到。`,
        ))
      : []),
    ...(gitError === undefined ? [] : [runAttention('git', 'git-error', gitError)]),
    ...giteaRepositories
      .filter((item) => item.state !== 'available' && item.state !== 'empty' &&
        item.state !== 'not-observed')
      .map((item) => runAttention(
        'gitea',
        `gitea-${item.state}`,
        `Gitea 仓库关联 ${item.relationId} 当前为 ${item.state}${item.error === undefined ? '' : `：${item.error}`}。`,
      )),
    ...giteaRepositories
      .filter((item) => item.latestRun !== undefined && runProblem(item.latestRun))
      .map((item) => runAttention(
        'gitea',
        'gitea-ci-problem',
        `Gitea ${item.repository?.fullName ?? item.relationId} 最近 Run #${item.latestRun!.runNumber} 为 ${item.latestRun!.outcome}。`,
      )),
    ...giteaRepositories
      .filter((item) => item.latestRun !== undefined &&
        (item.latestRun.outcome === 'running' || item.latestRun.outcome === 'pending'))
      .map((item) => runAttention(
        'gitea',
        'gitea-ci-active',
        `Gitea ${item.repository?.fullName ?? item.relationId} 最近 Run #${item.latestRun!.runNumber} 为 ${item.latestRun!.outcome}；结果尚未确定。`,
      )),
    ...giteaRepositories
      .filter((item) => item.head !== undefined && headProblem(item.head))
      .map((item) => runAttention(
        'gitea',
        'gitea-head-ci-problem',
        `Gitea ${item.repository?.fullName ?? item.relationId} 的本地 HEAD 对应状态为 ${item.head!.state}${item.head!.runsState === undefined ? '' : `/${item.head!.runsState}`}${item.head!.error === undefined ? '' : `：${item.head!.error}`}。`,
      )),
    ...(giteaError === undefined ? [] : [runAttention('gitea', 'gitea-error', giteaError)]),
    ...(suggestions.length === 0
      ? []
      : [runAttention(
        'gitea',
        'gitea-unconfirmed-suggestion',
        `发现 ${suggestions.length} 个 Git Remote → Gitea 候选；尚未确认，未自动写入长期关系。`,
      )]),
    ...sessionLinks
      .filter((item) => item.state === 'unavailable')
      .map((item) => runAttention(
        'session',
        'session-unavailable',
        `Session 关联 ${item.relationId} 当前不可访问${item.error === undefined ? '' : `：${item.error}`}。`,
      )),
    ...(sessionError === undefined ? [] : [runAttention('session', 'session-error', sessionError)]),
    ...machineItems
      .filter((item) => item.state === 'unavailable')
      .map((item) => runAttention(
        'machine',
        'machine-unavailable',
        `Machine 关联 ${item.relationId} 当前不可读取${item.error === undefined ? '' : `：${item.error}`}。`,
      )),
    ...machineItems
      .filter((item) => item.machine !== undefined && item.machine.addresses.some((address) => address.kind === 'ssh') &&
        item.profileCount === 0)
      .map((item) => runAttention(
        'connectivity',
        'machine-without-profile',
        `Machine ${item.machine!.name} 有 SSH 地址，但没有 Connection Profile；配置入口不表示连接成功。`,
      )),
    ...connections
      .filter((item) => item.state === 'error' || item.state === 'unavailable' || item.state === 'warning')
      .map((item) => runAttention(
        'connectivity',
        `connectivity-${item.state}`,
        `Connection Profile ${item.profile.name} 检查为 ${item.state}${item.error === undefined ? '' : `：${item.error}`}。`,
      )),
    ...(connectivityListError === undefined
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
      : observe ? 'observed' : 'not-observed'
  const sessionState: OverviewSessions['state'] = services.session === undefined && sessionLinks.length > 0
    ? 'unavailable'
    : sessionLinks.length === 0
      ? 'empty'
      : observe ? 'observed' : 'not-observed'
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
      : observe ? 'observed' : 'not-observed'

  const next: string[] = []
  addNext(next, command(['workspace', 'show', workspace.id]))
  if (!observe && (locations.length > 0 || relations.length > 0)) {
    addNext(next, command(['workspace', 'overview', workspace.id, '--observe']))
  }
  if (workspace.capabilities.length === 0) {
    addNext(next, command(['capability', 'list', workspace.id]))
  }
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

function providerText(provider: OverviewProviderStatus): string {
  const available = provider.available === null
    ? '未检查'
    : provider.available ? '是' : '否'
  return `${provider.id.replace(/^locus\./, '')}=选择${provider.selected ? '是' : '否'}/加载${provider.loaded ? '是' : '否'}/可用${available}`
}

function observationLine(prefix: string, value: FilesystemObservation): string {
  return `${prefix}${value.state} ${value.kind}${value.error === undefined ? '' : ` (${value.error})`}`
}

function gitLine(item: OverviewGitRepository): string {
  if (item.observation === undefined) return `${item.locationPath}  [未观察]`
  const value = item.observation
  if (value.state !== 'repository') {
    return `${item.locationPath}  ${value.state}${value.error === undefined ? '' : ` (${value.error})`}  [本次观察]`
  }
  return `${value.root ?? item.locationPath}  ${value.branch ?? 'detached HEAD'}  ${value.commit === null || value.commit === undefined ? '尚无提交' : value.commit.slice(0, 12)}  ${value.dirty ? '工作树有变化' : '工作树干净'}  [本次观察]`
}

function runLine(value: GiteaRun): string {
  return `#${value.runNumber} ${value.outcome} ${value.status}/${value.conclusion ?? '-'} ${value.headSha.slice(0, 12)}`
}

function giteaHeadLine(head: OverviewGiteaHead): string {
  const state = head.runsState === undefined ? head.state : `${head.state}/${head.runsState}`
  return `本地 HEAD ${head.commit === undefined ? '-' : head.commit.slice(0, 12)} -> ${state}${head.runs.length === 0 ? '' : `：${head.runs.map(runLine).join('；')}`}${head.error === undefined ? '' : ` (${head.error})`}`
}

export function overviewText(value: WorkspaceOverview): string {
  const lines: string[] = [
    `Workspace: ${value.workspace.name}`,
    `Identity: ${value.workspace.id}`,
    `创建时间: ${value.workspace.createdAt}`,
    `能力选择: ${value.workspace.capabilities.map((item) => `${item.id} (${item.provider})`).join(', ') || '无'}`,
    `提供方: ${value.providers.map(providerText).join('；')}`,
    `模式: ${value.mode === 'observed' ? '本次实时观察' : '长期关系与本地配置，未执行实时观察'}`,
    `耗时: ${value.durationMs}ms${value.mode === 'observed' ? '（各段只读查询可重叠）' : ''}`,
  ]

  const hasContent = (providerId: string, count: number): boolean =>
    count > 0 || value.providers.some((provider) => provider.id === providerId && provider.selected)

  if (hasContent('locus.filesystem', value.filesystem.locations.length + value.filesystem.relations.length)) {
    lines.push('', `Filesystem [${value.filesystem.state}]`)
    for (const relation of value.filesystem.relations) {
      lines.push(`  关联 ${relation.relationId}  ${relation.reference.id}  [已确认]`)
    }
    for (const item of value.filesystem.locations) {
      lines.push(`  位置 ${item.location.id}  ${item.location.path}  [配置]`)
      if (item.observation !== undefined) lines.push(`    ${observationLine('', item.observation)}  [本次观察]`)
      else lines.push('    未观察')
      for (const relationId of item.confirmedRelations) {
        lines.push(`    已确认关系 ${relationId}`)
      }
      if (item.error !== undefined) lines.push(`    错误: ${item.error}`)
    }
    if (value.filesystem.error !== undefined) lines.push(`  错误: ${value.filesystem.error}`)
  }

  if (hasContent('locus.git', value.git.repositories.length + value.git.relations.length)) {
    lines.push('', `Git [${value.git.state}]`)
    for (const relation of value.git.relations) {
      lines.push(`  关联 ${relation.relationId}  ${relation.reference.id}  [已确认]`)
    }
    for (const item of value.git.repositories) {
      lines.push(`  位置 ${item.locationId}  ${gitLine(item)}`)
      for (const relationId of item.confirmedRelations) {
        lines.push(`    已确认关系 ${relationId}`)
      }
    }
    if (value.git.error !== undefined) lines.push(`  错误: ${value.git.error}`)
  }

  if (hasContent('locus.gitea', value.gitea.repositories.length)) {
    lines.push('', `Gitea [${value.gitea.state}]`)
    for (const item of value.gitea.repositories) {
      lines.push(`  关联 ${item.relationId}  ${item.reference.id}  [已确认]`)
      if (item.repository !== undefined) {
        lines.push(`    仓库 ${item.repository.fullName}  ${item.instance?.name ?? item.repository.instanceId}  ${item.state}  [本次观察]`)
        if (item.latestRun !== undefined) lines.push(`    最近 Run ${runLine(item.latestRun)}`)
        if (item.head !== undefined) lines.push(`    ${giteaHeadLine(item.head)}`)
      } else {
        lines.push(`    未观察${item.error === undefined ? '' : ` (${item.error})`}`)
      }
    }
    if (value.gitea.error !== undefined) lines.push(`  错误: ${value.gitea.error}`)
  }

  if (hasContent('locus.session', value.sessions.links.length)) {
    lines.push('', `Session [${value.sessions.state}]`)
    for (const item of value.sessions.links) {
      const summary = item.summary
      const detail = summary === undefined
        ? '未观察'
        : `${summary.state}  ${summary.live ? 'live' : ''}${summary.live && summary.persisted ? '/' : ''}${summary.persisted ? 'persisted' : ''}${summary.title === undefined ? '' : `  ${summary.title}`}`
      lines.push(`  关联 ${item.relationId}  ${item.reference.id}  来源 ${item.sourceLabel ?? item.sourceId}  [已确认]  ${detail}`)
      if (item.error !== undefined) lines.push(`    ${item.error}`)
    }
    if (value.sessions.error !== undefined) lines.push(`  错误: ${value.sessions.error}`)
  }

  if (hasContent('locus.remote-machine', value.machines.items.length)) {
    lines.push('', `Remote Machine [${value.machines.state}]`)
    for (const item of value.machines.items) {
      if (item.machine === undefined) {
        lines.push(`  关联 ${item.relationId}  ${item.machineId}  unavailable${item.error === undefined ? '' : ` (${item.error})`}`)
        continue
      }
      const addresses = item.machine.addresses.map((address) =>
        `${address.kind}:${address.value}${address.port === undefined ? '' : `:${address.port}`}`).join(', ')
      lines.push(`  关联 ${item.relationId}  ${item.machine.name} (${item.machine.id})  ${addresses || '无地址'}  Profile=${item.profileCount ?? '未检查'}`)
    }
    if (value.machines.error !== undefined) lines.push(`  错误: ${value.machines.error}`)
  }

  if (hasContent('locus.connectivity', value.connectivity.profiles.length)) {
    lines.push('', `Connectivity [${value.connectivity.state}]`)
    for (const item of value.connectivity.profiles) {
      const profile = item.profile
      const target = `${profile.target}${profile.port === undefined ? '' : `:${profile.port}`}`
      const detail = item.inspection === undefined
        ? '未检查'
        : `${item.inspection.state}${item.inspection.resolved === undefined ? '' : `  有效目标 ${item.inspection.resolved.hostname}:${item.inspection.resolved.port}`}`
      lines.push(`  Profile ${profile.id}  ${profile.name}  ${profile.transport}  ${target}  [配置]  ${detail}`)
      if (item.error !== undefined) lines.push(`    ${item.error}`)
    }
    if (value.connectivity.error !== undefined) lines.push(`  错误: ${value.connectivity.error}`)
  }

  if (value.gitea.suggestions.length > 0) {
    lines.push('', '建议（未确认）')
    for (const item of value.gitea.suggestions) {
      lines.push(`  ${item.remoteName}  ${item.remoteUrl}  ->  ${item.instanceName}  ${item.fullName}  [${item.matchedBy}]  位置 ${item.locationId}`)
    }
  }

  if (value.otherRelations.length > 0) {
    lines.push('', '其他长期关系')
    for (const relation of value.otherRelations) {
      lines.push(`  ${relation.relationId}  ${relation.kind}  ${relation.reference.namespace}  ${relation.reference.id}  [已确认]`)
    }
  }

  if (value.attention.length > 0) {
    lines.push('', '需要注意')
    for (const item of value.attention) lines.push(`  - [${item.domain}] ${item.message}`)
  }

  if (value.next.length > 0) {
    lines.push('', '继续操作')
    for (const item of value.next) lines.push(`  ${item}`)
  }

  lines.push('', '说明: 已确认关系来自 Core；[本次观察] 只代表本次查询；[建议] 尚未写入关系。CI 成功不代表部署成功，Connection Profile 配置不代表连接成功，Session persisted 不代表 Agent 当前正在工作。')
  return lines.join('\n')
}
