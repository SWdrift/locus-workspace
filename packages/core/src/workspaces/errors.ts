import { DomainFailure } from '../errors.ts'

export const WORKSPACE_FAILURE_CODES = ['invalid-argument', 'not-found', 'conflict', 'disposed'] as const
export type WorkspaceFailureCode = (typeof WORKSPACE_FAILURE_CODES)[number]

/** Workspace 与挂载用例的已分类失败；数据库异常不属于输入错误。 */
export class WorkspaceFailure extends DomainFailure {
  override readonly kind = 'workspace' as const
  declare readonly code: WorkspaceFailureCode

  constructor(code: WorkspaceFailureCode, message: string) {
    super(code, message)
    this.name = 'WorkspaceFailure'
  }
}
