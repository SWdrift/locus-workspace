import { createHash } from 'node:crypto'
import type { ComponentCredential, ComponentSpec } from '../components/spec.ts'
import type { OperationMetadata } from '../invocation.ts'
import { deny } from './errors.ts'
import type { CredentialRef, SecurityLevel, SecurityParameters, SecurityRequest } from './types.ts'

export interface BoundComponent {
  readonly componentId: string
  readonly operations: readonly OperationMetadata[]
  readonly credentials: readonly ComponentCredential[]
}

const CREDENTIAL_REF = /^credential:[a-z0-9][a-z0-9-]*$/
const COMPONENT_ID = /^[a-z][a-z0-9-]{0,63}$/
const OPERATION = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const SLOT = /^[a-z][a-z0-9-]{0,63}$/

export function assertCredentialRef(value: unknown): asserts value is `credential:${string}` {
  if (typeof value !== 'string' || !CREDENTIAL_REF.test(value)) deny('invalid-request')
}

/** Core 是 CredentialRef 的唯一解析入口；Compose 不各自维护引用格式。 */
export function parseCredentialRef(value: unknown): CredentialRef {
  assertCredentialRef(value)
  return value
}

export function isCredentialRef(value: unknown): value is CredentialRef {
  return typeof value === 'string' && CREDENTIAL_REF.test(value)
}

function snapshotParameters(value: SecurityParameters, seen: Set<object>): SecurityParameters {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object' || seen.has(value)) deny('invalid-request')
  seen.add(value)
  try {
    if (Array.isArray(value)) return Object.freeze(value.map((item) => snapshotParameters(item, seen)))
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) deny('invalid-request')
    const result: Record<string, SecurityParameters> = Object.create(null) as Record<string, SecurityParameters>
    for (const key of Object.keys(value).sort()) result[key] = snapshotParameters((value as Record<string, SecurityParameters>)[key]!, seen)
    return Object.freeze(result)
  } finally {
    seen.delete(value)
  }
}

export function snapshotRequest(request: SecurityRequest): SecurityRequest {
  if (
    request === null || typeof request !== 'object' ||
    typeof request.component !== 'string' || !COMPONENT_ID.test(request.component) ||
    typeof request.operation !== 'string' || !OPERATION.test(request.operation)
  ) deny('invalid-request')
  return Object.freeze({
    component: request.component,
    operation: request.operation,
    parameters: snapshotParameters(request.parameters, new Set()),
  })
}

export function operationHash(request: SecurityRequest): string {
  return createHash('sha256').update(JSON.stringify({
    component: request.component,
    operation: request.operation,
    parameters: request.parameters,
  })).digest('hex')
}

function snapshotOperation(value: OperationMetadata): OperationMetadata {
  if (
    typeof value.id !== 'string' || !OPERATION.test(value.id) ||
    (value.auth !== 'user' && value.auth !== 'root' && value.auth !== 'none') ||
    (value.method !== 'GET' && value.method !== 'POST' && value.method !== 'PUT' &&
      value.method !== 'PATCH' && value.method !== 'DELETE') ||
    typeof value.scheme !== 'string' || typeof value.authority !== 'string' ||
    typeof value.path !== 'string' || !value.path.startsWith('/') && value.path !== ''
  ) deny('invalid-request')
  return Object.freeze({
    id: value.id,
    method: value.method,
    scheme: value.scheme,
    authority: value.authority,
    path: value.path,
    auth: value.auth,
  })
}

export function bindTrustedComponent(definition: ComponentSpec): BoundComponent {
  if (definition.kind !== 'locus') deny('untrusted-component')
  return Object.freeze({
    componentId: definition.id,
    operations: Object.freeze((definition.operations ?? []).map(snapshotOperation)),
    credentials: Object.freeze((definition.credentials ?? []).map((credential) => Object.freeze({
      id: credential.id,
      fields: Object.freeze(credential.fields.map((field) => Object.freeze({ ...field }))),
    }))),
  })
}

/** 解析有效认证等级：Root 覆盖 > operation auth；auth none 不可覆盖。 */
export function requiredLevel(
  component: BoundComponent,
  request: SecurityRequest,
  override: SecurityLevel | undefined,
): SecurityLevel {
  const operation = component.operations.find((value) => value.id === request.operation)
  if (operation === undefined) deny('unsupported-operation')
  if (operation.auth === 'none') deny('unsupported-operation')
  return override ?? operation.auth
}

export function credentialDeclaration(component: BoundComponent, slot: string): ComponentCredential {
  if (typeof slot !== 'string' || !SLOT.test(slot)) deny('invalid-request')
  const credential = component.credentials.find((value) => value.id === slot)
  if (credential === undefined) deny('credential-declaration-mismatch')
  return credential
}

/** 资源 key 由 handler 显式提供；只拒绝空值、首尾空白、NUL 与控制字符。 */
export function assertResourceKey(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) deny('invalid-resource-key')
  return value
}
