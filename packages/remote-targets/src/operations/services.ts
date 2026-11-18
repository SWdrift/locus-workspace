import { defineOperation } from '@locus/core/invocation'
import { z } from 'zod'
import { remoteServiceSchema } from '../schemas.ts'
import { withService } from './context.ts'
import { materialOf } from './credentials.ts'

export const listServices = defineOperation({
  id: 'rt.services.list',
  summary:
    '通过 SSH 读取路径 id 指定 Windows 目标的服务列表（支持完整 ID、唯一 ID 前缀或唯一标签，要求 cmd 远程 Shell），返回 name/status 数组；无 query 或 JSON Body。',
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
  summary:
    '通过 SSH 重启路径 id 指定 Windows 目标上路径 name 指定的服务（id 支持完整 ID、唯一 ID 前缀或唯一标签，要求 cmd 远程 Shell），返回重启后的 name/status；无 query 或 JSON Body。',
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
