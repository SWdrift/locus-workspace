import { defineOperation, InvocationFailure } from '@locus/core/invocation'
import type { InvocationErrorCode } from '@locus/core/invocation'
import { z } from 'zod'
import { createTemplateService } from './engine.ts'
import { createTemplateResultSchema, templateSummarySchema } from './schemas.ts'
import { TemplateFailure } from './types.ts'
import type { TemplateFailureCode } from './types.ts'

const ERROR_CODES: Readonly<Record<TemplateFailureCode, InvocationErrorCode>> = {
  'invalid-template': 'invalid-argument',
  'invalid-destination': 'invalid-argument',
  'not-found': 'not-found',
  'destination-exists': 'conflict',
  symlink: 'invalid-argument',
  'unsupported-entry': 'invalid-argument',
  io: 'internal',
}

async function atOperationBoundary<T>(consume: () => Promise<T>): Promise<T> {
  try {
    return await consume()
  } catch (error) {
    if (error instanceof TemplateFailure) {
      throw new InvocationFailure(ERROR_CODES[error.code], error.message, { domain: error.code })
    }
    throw error
  }
}

export const listTemplates = defineOperation({
  id: 'template.templates.list',
  summary:
    '列出可用内置模板的摘要数组（id、name、sourceKind 及可选 version/description）；无路径参数、query 或 JSON Body。',
  method: 'GET',
  scheme: 'template',
  authority: 'templates',
  path: '',
  auth: 'user',
  input: z.undefined(),
  output: z.array(templateSummarySchema).readonly(),
  run: () => atOperationBoundary(() => createTemplateService().list()),
})

export const createTemplateInstance = defineOperation({
  id: 'template.templates.create',
  summary:
    '从路径 id 指定的内置模板或本机模板目录创建实例；JSON Body 必填 destination（目标绝对路径），可选 dryRun:true 只预检不写入，无 query；返回模板摘要、目标路径、摘要 digest、文件/目录清单与实例记录路径 .template.json。',
  method: 'POST',
  scheme: 'template',
  authority: 'templates',
  path: '/:id/instances',
  auth: 'user',
  input: z.object({
    destination: z.string(),
    dryRun: z.boolean().optional(),
  }),
  output: createTemplateResultSchema,
  run: (_query, input, context) =>
    atOperationBoundary(async () => {
      const id = context.url.pathParams.id
      if (id === undefined) throw new InvocationFailure('invalid-argument', '缺少路径参数 id')
      return createTemplateService().create(id, {
        destination: input.destination,
        ...(input.dryRun === true ? { dryRun: true } : {}),
      })
    }),
})
