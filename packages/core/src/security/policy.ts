import { createHash } from 'node:crypto'
import type { ComponentCredential, ComponentSpec } from '../components/types.ts'
import type { OperationMetadata } from '../invocation/types.ts'
import { deny, SecurityFailure } from './errors.ts'
import type {
  CredentialBinding,
  CredentialMetadata,
  CredentialRef,
  OperationLevelRecord,
  RootAuthenticationState,
  SecurityInstallation,
  SecurityLevel,
  SecurityParameters,
  SecurityRequest,
} from './types.ts'

export interface BoundComponent {
  readonly componentId: string
  readonly operations: readonly OperationMetadata[]
  readonly credentials: readonly ComponentCredential[]
}

const CREDENTIAL_REF = /^credential:[a-z0-9][a-z0-9-]*$/
const COMPONENT_ID = /^[a-z][a-z0-9-]{0,63}$/
const OPERATION = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const SLOT = /^[a-z][a-z0-9-]{0,63}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const PROFILE = /^[a-z][a-z0-9-]{0,63}$/
const FIELD_NAME = /^[a-z][a-zA-Z0-9]{0,63}$/
export const RESOURCE_KEY_LIMIT = 2048

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

export function snapshotRequest(request: SecurityRequest): SecurityRequest {
  if (
    request === null ||
    typeof request !== 'object' ||
    typeof request.component !== 'string' ||
    !COMPONENT_ID.test(request.component) ||
    typeof request.operation !== 'string' ||
    !OPERATION.test(request.operation)
  )
    deny('invalid-request')
  return Object.freeze({
    component: request.component,
    operation: request.operation,
    parameters: snapshotParameters(request.parameters, new Set()),
  })
}

export function operationHash(request: SecurityRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        component: request.component,
        operation: request.operation,
        parameters: request.parameters,
      }),
    )
    .digest('hex')
}

export function bindTrustedComponent(definition: ComponentSpec): BoundComponent {
  if (definition.kind !== 'locus') deny('untrusted-component')
  return Object.freeze({
    componentId: definition.id,
    operations: Object.freeze((definition.operations ?? []).map(snapshotOperation)),
    credentials: Object.freeze(
      (definition.credentials ?? []).map(credential =>
        Object.freeze({
          id: credential.id,
          fields: Object.freeze(credential.fields.map(field => Object.freeze({ ...field }))),
        }),
      ),
    ),
  })
}

/** 解析有效认证等级：Root 覆盖 > operation auth；auth none 不可覆盖。 */
export function requiredLevel(
  component: BoundComponent,
  request: SecurityRequest,
  override: SecurityLevel | undefined,
): SecurityLevel {
  const operation = component.operations.find(value => value.id === request.operation)
  if (operation === undefined) deny('unsupported-operation')
  if (operation.auth === 'none') deny('unsupported-operation')
  return override ?? operation.auth
}

export function credentialDeclaration(component: BoundComponent, slot: string): ComponentCredential {
  if (typeof slot !== 'string' || !SLOT.test(slot)) deny('invalid-request')
  const credential = component.credentials.find(value => value.id === slot)
  if (credential === undefined) deny('credential-declaration-mismatch')
  return credential
}

/** 资源 key 最长 2048 个 UTF-16 码元，不接受空值、首尾空白或控制字符。 */
export function isResourceKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= RESOURCE_KEY_LIMIT &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

export function assertResourceKey(value: unknown): string {
  if (!isResourceKey(value)) deny('invalid-resource-key')
  return value
}

export function assertBindingInput(componentId: unknown, slot: unknown, resourceKey: unknown): void {
  if (
    typeof componentId !== 'string' ||
    !COMPONENT_ID.test(componentId) ||
    typeof slot !== 'string' ||
    !SLOT.test(slot)
  ) {
    deny('invalid-request')
  }
  assertResourceKey(resourceKey)
}

/** Store 的非法记录属于存储损坏，不得误报为调用者的资源参数错误。 */
export function corruptSecurityStore(): never {
  throw new SecurityFailure('security-unavailable')
}

export function assertStoredInstallation(value: SecurityInstallation): void {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.installationId !== 'string' ||
    !UUID.test(value.installationId)
  )
    corruptSecurityStore()
}

export function assertStoredRoot(value: RootAuthenticationState): void {
  if (value === null || typeof value !== 'object') corruptSecurityStore()
  const verifier = value.verifier
  if (
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    !Number.isInteger(value.failedAttempts) ||
    value.failedAttempts < 0 ||
    value.failedAttempts > 5 ||
    (value.lockedUntil !== undefined && !timestamp(value.lockedUntil)) ||
    (value.failedAttempts === 5) !== (value.lockedUntil !== undefined) ||
    verifier === null ||
    typeof verifier !== 'object' ||
    verifier.version !== 1 ||
    verifier.algorithm !== 'scrypt' ||
    verifier.N !== 32768 ||
    verifier.r !== 8 ||
    verifier.p !== 1 ||
    verifier.maxmem !== 67108864 ||
    typeof verifier.salt !== 'string' ||
    !/^[0-9a-f]{32}$/.test(verifier.salt) ||
    typeof verifier.derivedKey !== 'string' ||
    !/^[0-9a-f]{64}$/.test(verifier.derivedKey)
  )
    corruptSecurityStore()
  if (
    value.attempt !== undefined &&
    (value.attempt === null ||
      typeof value.attempt !== 'object' ||
      typeof value.attempt.id !== 'string' ||
      !UUID.test(value.attempt.id) ||
      !timestamp(value.attempt.expiresAt) ||
      value.failedAttempts === 0)
  )
    corruptSecurityStore()
}

