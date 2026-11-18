import type { ComponentCredential, CredentialField } from '../components/types.ts'
import type { CredentialValues } from '../security/types.ts'
import type { CredentialDefinition, InputField, OperationDefinition } from './types.ts'

/** 类型推导入口；路由冲突与声明合法性由注册阶段检查。 */
export function defineOperation<Q = undefined, I = unknown, O = unknown>(
  definition: OperationDefinition<Q, I, O>,
): OperationDefinition<Q, I, O> {
  return definition
}

const CREDENTIAL_SLOT = /^[a-z][a-z0-9-]{0,63}$/
const FIELD_NAME = /^[a-z][a-zA-Z0-9]{0,63}$/

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  )
}

/** 凭据定义只描述 slot 与字段；秘密字段永不进入公开声明。 */
export function defineCredential(definition: {
  readonly id: string
  readonly fields: readonly (CredentialField & InputField)[]
}): CredentialDefinition {
  if (typeof definition.id !== 'string' || !CREDENTIAL_SLOT.test(definition.id)) {
    throw new Error('凭据 slot 必须以小写字母开头，只包含小写字母、数字和短横线，最长 64 字符')
  }
  if (!Array.isArray(definition.fields) || definition.fields.length === 0) {
    throw new Error('凭据字段必须是非空数组')
  }
  const names = new Set<string>()
  const declarationFields: CredentialField[] = []
  for (const field of definition.fields) {
    if (typeof field.name !== 'string' || !FIELD_NAME.test(field.name) || names.has(field.name)) {
      throw new Error(`凭据字段名无效或重复：${String(field.name)}`)
    }
    if (typeof field.secret !== 'boolean' || typeof field.required !== 'boolean') {
      throw new Error(`凭据字段 ${field.name} 必须声明 secret 与 required`)
    }
    if (field.tty !== undefined && typeof field.tty !== 'boolean') {
      throw new Error(`凭据字段 ${field.name} 的 tty 必须是布尔值`)
    }
    names.add(field.name)
    declarationFields.push(Object.freeze({ name: field.name, secret: field.secret, required: field.required }))
  }
  if (!declarationFields.some(field => field.secret)) {
    throw new Error('凭据至少需要一个 secret 字段')
  }
  const declaration: ComponentCredential = Object.freeze({
    id: definition.id,
    fields: Object.freeze(declarationFields),
  })
  const declared = new Map(declaration.fields.map(field => [field.name, field]))
  return Object.freeze({
    id: definition.id,
    declaration,
    secretFields: Object.freeze(declaration.fields.filter(field => field.secret).map(field => field.name)),
    input: Object.freeze({
      parse(value: unknown): CredentialValues {
        if (!isPlainRecord(value)) throw new Error('凭据值必须是映射')
        const parsed: Record<string, string> = Object.create(null) as Record<string, string>
        for (const [name, item] of Object.entries(value)) {
          const field = declared.get(name)
          if (field === undefined || typeof item !== 'string') {
            throw new Error(`凭据包含未声明或非字符串字段：${name}`)
          }
          if (item.length === 0) {
            if (field.required) throw new Error(`凭据字段不能为空：${name}`)
            continue
          }
          parsed[name] = item
        }
        for (const field of declaration.fields) {
          if (field.required && parsed[field.name] === undefined) {
            throw new Error(`缺少必填凭据字段：${field.name}`)
          }
        }
        return Object.freeze(parsed)
      },
    }),
  })
}
