export type ComponentFailureCode =
  | 'invalid-spec'
  | 'invalid-definition'
  | 'component-exists'
  | 'component-not-found'
  | 'component-package'
  | 'no-probe'
  | 'no-deploy'
  | 'no-external'
  | 'io'

export class ComponentFailure extends Error {
  readonly code: ComponentFailureCode

  constructor(code: ComponentFailureCode, message: string) {
    super(message)
    this.name = 'ComponentFailure'
    this.code = code
  }
}
