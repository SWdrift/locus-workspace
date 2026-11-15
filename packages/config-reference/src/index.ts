import { isAbsolute } from 'node:path'

/** 配置中的稳定凭据引用；不是秘密，也不是 Keyring 账户名。 */
export type CredentialRef = `credential:${string}`

export type ConfigReferenceFailureCode = 'invalid-reference'

export class ConfigReferenceFailure extends Error {
  readonly code: ConfigReferenceFailureCode

  constructor(message: string) {
    super(message)
    this.name = 'ConfigReferenceFailure'
    this.code = 'invalid-reference'
  }
}

const CREDENTIAL_REF = /^credential:[a-z][a-z0-9-]*$/

/** 解析并校验稳定引用；拒绝路径、空白、通配与其它协议。 */
export function parseCredentialRef(value: unknown): CredentialRef {
  if (typeof value !== 'string' || !CREDENTIAL_REF.test(value)) {
    throw new ConfigReferenceFailure('凭据引用必须是 credential:<id>，id 只包含小写字母、数字和短横线')
  }
  return value as CredentialRef
}

export function isCredentialRef(value: unknown): value is CredentialRef {
  return typeof value === 'string' && CREDENTIAL_REF.test(value)
}

/** 从普通配置对象读取 credential 字段；不读取文件，也不访问 Keyring。 */
export function resolveCredentialRef(config: unknown, field = 'credential'): CredentialRef {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new ConfigReferenceFailure('配置必须是映射')
  }
  if (!Object.hasOwn(config, field)) {
    throw new ConfigReferenceFailure(`配置缺少 ${field}`)
  }
  return parseCredentialRef((config as Record<string, unknown>)[field])
}

/** 配置路径必须是相对数据目录的安全路径；不在这里解析真实文件系统。 */
export function assertConfigPath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new ConfigReferenceFailure('配置路径必须是非空字符串且没有首尾空白')
  }
  if (isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.includes('\0')) {
    throw new ConfigReferenceFailure('配置路径必须是相对路径')
  }
  const segments = value.split(/[\\/]+/).filter((segment) => segment.length > 0)
  if (segments.length === 0 || segments.some((segment) => segment === '..')) {
    throw new ConfigReferenceFailure('配置路径不能为空或包含 ..')
  }
  return value
}