export function assertStoredProfile(value: string): void {
  if (typeof value !== 'string' || !PROFILE.test(value)) corruptSecurityStore()
}

export function assertStoredReference(value: CredentialRef): void {
  if (!isCredentialRef(value)) corruptSecurityStore()
}

export function assertStoredBindingKey(profile: string, componentId: string, slot: string, resourceKey: string): void {
  assertStoredProfile(profile)
  if (
    typeof componentId !== 'string' ||
    !COMPONENT_ID.test(componentId) ||
    typeof slot !== 'string' ||
    !SLOT.test(slot) ||
    !isResourceKey(resourceKey)
  )
    corruptSecurityStore()
}

export function assertStoredOperationKey(profile: string, componentId: string, operation: string): void {
  assertStoredProfile(profile)
  if (
    typeof componentId !== 'string' ||
    !COMPONENT_ID.test(componentId) ||
    typeof operation !== 'string' ||
    !OPERATION.test(operation)
  )
    corruptSecurityStore()
}

export function assertStoredFields(value: Readonly<Record<string, string>>): void {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    corruptSecurityStore()
  for (const [key, field] of Object.entries(value)) {
    if (!FIELD_NAME.test(key) || typeof field !== 'string') corruptSecurityStore()
  }
}

export function assertStoredMetadata(value: CredentialMetadata): void {
  if (value === null || typeof value !== 'object') corruptSecurityStore()
  assertStoredProfile(value.profile)
  assertStoredReference(value.reference)
  if (typeof value.owner !== 'string' || !COMPONENT_ID.test(value.owner)) corruptSecurityStore()
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId !== value.providerId.trim() ||
    /[\u0000-\u001f\u007f]/.test(value.providerId) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt) ||
    value.updatedAt < value.createdAt
  )
    corruptSecurityStore()
  assertStoredFields(value.fields)
}

export function assertStoredBinding(value: CredentialBinding): void {
  if (value === null || typeof value !== 'object') corruptSecurityStore()
  assertStoredBindingKey(value.profile, value.componentId, value.slot, value.resourceKey)
  assertStoredReference(value.reference)
  if (!timestamp(value.createdAt) || !timestamp(value.updatedAt) || value.updatedAt < value.createdAt)
    corruptSecurityStore()
}

export function assertStoredLevel(value: OperationLevelRecord): void {
  if (value === null || typeof value !== 'object') corruptSecurityStore()
  assertStoredOperationKey(value.profile, value.componentId, value.operation)
  if ((value.level !== 'user' && value.level !== 'root') || !timestamp(value.updatedAt)) corruptSecurityStore()
}

export function compareBindings(left: CredentialBinding, right: CredentialBinding): number {
  return (
    compareText(left.componentId, right.componentId) ||
    compareText(left.slot, right.slot) ||
    compareText(left.resourceKey, right.resourceKey)
  )
}

export function compareOperationLevels(left: OperationLevelRecord, right: OperationLevelRecord): number {
  return compareText(left.componentId, right.componentId) || compareText(left.operation, right.operation)
}

function snapshotParameters(value: SecurityParameters, seen: Set<object>): SecurityParameters {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object' || seen.has(value)) deny('invalid-request')
  seen.add(value)
  try {
    if (Array.isArray(value)) return Object.freeze(value.map(item => snapshotParameters(item, seen)))
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) deny('invalid-request')
    const result: Record<string, SecurityParameters> = Object.create(null) as Record<string, SecurityParameters>
    for (const key of Object.keys(value).sort())
      result[key] = snapshotParameters((value as Record<string, SecurityParameters>)[key]!, seen)
    return Object.freeze(result)
  } finally {
    seen.delete(value)
  }
}

function snapshotOperation(value: OperationMetadata): OperationMetadata {
  if (
    typeof value.id !== 'string' ||
    !OPERATION.test(value.id) ||
    (value.auth !== 'user' && value.auth !== 'root' && value.auth !== 'none') ||
    (value.method !== 'GET' &&
      value.method !== 'POST' &&
      value.method !== 'PUT' &&
      value.method !== 'PATCH' &&
      value.method !== 'DELETE') ||
    typeof value.scheme !== 'string' ||
    typeof value.authority !== 'string' ||
    typeof value.path !== 'string' ||
    (!value.path.startsWith('/') && value.path !== '')
  )
    deny('invalid-request')
  return Object.freeze({
    id: value.id,
    method: value.method,
    scheme: value.scheme,
    authority: value.authority,
    path: value.path,
    auth: value.auth,
  })
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
