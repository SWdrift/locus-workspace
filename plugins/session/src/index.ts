import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionQueryEngine, SessionRecord, SessionTitleObservation } from '@deepseek-ai/dsh-session-query'
import {
  SESSION_NAMESPACE_PREFIX,
  type CapabilityDescriptor,
  type ResourceReference,
  type SessionService,
  type SessionSource,
  type SessionSummary,
} from '@locus/contracts'

/** 稳定的 Cordis 插件名。 */
export const name = 'locus-session'

/** Session 查询由 DSH 提供；Locus 只消费其公开服务。 */
export const inject = ['locus']

/** 提供方声明；Tag 只用于分类，不代表权限或当前可达性。 */
export const capability: CapabilityDescriptor = Object.freeze({
  id: 'locus.session',
  provider: '@locus/session',
  tags: Object.freeze(['history']),
})

type SessionQuery = Pick<SessionQueryEngine, 'listSessions' | 'filterSessions' | 'readTitleSnapshot'>

export interface SessionServiceOptions {
  readonly query?: () => SessionQuery | undefined
  readonly source?: { readonly home: string; readonly label: string }
}

function normalizedHome(home: string): string {
  const absolute = resolve(home)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

function makeSource(home: string, label: string): SessionSource {
  return Object.freeze({
    id: createHash('sha256').update(normalizedHome(home)).digest('hex').slice(0, 16),
    label: label.trim() || 'dsh',
  })
}

function requireSessionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Session id 必须是非空字符串')
  }
  if (value.includes('\0')) {
    throw new Error('Session id 不能包含 NUL 字符')
  }
}

function describeError(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  const detail = error instanceof Error ? error.message : String(error)
  return typeof code === 'string' ? `${code}: ${detail}` : detail
}

