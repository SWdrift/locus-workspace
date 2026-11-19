import { defineOperation, InvocationFailure } from '@locus/core/invocation'
import type { InvocationErrorCode } from '@locus/core/invocation'
import { z } from 'zod'
import { createTemplateService } from './engine.ts'
import { i18n } from './i18n.ts'
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
      throw new InvocationFailure(ERROR_CODES[error.code], error.message, {
        details: { domain: error.code },
        cause: error,
      })
    }
    throw error
  }
}

export const listTemplates = defineOperation({
  id: 'template.templates.list',
  summary: i18n.t('operation.templates.list'),
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
  summary: i18n.t('operation.templates.create'),
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
      if (id === undefined) throw new InvocationFailure('invalid-argument', i18n.t('operation.missing-id'))
      return createTemplateService().create(id, {
        destination: input.destination,
        ...(input.dryRun === true ? { dryRun: true } : {}),
      })
    }),
})
