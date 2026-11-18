import { defineOperation } from '@locus/core/invocation'
import { z } from 'zod'
import { remoteJobResultSchema } from '../schemas.ts'
import { withService } from './context.ts'
import { materialOf } from './credentials.ts'

export const runJob = defineOperation({
  id: 'rt.job.run',
  summary:
    '在路径 id 指定目标上运行 SSH 作业（支持完整 ID、唯一 ID 前缀或唯一标签）；JSON Body 的 command 为命令字符串数组，非交互作业必须非空；可选 interactive:true 改为交互 Shell 并忽略 command，无 query；非交互返回 targetId、exitCode、stdout、stderr，交互仅返回 exitCode。',
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
