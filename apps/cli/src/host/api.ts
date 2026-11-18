import { createDispatcher } from '@locus/core/invocation'
import type { ApiRouter, ComponentStateView, InvocationRequest, InvocationResult } from '@locus/core/invocation'
import type { EventBus } from '@locus/core/events'
import { SecurityFailure } from '@locus/core/security'
import type { SecurityChallenge, SecurityGrantScope, SecurityHost, SecuritySession } from '@locus/core/security'
import type { CliSecurityUI } from './terminal.ts'

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

function challengeOf(result: InvocationResult): SecurityChallenge | undefined {
  if (result.ok) return undefined
  const challenge = result.error.details?.challenge
  if (challenge === null || typeof challenge !== 'object') return undefined
  const value = challenge as Record<string, unknown>
  return typeof value.challengeId === 'string' && typeof value.operation === 'string'
    ? (challenge as SecurityChallenge)
    : undefined
}
