import type { Context } from '@deepseek-ai/cordis'
import {
  type CapabilityDescriptor,
  type GiteaFailureState,
  type GiteaInstance,
  type GiteaInstanceInput,
  type GiteaInstanceUpdate,
  type GiteaRepository,
  type GiteaRepositoryObservation,
  type GiteaRepositorySuggestion,
  type GiteaRun,
  type GiteaRunOutcome,
  type GiteaRunQuery,
  type GiteaService,
  type LocusService,
  type ResourceReference,
  GITEA_REPOSITORY_NAMESPACE,
} from '@locus/contracts'
import { GiteaStore } from './store.ts'

/** 稳定的 Cordis 插件名。 */
export const name = 'locus-gitea'

/** 实例配置来自 Core 数据目录；Workspace 关系仍由 CLI 通过公开 Core 用例保存。 */
export const inject = ['locus']

export const capability: CapabilityDescriptor = Object.freeze({
  id: 'locus.gitea',
  provider: '@locus/gitea',
  tags: Object.freeze(['development', 'collaboration']),
})

export interface GiteaServiceOptions {
  /** 测试/宿主替换 HTTP 传输的窄 seam；默认使用 Node 原生 fetch。 */
  readonly fetch?: typeof fetch
  /** DSH credentials 服务的窄 seam；优先于启动环境解析凭据引用。 */
  readonly credentials?: {
    resolve(reference: string): Promise<{ readonly value: string } | undefined>
  }
  readonly env?: Readonly<Record<string, string | undefined>>
  /** 单次 API 请求时限，默认 10 秒。 */
  readonly timeoutMs?: number
}

class GiteaRequestError extends Error {
  constructor(
    readonly state: GiteaFailureState,
    message: string,
  ) {
    super(message)
  }
}

const API_PREFIX = '/api/v1'
const MAX_BODY_BYTES = 1024 * 1024

function cleanText(value: unknown, field: string, max = 1000, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${field} 缺失或不是字符串`)
  const result = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!allowEmpty && result.length === 0) throw new Error(`${field} 不能为空`)
  return result.slice(0, max)
}

function optionalText(value: unknown, field: string, max = 1000): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return cleanText(value, field, max)
}

function safeUrl(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (url.username !== '' || url.password !== '') return undefined
    return url.href
  } catch {
    return undefined
  }
}

function dateText(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  return Number.isFinite(Date.parse(value)) ? value : undefined
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} 缺失或不是正整数`)
  }
  return value
}

function repositoryFromJson(instanceId: string, value: unknown): GiteaRepository {
  if (typeof value !== 'object' || value === null) throw new Error('Gitea 仓库响应不是对象')
  const data = value as Record<string, unknown>
  const id = positiveInteger(data.id, 'Gitea 仓库 id')
  const fullName = cleanText(data.full_name, 'Gitea 仓库 full_name', 500)
  const parts = fullName.split('/')
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new Error('Gitea 仓库 full_name 必须是 owner/repo')
  }
  const hasActions = data.has_actions === false ? false : true
  if (data.has_actions !== undefined && typeof data.has_actions !== 'boolean') {
    throw new Error('Gitea 仓库 has_actions 不是布尔值')
  }
  const htmlUrl = safeUrl(data.html_url)
  return {
    instanceId,
    id,
    fullName,
    defaultBranch: cleanText(data.default_branch, 'Gitea 仓库 default_branch', 255),
    private: data.private === true,
    archived: data.archived === true,
    hasActions,
    ...(htmlUrl === undefined ? {} : { htmlUrl }),
  }
}

function runOutcome(status: string, conclusion: string | null): GiteaRunOutcome {
  const normalized = status.toLowerCase()
  if (normalized === 'completed') {
    switch (conclusion) {
      case 'success': return 'success'
      case 'failure':
      case 'timed_out':
      case 'startup_failure':
      case 'action_required': return 'failure'
      case 'cancelled': return 'cancelled'
      case 'skipped':
      case 'neutral':
      case 'stale': return 'other'
      default: return 'unknown'
    }
  }
  switch (normalized) {
    case 'success': return 'success'
    case 'failure': return 'failure'
    case 'cancelled': return 'cancelled'
    case 'queued':
    case 'requested':
    case 'waiting':
    case 'pending': return 'pending'
    case 'in_progress':
    case 'running': return 'running'
    default: return 'unknown'
  }
}

