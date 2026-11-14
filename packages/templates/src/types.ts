export type TemplateSourceKind = 'builtin' | 'local'

export interface TemplateSummary {
  readonly id: string
  readonly name: string
  readonly sourceKind: TemplateSourceKind
  readonly version?: string
  readonly description?: string
}

export interface CreateTemplateOptions {
  /** 目标必须是绝对路径，且当前不存在。 */
  readonly destination: string
  readonly dryRun?: boolean
  readonly parameters?: Readonly<Record<string, string>>
}

export interface CreateTemplateResult {
  readonly destination: string
  readonly template: TemplateSummary
  readonly digest: string
  readonly files: readonly string[]
  readonly directories: readonly string[]
  readonly metadataPath: '.template.json'
  readonly dryRun: boolean
}

export interface TemplateInstanceRecord {
  readonly schema: 'locus.template-instance/v1'
  readonly templateId: string
  readonly templateVersion?: string
  readonly sourceKind: TemplateSourceKind
  readonly sourceDigest: string
  readonly createdAt: string
  readonly parameters: Readonly<Record<string, string>>
}

export type TemplateFailureCode =
  | 'invalid-template'
  | 'invalid-destination'
  | 'not-found'
  | 'destination-exists'
  | 'symlink'
  | 'unsupported-entry'
  | 'io'

export class TemplateFailure extends Error {
  readonly code: TemplateFailureCode

  constructor(code: TemplateFailureCode, message: string) {
    super(message)
    this.name = 'TemplateFailure'
    this.code = code
  }
}

export interface TemplateService {
  list(): Promise<readonly TemplateSummary[]>
  create(template: string, options: CreateTemplateOptions): Promise<CreateTemplateResult>
}
