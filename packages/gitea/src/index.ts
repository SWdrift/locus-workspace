import { defineComponent, parseCredentialRef, SecurityFailure } from '@locus/core'
import type { CapabilityContext, CapabilityHandler, CredentialRef } from '@locus/core'

export type GiteaResult =
  | { readonly kind: 'response'; readonly response: Response }
  | { readonly kind: 'authentication-failed'; readonly status: 401 | 403 }
  | { readonly kind: 'network-failed' }

export interface GiteaRegisterInput {
  readonly credential: CredentialRef
  readonly origin: string
  readonly token: string
}

export interface GiteaRequestInput {
  readonly credential: CredentialRef
  readonly path: string
  readonly init?: RequestInit
}

/** Origin 在 Root 登记时固定；请求阶段不再接受调用者指定的目标。 */
function normalizeOrigin(value: string): string {
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

const register: CapabilityHandler<GiteaRegisterInput, { readonly registered: true }> = async (context, input) => {
  const reference = parseCredentialRef(input.credential)
  await context.registerCredential('api-token', reference, {
    origin: normalizeOrigin(input.origin),
    token: input.token,
  })
  return { registered: true }
}

const request: CapabilityHandler<GiteaRequestInput, GiteaResult> = async (context, input) => {
  const reference = parseCredentialRef(input.credential)
  return createGiteaRequester(context, reference).request(input.path, input.init)
}

export const gitea = defineComponent({
  id: 'gitea',
  version: '3',
  name: 'Gitea',
  summary: '使用 Core 绑定的固定 origin 与令牌访问',
  kind: 'locus',
  capabilities: [
    {
      id: 'register',
      resourceType: 'gitea',
      defaultAuthLevel: 'root',
      secrets: [{ slot: 'api-token', access: 'write' }],
      run: register,
    },
    {
      id: 'request',
      resourceType: 'gitea',
      defaultAuthLevel: 'user',
      secrets: [{ slot: 'api-token', access: 'read' }],
      run: request,
    },
  ],
  credentials: [
    {
      id: 'api-token',
      fields: [
        { name: 'origin', secret: false, required: true },
        { name: 'token', secret: true, required: true },
      ],
    },
  ],
})

export const component = gitea.component
export const api = gitea.api

/** 只向登记时绑定的 origin 发认证请求；重定向作为普通响应返回，不自动转发认证。 */
export function createGiteaRequester(
  context: CapabilityContext,
  reference: CredentialRef,
  fetcher: typeof fetch = fetch,
) {
  return {
    async request(path: string, init?: RequestInit): Promise<GiteaResult> {
      return context.withCredential('api-token', reference, async (values): Promise<GiteaResult> => {
        const token = values.token
        const origin = values.origin
        if (token === undefined || origin === undefined) throw new SecurityFailure('delivery-failed')
        const base = new URL(origin)
        const url = new URL(path, base)
        const headers = new Headers(init?.headers)
        if (url.origin !== base.origin || url.username || url.password || headers.has('authorization')) {
          throw new SecurityFailure('access-denied', { reason: 'resource-mismatch' })
        }
        headers.set('Authorization', `Bearer ${token}`)
        try {
          const response = await fetcher(url, { ...init, headers, redirect: 'manual' })
          if (response.status === 401 || response.status === 403) {
            await response.body?.cancel()
            return { kind: 'authentication-failed', status: response.status }
          }
          return { kind: 'response', response }
        } catch {
          return { kind: 'network-failed' }
        } finally {
          headers.delete('Authorization')
        }
      })
    },
  }
}
