import { defineComponent, defineCredential, defineOperation, SecurityFailure } from '@locus/core'
import type { CredentialDefinition, OperationContext } from '@locus/core'
import { z } from 'zod'

export type GiteaResult =
  | { readonly kind: 'response'; readonly response: Response }
  | { readonly kind: 'authentication-failed'; readonly status: 401 | 403 }
  | { readonly kind: 'network-failed' }

const apiToken = defineCredential({
  id: 'api-token',
  fields: [
    { name: 'origin', secret: false, required: true },
    { name: 'token', secret: true, required: true, tty: true },
  ],
})

const registerInput = z.object({ origin: z.string(), token: z.string() })

const requestInput = z.object({
  path: z.string(),
  method: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
})

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

const register = defineOperation({
  id: 'gitea.repository.register',
  method: 'PUT',
  scheme: 'gitea',
  authority: 'repositories',
  path: '/:id',
  auth: 'root',
  input: registerInput,
  output: z.object({ registered: z.literal(true), reference: z.string() }),
  fields: { token: { secret: true, tty: true } },
  run: async (_query, input, context) => {
    const origin = normalizeOrigin(input.origin)
    const reference = await context.credential.write(apiToken, context.url.pathParams.id ?? '', {
      origin,
      token: input.token,
    })
    return { registered: true as const, reference }
  },
})

const request = defineOperation({
  id: 'gitea.repository.request',
  method: 'POST',
  scheme: 'gitea',
  authority: 'repositories',
  path: '/:id/requests',
  auth: 'user',
  input: requestInput,
  output: z.unknown(),
  run: (_query, input, context) => {
    const init: RequestInit = {
      ...(input.method === undefined ? {} : { method: input.method }),
      ...(input.headers === undefined ? {} : { headers: input.headers }),
      ...(input.body === undefined ? {} : { body: input.body }),
    }
    return createGiteaRequester(context, apiToken, context.url.pathParams.id ?? '').request(input.path, init)
  },
})

const gitea = defineComponent({
  id: 'gitea',
  version: '4',
  name: 'Gitea',
  summary: '使用 Core 绑定的固定 origin 与令牌访问',
  kind: 'locus',
  operations: [register, request],
  credentials: [apiToken],
})

export const component = gitea.component
export const operations = gitea.operations

/** 只向登记时绑定的 origin 发认证请求；重定向作为普通响应返回，不自动转发认证。 */
export function createGiteaRequester(
  context: OperationContext,
  credential: CredentialDefinition,
  key: string,
  fetcher: typeof fetch = fetch,
) {
  return {
    async request(path: string, init?: RequestInit): Promise<GiteaResult> {
      return context.credential.read(credential, key, async (values): Promise<GiteaResult> => {
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
