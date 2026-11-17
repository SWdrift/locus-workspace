import { createDispatcher, SecurityFailure } from '@locus/core'
import type {
  ApiRouter, ComponentStateView, EventBus, InvocationErrorCode, InvocationRequest,
  InvocationResult, SecurityChallenge, SecurityGrantScope, SecurityHost, SecuritySession,
} from '@locus/core'
import type { CliSecurityUI } from './security-host.ts'

export interface CliApiOptions {
  readonly host: SecurityHost
  readonly router: ApiRouter
  readonly events: EventBus
  readonly dataDirectory: string
  readonly components: ComponentStateView
  readonly ui: CliSecurityUI
  readonly grantScope: SecurityGrantScope
}

export interface CliApi {
  invoke(request: InvocationRequest, trustedInput?: Readonly<Record<string, unknown>>): Promise<InvocationResult>
  invokeAll(requests: readonly (InvocationRequest & { readonly method: 'GET' })[]): Promise<readonly InvocationResult[]>
  dispose(): void
}

/** 协议错误在 CLI 中作为可分类失败抛出；URL 动词直接输出信封。 */
export class CliFailure extends Error {
  readonly code: InvocationErrorCode
  readonly details: Readonly<Record<string, unknown>> | undefined

  constructor(result: InvocationResult & { readonly ok: false }) {
    super(result.error.message)
    this.name = 'CliFailure'
    this.code = result.error.code
    this.details = result.error.details
  }
}

export function exitCodeFor(code: InvocationErrorCode): number {
  if (
    code === 'invalid-argument' || code === 'invalid-body' || code === 'invalid-uri' ||
    code === 'unsupported-method' || code === 'unsupported-scheme' || code === 'unsupported-media-type'
  ) return 1
  return 2
}

export function unwrap(result: InvocationResult): unknown {
  if (!result.ok) throw new CliFailure(result as InvocationResult & { readonly ok: false })
  return result.data
}

function challengeOf(result: InvocationResult): SecurityChallenge | undefined {
  if (result.ok) return undefined
  const details = result.error.details
  const challenge = details?.challenge
  if (challenge === null || typeof challenge !== 'object') return undefined
  const value = challenge as Record<string, unknown>
  return typeof value.challengeId === 'string' && typeof value.operation === 'string'
    ? challenge as SecurityChallenge
    : undefined
}

/**
 * Host 自己创建真实 Session；Dispatcher 只接受可信 Host 提供的会话。
 * Root 认证仍由 Host 完成，resume 只执行 Core 保存的原闭包。
 */
export function createCliApi(options: CliApiOptions): CliApi {
  const session: SecuritySession = options.host.createSession('human')
  const dispatcher = createDispatcher(
    options.router,
    options.host,
    session,
    options.events,
    options.dataDirectory,
    options.components,
  )
  let disposed = false

  async function authenticate(result: InvocationResult): Promise<InvocationResult> {
    const challenge = challengeOf(result)
    if (challenge === undefined) return result
    if (!options.ui.interactive) throw new SecurityFailure('authentication-unavailable')
    const label = `${challenge.componentId}:${challenge.operation}`
    const password = await options.ui.readSecret(`Root 密码（授权 ${label}）：`)
    let grant
    try {
      grant = await options.host.authenticate(challenge, password, options.grantScope)
    } catch (error) {
      try {
        options.host.cancelChallenge(challenge)
      } catch {
        // 保留原始认证错误。
      }
      throw error
    }
    return options.host.resume<InvocationResult>(grant)
  }

  return {
    async invoke(request, trustedInput) {
      if (disposed) throw new SecurityFailure('security-disposed')
      return authenticate(await dispatcher.invoke(request, trustedInput))
    },
    async invokeAll(requests) {
      if (disposed) throw new SecurityFailure('security-disposed')
      const results = await dispatcher.invokeAll(requests)
      const resolved: InvocationResult[] = []
      for (const result of results) resolved.push(await authenticate(result))
      return Object.freeze(resolved)
    },
    dispose() {
      if (disposed) return
      disposed = true
      options.host.endSession(session)
    },
  }
}
