import { defineComponent, defineCredential, defineOperation, InvocationFailure } from '@locus/core'
import { Pool } from 'pg'
import { z } from 'zod'

/** 对外保留的连接参数形状；密码来自可信凭据槽，不来自输入目标参数。 */
export interface PostgresPoolParameters {
  readonly host: string
  readonly port?: number
  readonly database: string
  readonly user: string
  password: string
}

/** 驱动池的最小接口，便于测试替换实现。 */
export interface PostgresPool {
  query(sql: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly unknown[]; readonly rowCount?: number | null }>
  end(): Promise<void>
}

export interface PostgresQueryResult {
  readonly rows: readonly unknown[]
  readonly rowCount: number
}

const registerInput = z.object({
  host: z.string(),
  port: z.string().optional(),
  database: z.string(),
  username: z.string(),
  password: z.string(),
})

const queryInput = z.object({
  sql: z.string(),
  values: z.array(z.unknown()).optional(),
})

export type PostgresRegisterInput = z.infer<typeof registerInput>
export type PostgresQueryInput = z.infer<typeof queryInput>

/** 数据库连接凭据；密码只落在凭据槽，公开字段用于建立连接目标。 */
const databaseAuth = defineCredential({
  id: 'database-auth',
  fields: [
    { name: 'host', secret: false, required: true },
    { name: 'port', secret: false, required: false },
    { name: 'database', secret: false, required: true },
    { name: 'username', secret: false, required: true },
    { name: 'password', secret: true, required: true, tty: true },
  ],
})

function poolParameters(values: Readonly<Record<string, string>>): PostgresPoolParameters {
  const host = values.host
  const database = values.database
  const user = values.username
  const password = values.password
  if (host === undefined || database === undefined || user === undefined || password === undefined) {
    throw new InvocationFailure('invalid-argument', '数据库凭据缺少 host、database、username 或 password')
  }
  const portValue = values.port
  const port = portValue === undefined ? undefined : Number(portValue)
  if (portValue !== undefined && (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535)) {
    throw new InvocationFailure('invalid-argument', '数据库端口必须是 1 到 65535 的整数')
  }
  return { host, database, user, password, ...(port === undefined ? {} : { port }) }
}

const register = defineOperation({
  id: 'pg.database.register',
  method: 'PUT',
  scheme: 'pg',
  authority: 'databases',
  path: '/:id',
  auth: 'root',
  input: registerInput,
  output: z.object({ registered: z.literal(true), reference: z.string() }),
  fields: { password: { secret: true, tty: true } },
  run: async (_query, input, context) => {
    const reference = await context.credential.write(databaseAuth, context.url.pathParams.id ?? '', {
      host: input.host,
      ...(input.port === undefined ? {} : { port: input.port }),
      database: input.database,
      username: input.username,
      password: input.password,
    })
    return { registered: true as const, reference }
  },
})

const query = defineOperation({
  id: 'pg.database.query',
  method: 'POST',
  scheme: 'pg',
  authority: 'databases',
  path: '/:id/queries',
  auth: 'user',
  input: queryInput,
  output: z.object({ rows: z.array(z.unknown()), rowCount: z.number() }),
  run: async (_query, input, context) => context.credential.read(
    databaseAuth,
    context.url.pathParams.id ?? '',
    async (values) => {
      const parameters = poolParameters(values)
      let pool: Pool
      try {
        pool = new Pool(parameters)
      } catch {
        parameters.password = ''
        throw new InvocationFailure('unavailable', 'PostgreSQL 连接初始化失败')
      }
      try {
        const result = await pool.query(input.sql, input.values ?? [])
        return { rows: [...result.rows], rowCount: result.rowCount ?? result.rows.length }
      } catch (error) {
        throw new InvocationFailure(
          'unavailable',
          `PostgreSQL 查询失败：${error instanceof Error ? error.message : String(error)}`,
        )
      } finally {
        parameters.password = ''
        await pool.end()
      }
    },
  ),
})

export const postgres = defineComponent({
  id: 'postgres',
  version: '4',
  name: 'PostgreSQL',
  summary: '使用 Core 绑定的可信目标与数据库字段建立驱动连接',
  kind: 'locus',
  credentials: [databaseAuth],
  operations: [register, query],
})

export const component = postgres.component
export const operations = postgres.operations
