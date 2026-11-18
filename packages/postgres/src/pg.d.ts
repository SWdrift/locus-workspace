declare module 'pg' {
  export interface PoolConfig {
    host: string
    port?: number
    user: string
    password: string
    database: string
  }

  export class Pool {
    constructor(config: PoolConfig)
    query(
      sql: string,
      values?: readonly unknown[],
    ): Promise<{
      rows: readonly Record<string, unknown>[]
      rowCount?: number | null
    }>
    end(): Promise<void>
  }
}
