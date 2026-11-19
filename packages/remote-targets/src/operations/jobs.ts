import { defineOperation } from '@locus/core/invocation'
import { z } from 'zod'
import { i18n } from '../i18n.ts'
import { remoteJobResultSchema } from '../schemas.ts'
import { withService } from './context.ts'
import { materialOf } from './credentials.ts'

export const runJob = defineOperation({
  id: 'rt.job.run',
  summary: i18n.t('operation.job.run'),
  method: 'POST',
  scheme: 'rt',
  authority: 'targets',
  path: '/:id/jobs',
  auth: 'user',
  input: z.object({
    command: z.array(z.string()).optional(),
    interactive: z.boolean().optional(),
  }),
  output: remoteJobResultSchema,
  run: (_query, input, context) =>
    withService(context, async service => {
      const target = service.show(context.url.pathParams.id ?? '')
      const material = await materialOf(context, target)
      if (input.interactive === true) {
        const exitCode = await service.shell(target.id, material)
        context.emit('locus.rt.job.completed', { target: target.id, exitCode, interactive: true })
        return { exitCode }
      }
      const result = await service.exec(target.id, input.command ?? [], material)
      context.emit('locus.rt.job.completed', { target: target.id, exitCode: result.exitCode })
      return result
    }),
})
