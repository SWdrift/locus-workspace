import { defineCredential, defineOperation } from '@locus/core/invocation'
import { z } from 'zod'
import { i18n } from './i18n.ts'
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
  summary: i18n.t('operation.database.register'),
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
      description: i18n.t('field.password'),
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
  summary: i18n.t('operation.database.query'),
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
