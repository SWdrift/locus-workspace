import type { Command } from 'commander'
import type { CliSecurityUI } from '../host/terminal.ts'
import { emit } from '../output/output.ts'
import { pathParam } from './shared.ts'
import type { CallOperation } from './shared.ts'

interface PostgresCommandsContext {
  readonly call: CallOperation
  readonly ui: CliSecurityUI
}

export function registerPostgresCommands(program: Command, { call, ui }: PostgresCommandsContext): void {
  const pg = program.command('pg').description('PostgreSQL 组件 operation：登记凭据与查询')
  const register = pg
    .command('register <resource>')
    .description('登记 PostgreSQL 目标并写入 database-auth；密码隐藏输入')
    .requiredOption('--host <host>', 'PostgreSQL 主机')
    .requiredOption('--database <database>', '数据库名')
    .option('--port <port>', 'PostgreSQL 端口')
    .requiredOption('--username <name>', 'PostgreSQL 登录名')
  register.action(async (resource: string) => {
    const opts = register.opts<{ host: string; database: string; port?: string; username: string }>()
    const password = await ui.readSecret('PostgreSQL 密码（隐藏输入）：')
    const result = (await call(
      'PUT',
      `pg://databases/${pathParam(resource)}`,
      {
        host: opts.host,
        database: opts.database,
        ...(opts.port === undefined ? {} : { port: opts.port }),
        username: opts.username,
      },
      { password },
    )) as { reference: string }
    emit(
      register,
      { resource, host: opts.host, database: opts.database, registered: true, reference: result.reference },
      `已登记 PostgreSQL ${resource}；目标 ${opts.host}/${opts.database}；凭据 ${result.reference}。`,
    )
  })
  const list = pg
    .command('list <resource>')
    .description('使用 database-auth 绑定连接并查询 PostgreSQL')
    .option('--sql <sql>', '查询语句', 'select 1')
  list.action(async (resource: string) => {
    const result = await call('POST', `pg://databases/${pathParam(resource)}/queries`, {
      sql: list.opts<{ sql: string }>().sql,
    })
    emit(list, result, JSON.stringify(result))
  })
}
