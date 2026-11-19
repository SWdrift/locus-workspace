import { z } from 'zod'
import type { ComponentCredential, CredentialField } from '../components/types.ts'
import { i18n } from '../i18n/core.ts'
import type { CredentialValues } from '../security/types.ts'
import { InvocationFailure } from './errors.ts'
import type {
  CredentialDefinition,
  InputField,
  OperationDefinition,
  OperationDescription,
  OperationMetadata,
} from './types.ts'

const CREDENTIAL_SLOT = /^[a-z][a-z0-9-]{0,63}$/
const FIELD_NAME = /^[a-z][a-zA-Z0-9]{0,63}$/
const publicText = z
  .string()
  .min(1)
  .refine(value => value === value.trim() && !value.includes('\0'))
const inputField = z
  .object({
    description: publicText.optional(),
    required: z.boolean().optional(),
    secret: z.boolean().optional(),
    file: z.boolean().optional(),
    tty: z.boolean().optional(),
  })
  .strict()
  .refine(field => field.file !== true || field.tty === true)

/** 公开输出契约与声明复制共用此结构，不读取 schema 内部或执行 handler。 */
export const operationMetadataSchema = z.object({
  id: z.string(),
  summary: publicText.optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  scheme: z.string(),
  authority: z.string(),
  path: z.string(),
  auth: z.enum(['user', 'root', 'none']),
  fields: z.record(z.string().regex(FIELD_NAME), inputField).optional(),
})

/** 类型推导入口；路由冲突与声明合法性由注册阶段检查。 */
export function defineOperation<Q = undefined, I = unknown, O = unknown>(
  definition: OperationDefinition<Q, I, O>,
): OperationDefinition<Q, I, O> {
  return definition
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  )
}

/** 复制公开元数据；未知字段值不能借 fields 混入发现结果。 */
export function snapshotOperationMetadata(operation: OperationMetadata): OperationMetadata {
  if (operation.fields !== undefined) {
    if (!isPlainRecord(operation.fields) || Object.values(operation.fields).some(field => !isPlainRecord(field))) {
      throw new InvocationFailure('invalid-argument', i18n.t('invocation.fields-map', { operation: operation.id }))
    }
  }
  const parsed = operationMetadataSchema.safeParse(operation)
  if (!parsed.success) {
    throw new InvocationFailure('invalid-argument', i18n.t('invocation.metadata-invalid', { operation: operation.id }))
  }
  const metadata = parsed.data
  if (metadata.fields !== undefined) {
    for (const field of Object.values(metadata.fields)) Object.freeze(field)
    Object.freeze(metadata.fields)
  }
  return Object.freeze(metadata)
}

/** Host 可直接从路由表发现能力；此投影没有授权、业务执行或存储副作用。 */
export function describeOperation(operation: OperationMetadata, namespace: string): OperationDescription {
  return Object.freeze({ component: namespace, ...snapshotOperationMetadata(operation) })
}

/** 凭据定义只描述 slot 与字段；秘密字段永不进入公开声明。 */
export function defineCredential(definition: {
  readonly id: string
  readonly fields: readonly (CredentialField & InputField)[]
}): CredentialDefinition {
  if (typeof definition.id !== 'string' || !CREDENTIAL_SLOT.test(definition.id)) {
    throw new Error(i18n.t('credential.slot-invalid'))
  }
  if (!Array.isArray(definition.fields) || definition.fields.length === 0) {
    throw new Error(i18n.t('credential.fields-empty'))
  }
  const names = new Set<string>()
  const declarationFields: CredentialField[] = []
  for (const field of definition.fields) {
    if (typeof field.name !== 'string' || !FIELD_NAME.test(field.name) || names.has(field.name)) {
      throw new Error(i18n.t('credential.field-invalid', { name: String(field.name) }))
    }
    if (typeof field.secret !== 'boolean' || typeof field.required !== 'boolean') {
      throw new Error(i18n.t('credential.field-flags', { field: field.name }))
    }
    if (field.tty !== undefined && typeof field.tty !== 'boolean') {
      throw new Error(i18n.t('credential.field-tty', { field: field.name }))
    }
    names.add(field.name)
    declarationFields.push(Object.freeze({ name: field.name, secret: field.secret, required: field.required }))
  }
  if (!declarationFields.some(field => field.secret)) {
    throw new Error(i18n.t('credential.secret-required'))
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
        if (!isPlainRecord(value)) throw new Error(i18n.t('credential.value-map'))
        const parsed: Record<string, string> = Object.create(null) as Record<string, string>
        for (const [name, item] of Object.entries(value)) {
          const field = declared.get(name)
          if (field === undefined || typeof item !== 'string') {
            throw new Error(i18n.t('credential.field-undeclared', { name }))
          }
          if (item.length === 0) {
            if (field.required) throw new Error(i18n.t('credential.field-empty', { name }))
            continue
          }
          parsed[name] = item
        }
        for (const field of declaration.fields) {
          if (field.required && parsed[field.name] === undefined) {
            throw new Error(i18n.t('credential.field-missing', { field: field.name }))
          }
        }
        return Object.freeze(parsed)
      },
    }),
  })
}
