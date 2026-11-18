import { defineOperation } from '@locus/core/invocation'
import { z } from 'zod'
import { probeResultSchema } from '../schemas.ts'
import { withService } from './context.ts'
import { materialOf } from './credentials.ts'

export const readSystem = defineOperation({
  id: 'rt.system.read',
  method: 'GET',
  scheme: 'rt',
  authority: 'targets',
  path: '/:id/system',
  auth: 'user',
  input: z.undefined(),
  output: probeResultSchema,
  run: (_query, _input, context) =>
    withService(context, async service => {
      const target = service.show(context.url.pathParams.id ?? '')
      return service.system(target.id, await materialOf(context, target))
    }),
})
