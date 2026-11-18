import { defineOperation } from '@locus/core/invocation'
import { z } from 'zod'
import { probeResultSchema } from '../schemas.ts'
import { withService } from './context.ts'
import { materialOf } from './credentials.ts'

export const readSystem = defineOperation({
  id: 'rt.system.read',
  summary:
    '通过 SSH 在路径 id 指定目标上执行 hostname 并保存探测记录（支持完整 ID、唯一 ID 前缀或唯一标签），返回 targetId、ok、detail 与 checkedAt；无 query 或 JSON Body。',
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
