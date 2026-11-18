import { DomainFailure } from '../errors.ts'

export type WorkspaceFailureCode = 'invalid-argument' | 'not-found' | 'conflict' | 'disposed'

/** Workspace 与挂载用例的已分类失败；数据库异常不属于输入错误。 */
export class WorkspaceFailure extends DomainFailure {
  declare readonly code: WorkspaceFailureCode

  constructor(code: WorkspaceFailureCode, message: string) {
    super(code, message)
    this.name = 'WorkspaceFailure'
  }
}
