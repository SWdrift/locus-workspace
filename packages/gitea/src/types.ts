import { z } from 'zod'

export const giteaRegisterInputSchema = z.object({
  origin: z.string(),
  token: z.string(),
})

export const giteaRequestInputSchema = z.object({
  path: z.string(),
  method: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
})

export const giteaResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  headers: z.record(z.string(), z.string()),
  body: z.string(),
})

export const giteaResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('response'), response: giteaResponseSchema }),
  z.object({ kind: z.literal('authentication-failed'), status: z.union([z.literal(401), z.literal(403)]) }),
  z.object({ kind: z.literal('network-failed') }),
])

export type GiteaRegisterInput = z.infer<typeof giteaRegisterInputSchema>
export type GiteaRequestInput = z.infer<typeof giteaRequestInputSchema>
export type GiteaResponse = z.infer<typeof giteaResponseSchema>
export type GiteaResult = z.infer<typeof giteaResultSchema>