function isoTime(value: number): string | undefined {
  if (!Number.isFinite(value)) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function summaryFromRecord(
  reference: ResourceReference,
  source: SessionSource,
  record: SessionRecord,
  title: string | undefined,
  error: string | undefined,
): SessionSummary {
  const header: SessionHeader = record.header
  const state: SessionSummary['state'] = record.live
    ? 'live'
    : record.persisted
      ? 'persisted'
      : 'unavailable'
  const createdAt = isoTime(header.createdAt)
  return {
    reference,
    sessionId: header.id,
    source,
    state,
    live: record.live,
    persisted: record.persisted,
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
    ...(header.parentSession === undefined ? {} : { parentSessionId: header.parentSession }),
    ...(header.origin === undefined ? {} : { origin: header.origin }),
    ...(header.agentPreset === undefined ? {} : { agentPreset: header.agentPreset }),
    isSeeded: header.isSeeded,
    ...(record.formatStatus === undefined ? {} : { formatStatus: record.formatStatus }),
    ...(title === undefined ? {} : { title }),
    ...(error === undefined ? {} : { error }),
  }
}

function unavailableSummary(
  reference: ResourceReference,
  source: SessionSource,
  error: string,
): SessionSummary {
  return {
    reference,
    sessionId: reference.id,
    source,
    state: 'unavailable',
    live: false,
    persisted: false,
    error,
  }
}

/** 创建只读的 DSH Session 用例；不保存 Session 事实，也不读取完整 Transcript。 */
export function createSessionService(options: SessionServiceOptions = {}): SessionService {
  const profile = options.source
  const source = makeSource(
    profile?.home ?? process.env.DSH_HOME ?? resolve(homedir(), '.dsh'),
    profile?.label ?? 'dsh',
  )
  const currentNamespace = `${SESSION_NAMESPACE_PREFIX}${source.id}`

  const query = (): SessionQuery | undefined => options.query?.()

  const reference = (sessionId: string): ResourceReference => {
    requireSessionId(sessionId)
    return { namespace: currentNamespace, id: sessionId }
  }

  const inspectReference = async (
    input: ResourceReference,
    signal?: AbortSignal,
  ): Promise<SessionSummary> => {
    if (input === null || typeof input !== 'object') {
      throw new Error('Session 引用必须包含 namespace 和 id')
    }
    if (typeof input.namespace !== 'string' || !input.namespace.startsWith(SESSION_NAMESPACE_PREFIX)) {
      throw new Error(`不是 Session 引用：${String(input.namespace)}`)
    }
    requireSessionId(input.id)
    const sourceId = input.namespace.slice(SESSION_NAMESPACE_PREFIX.length)
    if (sourceId !== source.id) {
      return unavailableSummary(
        input,
        { id: sourceId, label: '其他来源' },
        '这个 Session 关联来自其他 DSH 数据目录；当前 Locus 无法读取其原生元信息，关联仍保留。',
      )
    }
    return inspect(input.id, signal)
  }

  const inspect = async (sessionId: string, signal?: AbortSignal): Promise<SessionSummary> => {
    const ref = reference(sessionId)
    const activeQuery = query()
    if (!activeQuery) {
      return unavailableSummary(ref, source, 'Session 查询服务未加载：当前 profile 未提供 ctx.sessionQuery；Workspace 关联保留。')
    }

    let records: readonly SessionRecord[]
    try {
      records = await activeQuery.filterSessions([{ kind: 'id', values: [sessionId as SessionId] }], signal)
    } catch (error) {
      return unavailableSummary(ref, source, `无法查询 DSH Session：${describeError(error)}`)
    }
    const record = records[0]
    if (!record) {
      return unavailableSummary(ref, source, `找不到 DSH Session：${sessionId}`)
    }

    let title: string | undefined
    let titleError: string | undefined
    try {
      const observed: SessionTitleObservation = await activeQuery.readTitleSnapshot(sessionId as SessionId, signal)
      title = observed.title?.title
    } catch (error) {
      titleError = `无法读取 Session 标题：${describeError(error)}`
    }
    const recordError = !record.live && !record.persisted
      ? 'DSH 记录既不在内存中也不在持久化中。'
      : undefined
    const error = [recordError, titleError].filter((item): item is string => item !== undefined).join('；')
    return summaryFromRecord(ref, source, record, title, error || undefined)
  }

  return {
    capability,
    source,
    async availability() {
      return query()
        ? { available: true }
        : { available: false, error: 'Session 查询服务未加载：当前 profile 未提供 ctx.sessionQuery。' }
    },
    async discover(signal) {
      const activeQuery = query()
      if (!activeQuery) {
        throw new Error('Session 能力不可用：profile 未加载 ctx.sessionQuery；Workspace 与已保存关联不受影响。')
      }
      let records: readonly SessionRecord[]
      try {
        records = await activeQuery.listSessions(signal)
      } catch (error) {
        throw new Error(`无法列举 DSH Session：${describeError(error)}`, { cause: error })
      }
      return records.map((record) => summaryFromRecord(reference(record.header.id), source, record, undefined, undefined))
    },
    async inspect(sessionId, signal) {
      return inspect(sessionId, signal)
    },
    async inspectReference(input, signal) {
      return inspectReference(input, signal)
    },
    reference,
    async open(input, signal) {
      const summary = await inspectReference(input, signal)
      if (summary.state === 'unavailable') {
        return { mode: 'unavailable', note: summary.error ?? 'Session 当前不可访问。' }
      }
      if (summary.state === 'live') {
        return {
          mode: 'live',
          note: 'Session 仍在当前 DSH 进程中；请使用创建它的 DSH 表层继续，不能从另一个进程接管活跃 Session。',
        }
      }
      if (summary.parentSessionId !== undefined || summary.origin === 'subagent' || summary.isSeeded === true) {
        return {
          mode: 'unavailable',
          note: 'DSH headless 不接受 fork 或 subagent Session 的继续；已保存关联保留，只能在原创建表层查看。',
        }
      }
      if (summary.cwd === undefined) {
        return {
          mode: 'unavailable',
          note: 'DSH 未记录该 Session 的工作目录，headless 无法可靠继续；已保存关联保留。',
        }
      }
      const formatNote = summary.formatStatus === 'migration-required'
        ? '持久化格式需要迁移，首次写入可能升级当前格式。'
        : 'DSH 会校验同一 DSH_HOME、工作目录与 agent preset。'
      return {
        mode: 'native',
        command: ['dsh', '--profile', 'headless', '--session-id', summary.sessionId],
        cwd: summary.cwd,
        note: `原生继续入口；在同一 DSH_HOME 下追加任务文本。${formatNote}`,
      }
    },
  }
}

/** 将 Session 用例提供给当前 fiber；卸载不会删除任何 Session 或 Workspace 关联。 */
export function apply(ctx: Context): void {
  const profile = ctx.get('profileContext') as { readonly name?: string; readonly home?: string } | undefined
  const source = profile?.home === undefined
    ? undefined
    : { home: profile.home, label: profile.name ?? 'dsh' }
  const service = createSessionService({
    ...(source === undefined ? {} : { source }),
    query: () => ctx.get('sessionQuery') as unknown as SessionQuery | undefined,
  })
  ctx.provide('locusSession', service)
}
