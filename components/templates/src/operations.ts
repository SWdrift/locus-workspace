import { defineOperation, InvocationFailure } from '@locus/core/invocation'
import type { InvocationErrorCode } from '@locus/core/invocation'
import { z } from 'zod'
import { createTemplateService } from './engine.ts'
import { i18n } from './i18n.ts'
import {
  createTemplateResultSchema,
  registerTemplateInputSchema,
  removeTemplateResultSchema,
  templateDetailSchema,
  templateListSchema,
  updateTemplateMetadataInputSchema,
} from './schemas.ts'
import { TemplateFailure } from './types.ts'
import type { TemplateFailureCode } from './types.ts'

const ERROR_CODES: Readonly<Record<TemplateFailureCode, InvocationErrorCode>> = {
  'invalid-template': 'invalid-argument',
  'invalid-id': 'invalid-argument',
  'invalid-source': 'invalid-argument',
  'invalid-destination': 'invalid-argument',
  'not-found': 'not-found',
  'destination-exists': 'conflict',
  'template-exists': 'conflict',
  'template-builtin': 'forbidden',
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

function service(context: { readonly dataDirectory: string }) {
  return createTemplateService({ dataDirectory: context.dataDirectory })
}

function templateId(context: { readonly url: { readonly pathParams: Readonly<Record<string, string>> } }): string {
  const id = context.url.pathParams.id
  if (id === undefined) throw new InvocationFailure('invalid-argument', i18n.t('operation.missing-id'))
  return id
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
  output: templateListSchema,
  run: (_query, _input, context) => atOperationBoundary(() => service(context).list()),
})

export const getTemplate = defineOperation({
  id: 'template.templates.get',
  summary: i18n.t('operation.templates.get'),
  method: 'GET',
  scheme: 'template',
  authority: 'templates',
  path: '/:id',
  auth: 'user',
  input: z.undefined(),
  output: templateDetailSchema,
  run: (_query, _input, context) => atOperationBoundary(() => service(context).detail(templateId(context))),
})

export const registerTemplate = defineOperation({
  id: 'template.templates.register',
  summary: i18n.t('operation.templates.register'),
  method: 'POST',
  scheme: 'template',
  authority: 'templates',
  path: '',
  auth: 'user',
  input: registerTemplateInputSchema,
  output: templateDetailSchema,
  run: (_query, input, context) => atOperationBoundary(() => service(context).register(input)),
})

export const updateTemplateMetadata = defineOperation({
  id: 'template.templates.metadata',
  summary: i18n.t('operation.templates.metadata'),
  method: 'PATCH',
  scheme: 'template',
  authority: 'templates',
  path: '/:id',
  auth: 'user',
  input: updateTemplateMetadataInputSchema,
  output: templateDetailSchema,
  run: (_query, input, context) =>
    atOperationBoundary(() => service(context).updateMetadata(templateId(context), input)),
})

export const removeTemplate = defineOperation({
  id: 'template.templates.remove',
  summary: i18n.t('operation.templates.remove'),
  method: 'DELETE',
  scheme: 'template',
  authority: 'templates',
  path: '/:id',
  auth: 'user',
  input: z.undefined(),
  output: removeTemplateResultSchema,
  run: (_query, _input, context) =>
    atOperationBoundary(async () => {
      const id = templateId(context)
      await service(context).remove(id)
      return { id, removed: true as const }
    }),
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
    atOperationBoundary(() =>
      service(context).create(templateId(context), {
        destination: input.destination,
        ...(input.dryRun === true ? { dryRun: true } : {}),
      }),
    ),
})
