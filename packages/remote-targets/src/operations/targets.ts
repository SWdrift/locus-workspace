import { defineOperation } from '@locus/core/invocation'
import { z } from 'zod'
import { i18n } from '../i18n.ts'
import { migrationSourceSchema, registerInputSchema, remoteTargetSchema, remoteTargetViewSchema } from '../schemas.ts'
import { withService } from './context.ts'
import { credentialFields, secretOf, slotOf, writeCredential } from './credentials.ts'

export const listTargets = defineOperation({
  id: 'rt.targets.list',
  summary: i18n.t('operation.targets.list'),
  method: 'GET',
  scheme: 'rt',
  authority: 'targets',
  path: '',
  auth: 'user',
  input: z.undefined(),
  output: z.array(remoteTargetSchema).readonly(),
  run: (_query, _input, context) => withService(context, service => service.list()),
})

export const getTarget = defineOperation({
  id: 'rt.target.get',
  summary: i18n.t('operation.target.get'),
  method: 'GET',
  scheme: 'rt',
  authority: 'targets',
  path: '/:id',
  auth: 'user',
  input: z.undefined(),
  output: remoteTargetViewSchema,
  run: (_query, _input, context) => withService(context, service => service.show(context.url.pathParams.id ?? '')),
})

export const previewTarget = defineOperation({
  id: 'rt.target.preview',
  summary: i18n.t('operation.target.preview'),
  method: 'POST',
  scheme: 'rt',
  authority: 'targets',
  path: '/:id/actions/preview',
  auth: 'user',
  input: z.object({ spec: z.string() }),
  output: remoteTargetSchema,
  run: (_query, input, context) =>
    withService(context, service => service.addFromText(context.url.pathParams.id ?? '', input.spec, { dryRun: true })),
})

export const migrationSource = defineOperation({
  id: 'rt.target.migration-source',
  summary: i18n.t('operation.target.migration-source'),
  method: 'GET',
  scheme: 'rt',
  authority: 'targets',
  path: '/:id/actions/migration-source',
  auth: 'user',
  input: z.undefined(),
  output: migrationSourceSchema,
  run: (_query, _input, context) =>
    withService(context, service => service.credentialMigration(context.url.pathParams.id ?? '')),
})

export const registerTarget = defineOperation({
  id: 'rt.target.register',
  summary: i18n.t('operation.target.register'),
  method: 'PUT',
  scheme: 'rt',
  authority: 'targets',
  path: '/:id',
  auth: 'root',
  input: registerInputSchema,
  output: remoteTargetSchema,
  fields: credentialFields,
  run: (_query, input, context) =>
    withService(context, async service => {
      const id = context.url.pathParams.id ?? ''
      const preview = service.addFromText(id, input.spec, { dryRun: true })
      const slot = slotOf(preview)
      await writeCredential(context, preview, slot, secretOf(input, slot))
      const created = service.addFromText(id, input.spec)
      context.emit('locus.rt.target.registered', { target: created.id })
      return created
    }),
})

export const removeTarget = defineOperation({
  id: 'rt.target.remove',
  summary: i18n.t('operation.target.remove'),
  method: 'DELETE',
  scheme: 'rt',
  authority: 'targets',
  path: '/:id',
  auth: 'root',
  input: z.undefined(),
  output: z.object({ target: z.string(), removed: z.literal(true) }),
  run: (_query, _input, context) =>
    withService(context, service => {
      const target = service.show(context.url.pathParams.id ?? '')
      service.remove(target.id)
      context.emit('locus.rt.target.removed', { target: target.id })
      return { target: target.id, removed: true as const }
    }),
})
