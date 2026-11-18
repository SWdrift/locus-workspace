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
  summary:
    '以路径 id 作为资源键登记或替换 Gitea API 凭据；JSON Body 必填 origin（仅含协议、主机和端口的 HTTP/HTTPS 源站），token 由可信输入提供，无 query；返回 registered:true 与凭据 reference。',
  method: 'PUT',
  scheme: 'gitea',
  authority: 'repositories',
  path: '/:id',
  auth: 'root',
  input: giteaRegisterInputSchema,
  output: z.object({ registered: z.literal(true), reference: z.string() }),
  fields: {
    token: {
      secret: true,
      tty: true,
      file: true,
      required: true,
      description: '绑定到 origin 的 Gitea API 令牌；仅接受可信输入，请求时作为 Bearer 凭据使用。',
    },
  },
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
  summary:
    '使用路径 id 绑定的 Gitea 凭据发起同源请求；JSON Body 必填 path（可含上游 query），可选 method（默认 GET）、headers（不得含 Authorization）、body（文本），本操作无 query；返回 kind=response 及 status/筛选后的 headers/文本 body，或 authentication-failed（401/403）、network-failed，不跟随重定向。',
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
