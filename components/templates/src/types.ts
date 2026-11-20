import type { z } from 'zod'
import type {
  createTemplateResultSchema,
  registerTemplateInputSchema,
  templateDetailSchema,
  templateListSchema,
  templateProblemSchema,
  templateSummarySchema,
  updateTemplateMetadataInputSchema,
} from './schemas.ts'

export type TemplateSummary = z.infer<typeof templateSummarySchema>
export type TemplateSourceKind = TemplateSummary['sourceKind']
export type TemplateProblem = z.infer<typeof templateProblemSchema>
export type TemplateList = z.infer<typeof templateListSchema>
export type TemplateDetail = z.infer<typeof templateDetailSchema>
export type CreateTemplateResult = z.infer<typeof createTemplateResultSchema>
export type RegisterTemplateInput = z.infer<typeof registerTemplateInputSchema>
export type UpdateTemplateMetadataInput = z.infer<typeof updateTemplateMetadataInputSchema>

export interface CreateTemplateOptions {
  /** 目标必须是绝对路径，且当前不存在。 */
  readonly destination: string
  readonly dryRun?: boolean
}

export type TemplateFailureCode =
  | 'invalid-template'
  | 'invalid-id'
  | 'invalid-source'
  | 'invalid-destination'
  | 'not-found'
  | 'destination-exists'
  | 'template-exists'
  | 'template-builtin'
  | 'symlink'
  | 'unsupported-entry'
  | 'io'

export class TemplateFailure extends Error {
  readonly kind = 'domain' as const
  readonly code: TemplateFailureCode

  constructor(code: TemplateFailureCode, message: string) {
    super(message)
    this.name = 'TemplateFailure'
    this.code = code
  }
}

export interface TemplateService {
  list(): Promise<TemplateList>
  detail(id: string): Promise<TemplateDetail>
  register(input: RegisterTemplateInput): Promise<TemplateDetail>
  updateMetadata(id: string, input: UpdateTemplateMetadataInput): Promise<TemplateDetail>
  remove(id: string): Promise<void>
  create(id: string, options: CreateTemplateOptions): Promise<CreateTemplateResult>
}
