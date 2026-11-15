import { createHash } from 'node:crypto'
import type { ComponentCapability, ComponentCredential, ComponentSpec } from '../components/spec.ts'
import { deny } from './errors.ts'
import type { SecurityLevel, SecurityParameters, SecurityRequest } from './types.ts'

interface HostRule {
  readonly resourceType: string
  readonly level: SecurityLevel
}

/** Host 自己的管理能力；普通组件能力不进入固定规则表。 */
const HOST_RULES: Readonly<Record<string, HostRule>> = Object.freeze({
  'credential:manage': { resourceType: 'credential', level: 'root' },
  'capability:manage': { resourceType: 'capability', level: 'root' },
  'system:service:manage': { resourceType: 'service', level: 'root' },
  'root:password:manage': { resourceType: 'security', level: 'root' },
})

export interface BoundComponent {
  readonly componentId: string
  readonly capabilities: readonly ComponentCapability[]
  readonly credentials: readonly ComponentCredential[]
}

function concrete(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim() && !/[\u0000*?[\]]/.test(value)
}

export function assertCredentialRef(value: unknown): asserts value is `credential:${string}` {
  if (typeof value !== 'string' || !/^credential:[a-z][a-z0-9-]*$/.test(value)) deny('invalid-request')
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
    typeof request.capability !== 'string' || !/^[a-z][a-z0-9]*(?:[.:-][a-z0-9]+)*$/.test(request.capability) ||
    request.resource === null || typeof request.resource !== 'object' ||
    !concrete(request.resource.type) || !concrete(request.resource.id)
  ) deny('invalid-request')
  return Object.freeze({
    capability: request.capability,
    resource: Object.freeze({ type: request.resource.type, id: request.resource.id }),
    parameters: snapshotParameters(request.parameters, new Set()),
  })
}

export function operationHash(request: SecurityRequest): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex')
}

function snapshotCapability(value: ComponentCapability): ComponentCapability {
  if (
    typeof value.id !== 'string' || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(value.id) ||
    typeof value.resourceType !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value.resourceType) ||
    (value.defaultAuthLevel !== undefined && value.defaultAuthLevel !== 'user' && value.defaultAuthLevel !== 'root') ||
    (value.secrets !== undefined && !Array.isArray(value.secrets))
  ) deny('invalid-request')
  return Object.freeze({
    id: value.id,
    resourceType: value.resourceType,
    ...(value.defaultAuthLevel === undefined ? {} : { defaultAuthLevel: value.defaultAuthLevel }),
    ...(value.secrets === undefined ? {} : { secrets: Object.freeze(value.secrets.map((secret) => Object.freeze({
      slot: secret.slot,
      access: secret.access,
    }))) }),
  })
}

export function bindTrustedComponent(definition: ComponentSpec): BoundComponent {
  if (definition.kind !== 'locus') deny('untrusted-component')
  const capabilities = (definition.capabilities ?? []).map(snapshotCapability)
  return Object.freeze({
    componentId: definition.id,
    capabilities: Object.freeze(capabilities),
    credentials: Object.freeze((definition.credentials ?? []).map((credential) => Object.freeze({
      id: credential.id,
      fields: Object.freeze(credential.fields.map((field) => Object.freeze({ ...field }))),
    }))),
  })
}

function declarationFor(component: BoundComponent, request: SecurityRequest): ComponentCapability {
  const declaration = component.capabilities.find((value) => (
    value.id === request.capability && value.resourceType === request.resource.type
  ))
  if (declaration !== undefined) return declaration
  if (component.capabilities.some((value) => value.id === request.capability)) deny('resource-mismatch')
  deny('undeclared-capability')
}

/** 解析有效认证等级：Root 覆盖 > 组件 defaultAuthLevel > user。 */
export function requiredLevel(
  component: BoundComponent,
  request: SecurityRequest,
  override: SecurityLevel | undefined,
): SecurityLevel {
  if (component.componentId === 'host') {
    const rule = HOST_RULES[request.capability]
    if (rule === undefined) deny('unsupported-capability')
    if (request.resource.type !== rule.resourceType) deny('resource-mismatch')
    return rule.level
  }
  const declaration = declarationFor(component, request)
  return override ?? declaration.defaultAuthLevel ?? 'user'
}

export function capabilityDeclaration(component: BoundComponent, request: SecurityRequest): ComponentCapability {
  if (component.componentId === 'host') deny('unsupported-capability')
  return declarationFor(component, request)
}

export function declaredSecret(
  declaration: ComponentCapability,
  slot: string,
  access: 'read' | 'write',
): boolean {
  return (declaration.secrets ?? []).some((secret) => secret.slot === slot && secret.access === access)
}

/** 内置 Host 声明逐操作精确资源，不暴露为普通 ComponentSpec 注册路径。 */
export function hostComponent(): BoundComponent {
  return Object.freeze({ componentId: 'host', capabilities: Object.freeze([]), credentials: Object.freeze([]) })
}
