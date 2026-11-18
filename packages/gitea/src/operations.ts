import { defineCredential, defineOperation } from '@locus/core/invocation'
import { z } from 'zod'
import { createGiteaRequester, normalizeOrigin } from './requester.ts'
import { giteaRegisterInputSchema, giteaRequestInputSchema, giteaResultSchema } from './types.ts'
import type { GiteaResponse } from './types.ts'

export const apiToken = defineCredential({
  id: 'api-token',
  fields: [
    { name: 'origin', secret: false, required: true },
    { name: 'token', secret: true, required: true, tty: true },
  ],
})

const RESPONSE_HEADERS = [
  'content-type',
  'etag',
  'last-modified',
  'link',
  'location',
  'retry-after',
  'x-total-count',
] as const

/** 响应在凭据消费期间读完，仅带必要 Header 与普通文本离开本进程的 HTTP 边界。 */
async function consumeResponse(response: Response): Promise<GiteaResponse> {
  const headers: Record<string, string> = {}
  for (const name of RESPONSE_HEADERS) {
    const value = response.headers.get(name)
    if (value !== null) headers[name] = value
  }
  return { status: response.status, headers, body: await response.text() }
}

export const registerRepository = defineOperation({
  id: 'gitea.repository.register',
  method: 'PUT',
  scheme: 'gitea',
  authority: 'repositories',
  path: '/:id',
  auth: 'root',
  input: giteaRegisterInputSchema,
  output: z.object({ registered: z.literal(true), reference: z.string() }),
  fields: { token: { secret: true, tty: true } },
  async run(_query, input, context) {
    const reference = await context.credential.write(apiToken, context.url.pathParams.id ?? '', {
      origin: normalizeOrigin(input.origin),
      token: input.token,
    })
    return { registered: true as const, reference }
  },
})

export const requestRepository = defineOperation({
  id: 'gitea.repository.request',
  method: 'POST',
  scheme: 'gitea',
  authority: 'repositories',
  path: '/:id/requests',
  auth: 'user',
  input: giteaRequestInputSchema,
  output: giteaResultSchema,
  run(_query, input, context) {
    const init: RequestInit = {
      ...(input.method === undefined ? {} : { method: input.method }),
      ...(input.headers === undefined ? {} : { headers: input.headers }),
      ...(input.body === undefined ? {} : { body: input.body }),
    }
    return createGiteaRequester(context, apiToken, context.url.pathParams.id ?? '').request(
      input.path,
      init,
      consumeResponse,
    )
  },
})
