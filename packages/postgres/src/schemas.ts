import { z } from 'zod'

export const registerInputSchema = z.object({
  host: z.string(),
  port: z.string().optional(),
  database: z.string(),
  username: z.string(),
  password: z.string(),
})

export const queryInputSchema = z.object({
  sql: z.string(),
  values: z.array(z.unknown()).optional(),
})

export const queryResultSchema = z.object({
  rows: z.array(z.record(z.string(), z.json())).readonly(),
  rowCount: z.number().int(),
})
