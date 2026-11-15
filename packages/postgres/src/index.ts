import { parseCredentialRef } from '@locus/config-reference'
import { defineComponent, SecurityFailure } from '@locus/core'
import type { CapabilityContext, CapabilityHandler, CredentialRef } from '@locus/core'
import { Pool } from 'pg'

export interface PostgresOptions {
  readonly host: string
  readonly port?: number
  readonly database: string
}

export interface PostgresConfig extends PostgresOptions {
  readonly credential: CredentialRef
}

export interface PostgresRegisterInput {
  readonly credential: CredentialRef
  readonly username: string
  readonly password: string
}

export interface PostgresQueryInput {
  readonly config: PostgresConfig
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

const register: CapabilityHandler<PostgresRegisterInput, { readonly registered: true }> = async (context, input) => {
  const reference = parseCredentialRef(input.credential)
  await context.registerCredential('database-auth', reference, {
    username: input.username,
    password: input.password,
  })
  return { registered: true }
}

const list: CapabilityHandler<PostgresQueryInput, PostgresQueryResult> = async (context, input) => {
  const reference = parseCredentialRef(input.config.credential)
  const lease = await createPostgresPool(
    context,
    'database-auth',
    reference,
    input.config,
    (parameters) => new Pool(parameters),
  )
  try {
    const result = await lease.pool.query(input.sql, input.values ?? [])
    return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length }
  } finally {
    await lease.dispose()
  }
}

export const postgres = defineComponent({
  id: 'postgres',
  version: '2',
  name: 'PostgreSQL',
  summary: '使用 Core 绑定的数据库字段建立驱动连接',
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
        { name: 'username', secret: false, required: true },
        { name: 'password', secret: true, required: true },
      ],
    },
  ],
})

export const component = postgres.component
export const api = postgres.api

/** 密码只进入驱动参数；连接池生存期内保留必要引用，不构造连接 URL。 */
export async function createPostgresPool<T extends PostgresPool>(
  context: CapabilityContext,
  slot: string,
  reference: CredentialRef,
  options: PostgresOptions,
  createPool: (parameters: PostgresOptions & { readonly user: string; readonly password: string }) => T | Promise<T>,
): Promise<{ readonly pool: T; dispose(): Promise<void> }> {
  return context.withCredential(slot, reference, async (values) => {
    const username = values.username
    const password = values.password
    if (username === undefined || password === undefined) throw new SecurityFailure('delivery-failed')
    const parameters = { ...options, user: username, password }
    let pool: T | undefined
    try {
      pool = await createPool(parameters)
    } catch {
      parameters.password = ''
      throw new SecurityFailure('delivery-failed')
    }
    let disposed = false
    return { get pool() {
      if (pool === undefined) throw new SecurityFailure('delivery-failed')
      return pool
    }, async dispose() {
      if (disposed) return
      disposed = true
      const current = pool!
      pool = undefined
      try { await current.end() } catch { throw new SecurityFailure('delivery-failed') } finally { parameters.password = '' }
    } }
  })
}
