import { defineOperation } from '@locus/core/invocation'
import { z } from 'zod'
import { remoteServiceSchema } from '../schemas.ts'
import { withService } from './context.ts'
import { materialOf } from './credentials.ts'

export const listServices = defineOperation({
  id: 'rt.services.list',
  method: 'GET',
  scheme: 'rt',
  authority: 'targets',
  path: '/:id/services',
  auth: 'user',
  input: z.undefined(),
  output: z.array(remoteServiceSchema).readonly(),
  run: (_query, _input, context) =>
    withService(context, async service => {
      const target = service.show(context.url.pathParams.id ?? '')
      return service.services(target.id, await materialOf(context, target))
    }),
})

export const restartService = defineOperation({
  id: 'rt.service.restart',
  method: 'POST',
  scheme: 'rt',
  authority: 'targets',
  path: '/:id/services/:name/actions/restart',
  auth: 'user',
  input: z.undefined(),
  output: remoteServiceSchema,
  run: (_query, _input, context) =>
    withService(context, async service => {
      const target = service.show(context.url.pathParams.id ?? '')
      const result = await service.restartService(
        target.id,
        context.url.pathParams.name ?? '',
        await materialOf(context, target),
      )
      context.emit('locus.rt.service.restart.completed', {
        target: target.id,
        service: result.name,
        status: result.status,
      })
      return result
    }),
})
