import { defineOperation } from '@locus/core/invocation'
import { z } from 'zod'
import { migrationSourceSchema, registerInputSchema, remoteTargetSchema, remoteTargetViewSchema } from '../schemas.ts'
import { withService } from './context.ts'
import { credentialFields, secretOf, slotOf, writeCredential } from './credentials.ts'

export const listTargets = defineOperation({
  id: 'rt.targets.list',
  summary: '列出已登记的远程目标配置数组（不含秘密）；无路径参数、query 或 JSON Body。',
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
  summary:
    '读取路径 id 指定的目标（支持完整 ID、唯一 ID 前缀或唯一标签），返回配置及可用的最近探测结果；无 query 或 JSON Body。',
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
  summary:
    '预检路径 id 指定的新目标；JSON Body 必填 spec（单个目标的 YAML/JSON 文本，含 resource、identity.login、identity.auth.method 和 connectivity.host；认证方式为 private-key 或 password），无 query；返回规范化配置，不保存目标或凭据。',
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
  summary:
    '读取路径 id 指定目标的旧凭据来源（支持完整 ID、唯一 ID 前缀或唯一标签），返回旧认证方式 method 与文件绝对路径 path，不读取秘密；无 query 或 JSON Body。',
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
  summary:
    '登记路径 id 指定的新目标并绑定凭据；JSON Body 必填 spec（单个目标的 YAML/JSON 文本，含 resource、identity.login、identity.auth.method 和 connectivity.host；认证方式为 private-key 或 password），对应秘密由可信输入提供，无 query；返回保存后的规范化目标，已有 ID 不可覆盖。',
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
  summary:
    '删除路径 id 指定的目标配置与探测记录（支持完整 ID、唯一 ID 前缀或唯一标签），返回 target 与 removed:true；无 query 或 JSON Body。',
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
