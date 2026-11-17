import { parseCredentialRef, SecurityFailure } from '@locus/core'
import type { CapabilityContext, CapabilityHandler, CredentialRef } from '@locus/core'
import { defineComponent } from '@locus/core'

export interface PostgresRegisterInput {
  readonly credential: CredentialRef
  readonly host: string
  readonly port?: string
  readonly database: string
  readonly username: string
  readonly password: string
}

export interface PostgresQueryInput {
  readonly credential: CredentialRef
  readonly sql: string
  readonly values?: readonly unknown[]
}

export interface PostgresPool {
  query(sql: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly unknown[]; readonly rowCount?: number | null }>
  end(): Promise<void>
}

export interface PostgresQueryResult {
  readonly rows: readonly unknown[]
  readonly rowCount: number
}

export interface PostgresPoolParameters {
  readonly host: string
  readonly port?: number
  readonly database: string
  readonly user: string
  password: string
}

function poolParameters(values: Readonly<Record<string, string>>): PostgresPoolParameters {
  const host = values.host
  const database = values.database
  const user = values.username
  const password = values.password
  if (host === undefined || database === undefined || user === undefined || password === undefined) {
    throw new SecurityFailure('delivery-failed')
  }
  const portValue = values.port
  const port = portValue === undefined ? undefined : Number(portValue)
  if (portValue !== undefined && (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535)) {
    throw new SecurityFailure('delivery-failed')
  }
  return { host, database, user, password, ...(port === undefined ? {} : { port }) }
}

const register: CapabilityHandler<PostgresRegisterInput, { readonly registered: true }> = async (context, input) => {
  const reference = parseCredentialRef(input.credential)
  await context.registerCredential('database-auth', reference, {
    host: input.host,
    ...(input.port === undefined ? {} : { port: input.port }),
    database: input.database,
    username: input.username,
    password: input.password,
  })
  return { registered: true }
}

const list: CapabilityHandler<PostgresQueryInput, PostgresQueryResult> = async (context, input) => {
  const reference = parseCredentialRef(input.credential)
  // 只有 pg list 连接数据库；延迟加载驱动，普通命令不支付 pg 与 dns 的导入成本。
  const { Pool } = await import('pg')
  const lease = await createPostgresPool(context, 'database-auth', reference, (parameters) => new Pool(parameters))
  try {
    const result = await lease.pool.query(input.sql, input.values ?? [])
    return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length }
  } finally {
    await lease.dispose()
  }
}

export const postgres = defineComponent({
  id: 'postgres',
  version: '3',
  name: 'PostgreSQL',
  summary: '使用 Core 绑定的可信目标与数据库字段建立驱动连接',
  kind: 'locus',
  capabilities: [
    {
      id: 'register',
      resourceType: 'database',
      defaultAuthLevel: 'root',
      secrets: [{ slot: 'database-auth', access: 'write' }],
      run: register,
    },
    {
      id: 'list',
      resourceType: 'database',
      defaultAuthLevel: 'user',
      secrets: [{ slot: 'database-auth', access: 'read' }],
      run: list,
    },
  ],
  credentials: [
    {
      id: 'database-auth',
      fields: [
        { name: 'host', secret: false, required: true },
        { name: 'port', secret: false, required: false },
        { name: 'database', secret: false, required: true },
        { name: 'username', secret: false, required: true },
        { name: 'password', secret: true, required: true },
      ],
    },
  ],
})

export const component = postgres.component
export const api = postgres.api

/** 身份、目标与密码全部来自 Core 绑定字段；调用者不能再指定连接目标。 */
export async function createPostgresPool<T extends PostgresPool>(
  context: CapabilityContext,
  slot: string,
  reference: CredentialRef,
  createPool: (parameters: PostgresPoolParameters) => T | Promise<T>,
): Promise<{ readonly pool: T; dispose(): Promise<void> }> {
  return context.withCredential(slot, reference, async (values) => {
    const parameters = poolParameters(values)
    let pool: T | undefined
    try {
      pool = await createPool(parameters)
    } catch {
      parameters.password = ''
      throw new SecurityFailure('delivery-failed')
    }
    let disposed = false
    return {
      get pool() {
        if (pool === undefined) throw new SecurityFailure('delivery-failed')
        return pool
      },
      async dispose() {
        if (disposed) return
        disposed = true
        const current = pool!
        pool = undefined
        try { await current.end() } catch { throw new SecurityFailure('delivery-failed') } finally { parameters.password = '' }
      },
    }
  })
}
