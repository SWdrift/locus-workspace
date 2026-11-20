import { z } from 'zod'

export const templateSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  sourceKind: z.enum(['builtin', 'user']),
  version: z.string().optional(),
  description: z.string().optional(),
})

export const templateProblemSchema = z.object({
  id: z.string(),
  path: z.string(),
  message: z.string(),
})

export const templateListSchema = z.object({
  templates: z.array(templateSummarySchema).readonly(),
  problems: z.array(templateProblemSchema).readonly(),
})

export const templateDetailSchema = templateSummarySchema.extend({
  digest: z.string(),
  fileCount: z.number().int().nonnegative(),
  directoryCount: z.number().int().nonnegative(),
})

export const createTemplateResultSchema = z.object({
  destination: z.string(),
  template: templateSummarySchema,
  digest: z.string(),
  files: z.array(z.string()).readonly(),
  directories: z.array(z.string()).readonly(),
  dryRun: z.boolean(),
})

export const registerTemplateInputSchema = z.object({
  id: z.string(),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('path'), path: z.string() }),
    z.object({ kind: z.literal('builtin'), id: z.string() }),
  ]),
})

export const updateTemplateMetadataInputSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
})

export const removeTemplateResultSchema = z.object({
  id: z.string(),
  removed: z.literal(true),
})
