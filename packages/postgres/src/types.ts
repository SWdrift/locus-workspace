import type { z } from 'zod'
import type { queryInputSchema, queryResultSchema, registerInputSchema } from './schemas.ts'

/** 密码来自可信凭据槽，不来自调用者的目标参数。 */
export interface PostgresPoolParameters {
  readonly host: string
  readonly port?: number
  readonly database: string
  readonly user: string
  password: string
}

export type PostgresRegisterInput = z.infer<typeof registerInputSchema>
export type PostgresQueryInput = z.infer<typeof queryInputSchema>
export type PostgresQueryResult = z.infer<typeof queryResultSchema>
