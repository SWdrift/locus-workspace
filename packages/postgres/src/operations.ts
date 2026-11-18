import { defineCredential, defineOperation } from '@locus/core/invocation'
import { z } from 'zod'
import { queryPostgres } from './query.ts'
import { queryInputSchema, queryResultSchema, registerInputSchema } from './schemas.ts'

export const databaseAuth = defineCredential({
  id: 'database-auth',
  fields: [
    { name: 'host', secret: false, required: true },
    { name: 'port', secret: false, required: false },
    { name: 'database', secret: false, required: true },
    { name: 'username', secret: false, required: true },
    { name: 'password', secret: true, required: true, tty: true },
  ],
})

export const registerDatabase = defineOperation({
  id: 'pg.database.register',
  summary:
    '以路径 id 作为资源键登记或替换 PostgreSQL 连接凭据；JSON Body 必填 host、database、username，可选 port（字符串），password 由可信输入提供，无 query；返回 registered:true 与凭据 reference。',
  method: 'PUT',
  scheme: 'pg',
  authority: 'databases',
  path: '/:id',
  auth: 'root',
  input: registerInputSchema,
  output: z.object({ registered: z.literal(true), reference: z.string() }),
  fields: {
    password: {
      secret: true,
      tty: true,
      file: true,
      required: true,
      description: '指定 PostgreSQL 用户的连接密码；仅接受可信输入。',
    },
  },
  async run(_query, input, context) {
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

export const queryDatabase = defineOperation({
  id: 'pg.database.query',
  summary:
    '使用路径 id 绑定的 PostgreSQL 连接执行 SQL；JSON Body 必填 sql，可选 values（参数数组，对应 SQL 的 $1、$2 等占位符），无 query；返回 JSON 兼容 rows 数组与 rowCount。',
  method: 'POST',
  scheme: 'pg',
  authority: 'databases',
  path: '/:id/queries',
  auth: 'user',
  input: queryInputSchema,
  output: queryResultSchema,
  run: (_query, input, context) =>
    context.credential.read(databaseAuth, context.url.pathParams.id ?? '', values => queryPostgres(values, input)),
})