function runFromJson(value: unknown): GiteaRun {
  if (typeof value !== 'object' || value === null) throw new Error('Gitea Run 响应不是对象')
  const data = value as Record<string, unknown>
  const id = positiveInteger(data.id, 'Gitea Run id')
  const runNumber = positiveInteger(data.run_number, 'Gitea Run run_number')
  const title = optionalText(data.display_title, 'Gitea Run display_title', 500) ?? ''
  const event = cleanText(data.event, 'Gitea Run event', 100)
  const status = cleanText(data.status, 'Gitea Run status', 100)
  const conclusion = data.conclusion === null || data.conclusion === undefined
    ? null
    : cleanText(data.conclusion, 'Gitea Run conclusion', 100)
  const headSha = cleanText(data.head_sha, 'Gitea Run head_sha', 64).toLowerCase()
  if (!/^[0-9a-f]{7,64}$/.test(headSha)) throw new Error('Gitea Run head_sha 格式无效')
  const headBranch = optionalText(data.head_branch, 'Gitea Run head_branch', 255)
  const workflowId = optionalText(data.workflow_id, 'Gitea Run workflow_id', 255)
  const workflowPath = optionalText(data.path, 'Gitea Run path', 500)
  const htmlUrl = safeUrl(data.html_url)
  const startedAt = dateText(data.started_at)
  const completedAt = dateText(data.completed_at)
  return {
    id,
    runNumber,
    title,
    event,
    status: status.toLowerCase(),
    conclusion: conclusion === null ? null : conclusion.toLowerCase(),
    outcome: runOutcome(status, conclusion === null ? null : conclusion.toLowerCase()),
    headSha,
    ...(headBranch === undefined ? {} : { headBranch }),
    ...(workflowId === undefined ? {} : { workflowId }),
    ...(workflowPath === undefined ? {} : { workflowPath }),
    ...(htmlUrl === undefined ? {} : { htmlUrl }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
  }
}

function parseFullName(fullName: string): { owner: string; repo: string } {
  const normalized = cleanText(fullName, 'Gitea 仓库', 500)
  const parts = normalized.split('/')
  if (parts.length !== 2) throw new Error('Gitea 仓库必须写成 owner/repo')
  const [owner, repo] = parts
  if (owner === undefined || repo === undefined || /[\s\p{Cc}]/u.test(owner) || /[\s\p{Cc}]/u.test(repo)) {
    throw new Error('Gitea 仓库 owner/repo 不能包含空白或控制字符')
  }
  return { owner, repo }
}

function parseReference(reference: ResourceReference): { instanceId: string; repositoryId: number } {
  if (reference.namespace !== GITEA_REPOSITORY_NAMESPACE) {
    throw new Error(`不是 Gitea 仓库引用：${reference.namespace}`)
  }
  const separator = reference.id.indexOf(':')
  if (separator <= 0) throw new Error(`无效 Gitea 仓库引用：${reference.id}`)
  const instanceId = reference.id.slice(0, separator)
  const repositoryId = Number(reference.id.slice(separator + 1))
  if (!Number.isSafeInteger(repositoryId) || repositoryId < 1) {
    throw new Error(`无效 Gitea 仓库 id：${reference.id}`)
  }
  return { instanceId, repositoryId }
}

function normalizeQuery(query: GiteaRunQuery | undefined): URLSearchParams {
  const params = new URLSearchParams()
  const limit = query?.limit ?? 10
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Gitea Run limit 必须是 1–100 的整数')
  }
  params.set('limit', String(limit))
  if (query?.branch !== undefined) {
    params.set('branch', cleanText(query.branch, 'Gitea branch', 255))
  }
  if (query?.headSha !== undefined) {
    const sha = cleanText(query.headSha, 'Gitea head_sha', 64).toLowerCase()
    if (!/^[0-9a-f]{7,64}$/.test(sha)) throw new Error('Gitea head_sha 必须是十六进制提交 SHA')
    params.set('head_sha', sha)
  }
  return params
}

