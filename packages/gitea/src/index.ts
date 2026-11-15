import { parseCredentialRef } from '@locus/config-reference'
import { defineComponent, SecurityFailure } from '@locus/core'
import type { CapabilityContext, CapabilityHandler, CredentialRef } from '@locus/core'

export type GiteaResult =
  | { readonly kind: 'response'; readonly response: Response }
  | { readonly kind: 'authentication-failed'; readonly status: 401 | 403 }
  | { readonly kind: 'network-failed' }

export interface GiteaRegisterInput {
  readonly credential: CredentialRef
  readonly token: string
}

export interface GiteaRequestInput {
  readonly origin: string
  readonly path: string
  readonly credential: CredentialRef
  readonly init?: RequestInit
}

const register: CapabilityHandler<GiteaRegisterInput, { readonly registered: true }> = async (context, input) => {
  const reference = parseCredentialRef(input.credential)
  await context.registerCredential('api-token', reference, { token: input.token })
  return { registered: true }
}

const request: CapabilityHandler<GiteaRequestInput, GiteaResult> = async (context, input) => {
  const reference = parseCredentialRef(input.credential)
  return createGiteaRequester(context, reference, input.origin).request(input.path, input.init)
}

export const gitea = defineComponent({
  id: 'gitea',
  version: '2',
  name: 'Gitea',
  summary: '使用 Core 绑定的令牌访问固定 origin',
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
        { name: 'token', secret: true, required: true },
      ],
    },
  ],
})

export const component = gitea.component
export const api = gitea.api

/** 只向绑定的 origin 发认证请求；重定向作为普通响应返回，不自动转发认证。 */
export function createGiteaRequester(
  context: CapabilityContext,
  reference: CredentialRef,
  origin: string,
  fetcher: typeof fetch = fetch,
) {
  const base = new URL(origin)
  if (base.username || base.password || (base.protocol !== 'https:' && base.protocol !== 'http:')) {
    throw new SecurityFailure('access-denied', { reason: 'invalid-request' })
  }
  return {
    async request(path: string, init?: RequestInit): Promise<GiteaResult> {
      const url = new URL(path, base)
      const headers = new Headers(init?.headers)
      if (url.origin !== base.origin || url.username || url.password || headers.has('authorization')) {
        throw new SecurityFailure('access-denied', { reason: 'resource-mismatch' })
      }
      return context.withCredential('api-token', reference, async (values): Promise<GiteaResult> => {
        const token = values.token
        if (token === undefined) throw new SecurityFailure('delivery-failed')
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
