/** 领域边界的稳定失败；错误码由所属领域解释，不依赖安全或调用协议。 */
export class DomainFailure extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'DomainFailure'
    this.code = code
  }
}