function apiUrl(baseUrl: string, path: string, query?: URLSearchParams): URL {
  const url = new URL(`${baseUrl}${API_PREFIX}${path}`)
  if (query !== undefined) url.search = query.toString()
  return url
}

async function resolveCredential(
  instance: GiteaInstance,
  credentials: GiteaServiceOptions['credentials'],
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | undefined> {
  if (instance.credentialRef === undefined) return undefined
  const name = instance.credentialRef
  if (credentials !== undefined) {
    const resolved = await credentials.resolve(name)
    if (resolved !== undefined && resolved.value.length > 0) return resolved.value
  }
  const value = env[name]
  if (value === undefined || value.trim().length === 0) {
    throw new GiteaRequestError('credential-missing', `Gitea 凭据环境变量 ${name} 未设置`)
  }
  return value
}

function requestFailure(error: unknown): { state: GiteaFailureState; error: string } {
  if (error instanceof GiteaRequestError) return { state: error.state, error: error.message }
  return { state: 'error', error: 'Gitea 请求发生未知错误' }
}

function observationFailure(
  instanceId: string,
  state: GiteaFailureState,
  error: string,
): GiteaRepositoryObservation {
  return { instanceId, state, observedAt: new Date().toISOString(), error }
}

function suggestionFromRemote(
  instance: GiteaInstance,
  remoteName: string,
  remoteUrl: string,
): Omit<GiteaRepositorySuggestion, 'instanceId' | 'instanceName'> | undefined {
  let base: URL
  try {
    base = new URL(instance.baseUrl)
  } catch {
    return undefined
  }
  const basePath = base.pathname.replace(/\/+$/, '')
  let protocol: string
  let hostname: string
  let port: string
  let pathname: string
  let matchedBy: 'http' | 'ssh'
  if (remoteUrl.includes('://')) {
    let remote: URL
    try {
      remote = new URL(remoteUrl)
    } catch {
      return undefined
    }
    if (remote.protocol === 'http:' || remote.protocol === 'https:') {
      if (remote.protocol !== base.protocol || remote.hostname.toLowerCase() !== base.hostname.toLowerCase() ||
        remote.port !== base.port) return undefined
      if (basePath !== '' && !remote.pathname.startsWith(`${basePath}/`)) return undefined
      protocol = remote.protocol
      hostname = remote.hostname
      port = remote.port
      pathname = remote.pathname
      matchedBy = 'http'
    } else if (remote.protocol === 'ssh:' || remote.protocol === 'git+ssh:') {
      if (remote.hostname.toLowerCase() !== base.hostname.toLowerCase()) return undefined
      protocol = remote.protocol
      hostname = remote.hostname
      port = remote.port
      pathname = remote.pathname
      matchedBy = 'ssh'
    } else {
      return undefined
    }
  } else {
    const match = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(remoteUrl)
    if (!match) return undefined
    hostname = match[1] ?? ''
    pathname = match[2] ?? ''
    if (hostname.toLowerCase() !== base.hostname.toLowerCase()) return undefined
    if (basePath !== '') return undefined
    protocol = 'ssh:'
    port = ''
    matchedBy = 'ssh'
  }
  void protocol
  void port
  let path = pathname.replace(/^\/+/, '').replace(/\/+$/, '')
  if (basePath !== '' && matchedBy === 'http') path = path.slice(basePath.replace(/^\/+/, '').length + 1)
  path = path.replace(/\.git$/i, '')
  const parts = path.split('/')
  if (parts.length !== 2) return undefined
  const [owner, repo] = parts
  if (owner === undefined || repo === undefined || owner.length === 0 || repo.length === 0) return undefined
  if (/[\s\p{Cc}]/u.test(owner) || /[\s\p{Cc}]/u.test(repo)) return undefined
  return {
    remoteName,
    remoteUrl,
    fullName: `${owner}/${repo}`,
    matchedBy,
  }
}

export function createGiteaService(
  locus: LocusService,
  options: GiteaServiceOptions = {},
): GiteaService & { dispose(): Promise<void> } {
  const store = new GiteaStore(locus.dataDirectory)
  const fetchImpl = options.fetch ?? fetch
  const credentials = options.credentials
  const env = options.env ?? process.env
  const timeoutMs = options.timeoutMs ?? 10000
  const pending = new Set<Promise<unknown>>()
  let disposed = false
  let disposal: Promise<void> | undefined

  function assertActive(): void {
    if (disposed) throw new Error('Gitea 服务已释放')
  }

  async function run<T>(action: () => Promise<T>): Promise<T> {
    assertActive()
    const operation = action()
    pending.add(operation)
    try {
      return await operation
    } finally {
      pending.delete(operation)
    }
  }

  async function requestJson<T>(
    instance: GiteaInstance,
    path: string,
    query: URLSearchParams | undefined,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const token = await resolveCredential(instance, credentials, env)
    const url = apiUrl(instance.baseUrl, path, query)
    const timeout = AbortSignal.timeout(timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    let response: Response
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...(token === undefined ? {} : { authorization: `token ${token}` }),
        },
        redirect: 'manual',
        signal: combined,
      })
    } catch (error) {
      if (timeout.aborted) throw new GiteaRequestError('timeout', 'Gitea 请求超时')
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GiteaRequestError('error', 'Gitea 请求已中止')
      }
      throw new GiteaRequestError('unreachable', '无法连接 Gitea 实例')
    }
    if (response.status >= 300 && response.status < 400) {
      throw new GiteaRequestError('redirect', 'Gitea 返回重定向；为避免凭据跨源泄露，未跟随')
    }
    if (response.status === 401) throw new GiteaRequestError('unauthorized', 'Gitea 认证失败 (401)')
    if (response.status === 403) throw new GiteaRequestError('forbidden', 'Gitea 拒绝访问 (403)')
    if (response.status === 404) throw new GiteaRequestError('not-found', 'Gitea 资源不存在 (404)')
    if (response.status === 429) throw new GiteaRequestError('rate-limited', 'Gitea 请求被限流 (429)')
    if (response.status < 200 || response.status >= 300) {
      throw new GiteaRequestError('error', `Gitea 请求失败 (${response.status})`)
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('application/json') && !contentType.includes('+json')) {
      throw new GiteaRequestError('invalid-response', 'Gitea 返回非 JSON 响应')
    }
    const length = Number(response.headers.get('content-length'))
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
      throw new GiteaRequestError('invalid-response', 'Gitea 响应超过 1 MiB 上限')
    }
    let body: string
    try {
      body = await response.text()
    } catch {
      throw new GiteaRequestError('invalid-response', '无法读取 Gitea 响应')
    }
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      throw new GiteaRequestError('invalid-response', 'Gitea 响应超过 1 MiB 上限')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      throw new GiteaRequestError('invalid-response', 'Gitea 返回无效 JSON')
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new GiteaRequestError('invalid-response', 'Gitea 返回的 JSON 不是对象')
    }
    return parsed as T
  }

  async function repositoryByPath(
    instance: GiteaInstance,
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<GiteaRepositoryObservation> {
    try {
      const raw = await requestJson<unknown>(instance, path, undefined, signal)
      const repository = repositoryFromJson(instance.id, raw)
      return {
        instanceId: instance.id,
        state: 'available',
        observedAt: new Date().toISOString(),
        repository,
      }
    } catch (error) {
      const failure = requestFailure(error)
      return observationFailure(instance.id, failure.state, failure.error)
    }
  }

  async function inspectByReference(
    reference: ResourceReference,
    signal: AbortSignal | undefined,
  ): Promise<GiteaRepositoryObservation> {
    const { instanceId, repositoryId } = parseReference(reference)
    let instance: GiteaInstance
    try {
      instance = store.get(instanceId)
    } catch {
      return observationFailure(instanceId, 'instance-missing', 'Gitea 实例未登记或已删除')
    }
    return repositoryByPath(instance, `/repositories/${repositoryId}`, signal)
  }

  const service: GiteaService & { dispose(): Promise<void> } = {
    capability,
    availability() {
      return Promise.resolve(fetchImpl === undefined
        ? { available: false, error: '当前运行时没有 fetch。' }
        : { available: true })
    },
    listInstances() {
      assertActive()
      return store.list()
    },
    getInstance(instanceId) {
      assertActive()
      return store.get(instanceId)
    },
    addInstance(input: GiteaInstanceInput) {
      assertActive()
      return store.add(input)
    },
    updateInstance(instanceId: string, changes: GiteaInstanceUpdate) {
      assertActive()
      return store.update(instanceId, changes)
    },
    removeInstance(instanceId: string) {
      assertActive()
      store.remove(instanceId)
    },
    verifyInstance(instanceId, signal) {
      return run(async () => {
        const observedAt = () => new Date().toISOString()
        let instance: GiteaInstance
        try {
          instance = store.get(instanceId)
        } catch {
          return {
            instanceId,
            state: 'instance-missing',
            observedAt: observedAt(),
            authenticated: false,
            error: 'Gitea 实例未登记或已删除',
          }
        }
        try {
          const version = await requestJson<Record<string, unknown>>(
            instance, '/version', undefined, signal,
          )
          const versionText = optionalText(version.version, 'Gitea version', 100)
          if (versionText === undefined) throw new GiteaRequestError('invalid-response', 'Gitea version 缺失')
          if (instance.credentialRef === undefined) {
            return {
              instanceId: instance.id,
              state: 'ok',
              observedAt: observedAt(),
              version: versionText,
              authenticated: false,
            }
          }
          const user = await requestJson<Record<string, unknown>>(instance, '/user', undefined, signal)
          const login = cleanText(user.login, 'Gitea 用户 login', 100)
          return {
            instanceId: instance.id,
            state: 'ok',
            observedAt: observedAt(),
            version: versionText,
            authenticated: true,
            login,
          }
        } catch (error) {
          const failure = requestFailure(error)
          return {
            instanceId: instance.id,
            state: failure.state === 'not-found' ? 'unsupported' : failure.state,
            observedAt: observedAt(),
            authenticated: false,
            error: failure.error,
          }
        }
      })
    },
    inspectRepository(instanceId, fullName, signal) {
      return run(async () => {
        let instance: GiteaInstance
        try {
          instance = store.get(instanceId)
        } catch {
          return observationFailure(instanceId, 'instance-missing', 'Gitea 实例未登记或已删除')
        }
        const { owner, repo } = parseFullName(fullName)
        return repositoryByPath(
          instance,
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
          signal,
        )
      })
    },
    inspectReference(reference, signal) {
      return run(() => inspectByReference(reference, signal))
    },
    reference(instanceId, repositoryId) {
      assertActive()
      if (typeof instanceId !== 'string' || instanceId.trim().length === 0) {
        throw new Error('Gitea 实例 id 必须是非空字符串')
      }
      if (!Number.isSafeInteger(repositoryId) || repositoryId < 1) {
        throw new Error('Gitea 仓库 id 必须是正整数')
      }
      return {
        namespace: GITEA_REPOSITORY_NAMESPACE,
        id: `${instanceId}:${repositoryId}`,
      }
    },
    runs(reference, query, signal) {
      return run(async () => {
        const { instanceId, repositoryId } = parseReference(reference)
        const observedAt = () => new Date().toISOString()
        const repository = await inspectByReference(reference, signal)
        if (repository.state !== 'available' || repository.repository === undefined) {
          return {
            instanceId,
            repositoryId,
            state: repository.state,
            observedAt: observedAt(),
            runs: [],
            ...(repository.error === undefined ? {} : { error: repository.error }),
          }
        }
        if (!repository.repository.hasActions) {
          return {
            instanceId,
            repositoryId,
            state: 'actions-disabled',
            observedAt: observedAt(),
            repository: repository.repository,
            runs: [],
            error: '仓库可访问，但 Gitea Actions 未启用。',
          }
        }
        const { owner, repo } = parseFullName(repository.repository.fullName)
        const params = normalizeQuery(query)
        const limit = query?.limit ?? 10
        try {
          const raw = await requestJson<Record<string, unknown>>(
            store.get(instanceId),
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs`,
            params,
            signal,
          )
          const values = raw.workflow_runs
          if (!Array.isArray(values)) throw new GiteaRequestError('invalid-response', 'Gitea Run 列表缺失')
          // Gitea 1.25 的 Actions 列表端点不保证遵守 limit；客户端仍必须保持有界。
          const runs = values.map(runFromJson).slice(0, limit)
          const total = raw.total_count
          const totalCount = typeof total === 'number' && Number.isSafeInteger(total) && total >= 0
            ? total
            : undefined
          return {
            instanceId,
            repositoryId,
            state: runs.length === 0 ? 'empty' : 'available',
            observedAt: observedAt(),
            repository: repository.repository,
            ...(totalCount === undefined ? {} : { totalCount }),
            runs,
          }
        } catch (error) {
          const failure = requestFailure(error)
          return {
            instanceId,
            repositoryId,
            state: failure.state === 'not-found' ? 'unsupported' : failure.state,
            observedAt: observedAt(),
            repository: repository.repository,
            runs: [],
            error: failure.state === 'not-found'
              ? '仓库可访问，但 Actions API 返回 404；可能未启用 Actions 或该 Gitea 版本不支持。'
              : failure.error,
          }
        }
      })
    },
    run(reference, runId, signal) {
      return run(async () => {
        const { instanceId, repositoryId } = parseReference(reference)
        const observedAt = () => new Date().toISOString()
        if (!Number.isSafeInteger(runId) || runId < 1) throw new Error('Gitea Run id 必须是正整数')
        const repository = await inspectByReference(reference, signal)
        if (repository.state !== 'available' || repository.repository === undefined) {
          return {
            instanceId,
            repositoryId,
            state: repository.state,
            observedAt: observedAt(),
            ...(repository.error === undefined ? {} : { error: repository.error }),
          }
        }
        const { owner, repo } = parseFullName(repository.repository.fullName)
        try {
          const raw = await requestJson<unknown>(
            store.get(instanceId),
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}`,
            undefined,
            signal,
          )
          return {
            instanceId,
            repositoryId,
            state: 'available',
            observedAt: observedAt(),
            repository: repository.repository,
            run: runFromJson(raw),
          }
        } catch (error) {
          const failure = requestFailure(error)
          return {
            instanceId,
            repositoryId,
            state: failure.state,
            observedAt: observedAt(),
            repository: repository.repository,
            error: failure.error,
          }
        }
      })
    },
    suggest(remotes) {
      assertActive()
      const instances = store.list()
      const result: GiteaRepositorySuggestion[] = []
      for (const instance of instances) {
        for (const remote of remotes) {
          const candidate = suggestionFromRemote(instance, remote.name, remote.url)
          if (candidate === undefined) continue
          result.push({
            ...candidate,
            instanceId: instance.id,
            instanceName: instance.name,
          })
        }
      }
      return result
    },
    dispose() {
      if (!disposal) {
        disposed = true
        disposal = Promise.allSettled(pending).then(() => store.dispose())
      }
      return disposal
    },
  }
  return service
}

/** 在当前 DSH fiber 提供 Gitea 只读观察；卸载不删除 Workspace 关系或实例配置。 */
export function apply(ctx: Context): void {
  const credentials = ctx.get('credentials') as GiteaServiceOptions['credentials']
  const service = createGiteaService(
    ctx.get('locus') as LocusService,
    credentials === undefined ? {} : { credentials },
  )
  ctx.provide('locusGitea', service)
  ctx.effect(() => () => service.dispose())
}
