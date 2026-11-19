import { InvocationFailure } from '@locus/core/invocation'
import { Pool } from 'pg'
import { i18n } from './i18n.ts'
import type { PostgresPoolParameters, PostgresQueryInput, PostgresQueryResult } from './types.ts'

/** 临时验证消费者每次查询创建并释放驱动池，不维护长期连接抽象。 */
export async function queryPostgres(
  values: Readonly<Record<string, string>>,
  input: PostgresQueryInput,
): Promise<PostgresQueryResult> {
  const parameters = poolParameters(values)
  let pool: Pool
  try {
    pool = new Pool(parameters)
  } catch {
    parameters.password = ''
    throw new InvocationFailure('unavailable', i18n.t('query.connection-init-failed'))
  }
  try {
    const result = await pool.query(input.sql, input.values ?? [])
    // 驱动的 Date、Buffer 等原生值在协议边界转为普通 JSON，不能把进程内对象交给消费者。
    const rows = JSON.parse(JSON.stringify(result.rows)) as PostgresQueryResult['rows']
    return { rows, rowCount: result.rowCount ?? rows.length }
  } catch (error) {
    throw new InvocationFailure(
      'unavailable',
      i18n.t('query.failed', { detail: error instanceof Error ? error.message : String(error) }),
    )
  } finally {
    parameters.password = ''
    await pool.end()
  }
}

function poolParameters(values: Readonly<Record<string, string>>): PostgresPoolParameters {
  const host = values.host
  const database = values.database
  const user = values.username
  const password = values.password
  if (host === undefined || database === undefined || user === undefined || password === undefined) {
    throw new InvocationFailure('invalid-argument', i18n.t('query.credential-incomplete'))
  }
  const portValue = values.port
  const port = portValue === undefined ? undefined : Number(portValue)
  if (portValue !== undefined && (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535)) {
    throw new InvocationFailure('invalid-argument', i18n.t('query.port-range'))
  }
  return { host, database, user, password, ...(port === undefined ? {} : { port }) }
}
