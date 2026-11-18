import { z } from 'zod'

export const templateSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  sourceKind: z.enum(['builtin', 'local']),
  version: z.string().optional(),
  description: z.string().optional(),
})

export const createTemplateResultSchema = z.object({
  destination: z.string(),
  template: templateSummarySchema,
  digest: z.string(),
  files: z.array(z.string()).readonly(),
  directories: z.array(z.string()).readonly(),
  metadataPath: z.literal('.template.json'),
  dryRun: z.boolean(),
})
