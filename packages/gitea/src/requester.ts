import { SecurityFailure } from '@locus/core/security'
import type { CredentialDefinition, OperationContext } from '@locus/core/invocation'
import { i18n } from './i18n.ts'
import type { GiteaResponse, GiteaResult } from './types.ts'

/** Origin 在 Root 登记时固定；请求阶段不接受调用者指定的目标。 */
export function normalizeOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new SecurityFailure('access-denied', { reason: 'invalid-request' })
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== '/' ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new SecurityFailure('access-denied', { reason: 'invalid-request' })
  }
  return url.origin
}

/** 原生响应只供包内消费；不跟随重定向，也不透传携带请求配置的网络异常。 */
export function createGiteaRequester(
  context: OperationContext,
  credential: CredentialDefinition,
  key: string,
  fetcher: typeof fetch = fetch,
) {
  return {
    async request(
      path: string,
      init: RequestInit,
      consumeResponse: (response: Response) => Promise<GiteaResponse>,
    ): Promise<GiteaResult> {
      return context.credential.read(credential, key, async (values): Promise<GiteaResult> => {
        const token = values.token
        const origin = values.origin
        if (token === undefined || token.length === 0 || origin === undefined)
          throw new SecurityFailure('delivery-failed')
        let base: URL
        let url: URL
        let headers: Headers
        try {
          base = new URL(normalizeOrigin(origin))
          url = new URL(path, base)
          headers = new Headers(init.headers)
        } catch {
          throw new SecurityFailure('access-denied', { reason: 'invalid-request' })
        }
        if (url.origin !== base.origin || url.username || url.password || headers.has('authorization')) {
          throw new SecurityFailure('access-denied', { reason: 'resource-mismatch' })
        }
        try {
          headers.set('Authorization', `Bearer ${token}`)
          const response = await fetcher(url, { ...init, headers, redirect: 'manual' })
          if (response.status === 401 || response.status === 403) {
            await response.body?.cancel()
            return { kind: 'authentication-failed', status: response.status }
          }
          const consumed = await consumeResponse(response)
          // 上游可能回显认证字段；绑定令牌不能借响应正文或普通 Header 离开凭据消费边界。
          consumed.body = consumed.body.replaceAll(token, i18n.t('redaction.token'))
          for (const [name, value] of Object.entries(consumed.headers)) {
            consumed.headers[name] = value.replaceAll(token, i18n.t('redaction.token'))
          }
          return { kind: 'response', response: consumed }
        } catch {
          return { kind: 'network-failed' }
        } finally {
          headers.delete('Authorization')
        }
      })
    },
  }
}
