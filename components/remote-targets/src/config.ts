import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { i18n } from './i18n.ts'
import { RemoteTargetsFailure } from './types.ts'
import type {
  Capability,
  RemoteAccess,
  RemoteConnectivity,
  RemoteIdentity,
  RemoteResource,
  RemoteTarget,
  RemoteTrust,
  RemoteShell,
  TargetVia,
} from './types.ts'

type JsonObject = Record<string, unknown>

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
const CAPABILITIES: readonly Capability[] = ['exec', 'shell']
const DOCUMENT_VERSION = 1

export function normalizeTargetFromSpec(value: unknown, id: string): RemoteTarget {
  validateId(id)
  const object = asObject(value, 'spec')
  only(object, ['id', 'resource', 'identity', 'access', 'connectivity'], 'spec')

  const declaredId = optionalText(object, 'id', 'spec')
  if (declaredId !== undefined && declaredId !== id) {
    failure(i18n.t('config.id-mismatch', { actual: declaredId, expected: id }))
  }

  const resource = normalizeResource(object.resource, 'spec.resource')
  const identity = normalizeIdentity(object.identity, 'spec.identity', id)
  const access = normalizeAccess(object.access, 'spec.access')
  const connectivity = normalizeConnectivity(object.connectivity, 'spec.connectivity', resource)

  return { id, resource, identity, access, connectivity }
}

export function parseDocument(text: string): readonly RemoteTarget[] {
  const raw = parseText(text)

  const configLabel = i18n.t('label.config')
  const object = asObject(raw, configLabel)
  only(object, ['version', 'targets'], configLabel)
  if (object.version !== DOCUMENT_VERSION) {
    failure(i18n.t('config.version-required', { version: DOCUMENT_VERSION }))
  }
  if (!Array.isArray(object.targets)) failure(i18n.t('config.targets-array'))

  const targets = object.targets.map((item, index) => normalizeStoredTarget(item, `targets[${index}]`))
  const ids = new Set<string>()
  for (const target of targets) {
    if (ids.has(target.id)) failure(i18n.t('config.target-id-duplicate', { id: target.id }))
    ids.add(target.id)
  }
  return targets
}

export function parseAddSpecText(text: string, id: string): RemoteTarget {
  return normalizeTargetFromSpec(parseText(text), id)
}

/** 目标安全配置摘要；凭据由 Core 按 component + slot + resourceKey 绑定，不纳入此摘要。 */
export function targetBinding(target: RemoteTarget): string {
  const view = {
    resource: { kind: target.resource.kind },
    identity: { login: target.identity.login },
    access: { capabilities: [...target.access.capabilities].sort() },
    connectivity: {
      transport: target.connectivity.transport,
      host: target.connectivity.host,
      port: target.connectivity.port,
      remoteShell: target.connectivity.remoteShell,
      ...(target.connectivity.client === undefined ? {} : { client: target.connectivity.client }),
      ...(target.connectivity.trust === undefined
        ? {}
        : {
            trust: {
              ...(target.connectivity.trust.fingerprint === undefined
                ? {}
                : { fingerprint: target.connectivity.trust.fingerprint }),
              ...(target.connectivity.trust.knownHosts === undefined
                ? {}
                : { knownHosts: target.connectivity.trust.knownHosts }),
            },
          }),
    },
  }
  return createHash('sha256').update(JSON.stringify(view)).digest('hex')
}

export function serializeDocument(targets: readonly RemoteTarget[]): string {
  return stringifyYaml({ version: DOCUMENT_VERSION, targets }, { lineWidth: 0 })
}

function failure(message: string): never {
  throw new RemoteTargetsFailure('invalid-spec', message)
}

function asObject(value: unknown, path: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    failure(i18n.t('config.object-required', { path }))
  }
  return value as JsonObject
}

function only(object: JsonObject, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) failure(i18n.t('config.unknown-field', { path, key }))
  }
}

function requiredText(object: JsonObject, key: string, path: string): string {
  const value = object[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    failure(i18n.t('config.non-empty-string', { path, key }))
  }
  return value
}

function optionalText(object: JsonObject, key: string, path: string): string | undefined {
  const value = object[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    failure(i18n.t('config.non-empty-string', { path, key }))
  }
  return value
}

function optionalInteger(object: JsonObject, key: string, path: string): number | undefined {
  const value = object[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    failure(i18n.t('config.integer-required', { path, key }))
  }
  return value
}

function validateId(id: string): void {
  if (!ID_PATTERN.test(id)) {
    failure(i18n.t('config.id-invalid', { id }))
  }
}

/** 只允许目标根目录内的相对路径，避免凭据引用逃逸到任意文件。 */
function validateRelativePath(value: string, path: string): void {
  if (isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    failure(i18n.t('config.relative-path', { path, value }))
  }
  if (value.split(/[\\/]/).includes('..')) {
    failure(i18n.t('config.path-traversal', { path, value }))
  }
}

function parseText(text: string): unknown {
  try {
    return parseYaml(text)
  } catch (error) {
    failure(i18n.t('config.parse-failed', { detail: error instanceof Error ? error.message : String(error) }))
  }
}

function normalizeResource(value: unknown, path: string): RemoteResource {
  const object = asObject(value, path)
  only(object, ['kind', 'label'], path)
  const kind = optionalText(object, 'kind', path) ?? 'server'
  const label = optionalText(object, 'label', path)
  return label === undefined ? { kind } : { kind, label }
}

function normalizeIdentity(value: unknown, path: string, id: string): RemoteIdentity {
  const object = asObject(value, path)
  only(object, ['login', 'auth'], path)
  const login = requiredText(object, 'login', path)

  const auth = asObject(object.auth, `${path}.auth`)
  only(auth, ['method', 'path', 'root'], `${path}.auth`)
  const method = requiredText(auth, 'method', `${path}.auth`)
  const credentialPath = optionalText(auth, 'path', `${path}.auth`)
  const credentialRoot = optionalText(auth, 'root', `${path}.auth`)

  if (
    method === 'private-key' ||
    (method === 'password' && credentialPath === undefined && credentialRoot === undefined)
  ) {
    if (credentialPath !== undefined || credentialRoot !== undefined) {
      failure(i18n.t('config.auth-legacy-fields', { path }))
    }
    return { login, auth: { method } }
  }

  if (method !== 'key' && method !== 'password') {
    failure(i18n.t('config.auth-method', { path, method }))
  }
  const legacyPath = credentialPath ?? `credentials/${id}/${method === 'key' ? 'id_ed25519' : 'password'}`
  validateRelativePath(legacyPath, `${path}.auth.path`)
  if (credentialRoot !== undefined && !isAbsolute(credentialRoot) && !/^[A-Za-z]:[\\/]/.test(credentialRoot)) {
    failure(i18n.t('config.auth-root-absolute', { path, root: credentialRoot }))
  }
  return {
    login,
    auth: {
      method,
      path: legacyPath,
      ...(credentialRoot === undefined ? {} : { root: credentialRoot }),
    },
  }
}

function normalizeAccess(value: unknown, path: string): RemoteAccess {
  if (value === undefined) return { capabilities: [...CAPABILITIES] }
  const object = asObject(value, path)
  only(object, ['capabilities'], path)
  const raw = object.capabilities
  if (raw === undefined) return { capabilities: [...CAPABILITIES] }
  if (!Array.isArray(raw)) failure(i18n.t('config.capabilities-array', { path }))

  const capabilities: Capability[] = []
  for (const item of raw) {
    if (typeof item !== 'string' || !CAPABILITIES.includes(item as Capability)) {
      failure(i18n.t('config.capability-invalid', { path, capability: String(item) }))
    }
    const capability = item as Capability
    if (!capabilities.includes(capability)) capabilities.push(capability)
  }
  return { capabilities }
}

function normalizeTrust(value: unknown, path: string): RemoteTrust | undefined {
  if (value === undefined) return undefined
  const object = asObject(value, path)
  only(object, ['fingerprint', 'knownHosts'], path)
  const fingerprint = optionalText(object, 'fingerprint', path)
  const knownHosts = optionalText(object, 'knownHosts', path)
  if (knownHosts !== undefined) validateRelativePath(knownHosts, `${path}.knownHosts`)
  if (fingerprint === undefined && knownHosts === undefined) return undefined
  return {
    ...(fingerprint === undefined ? {} : { fingerprint }),
    ...(knownHosts === undefined ? {} : { knownHosts }),
  }
}

function normalizeConnectivity(value: unknown, path: string, resource: RemoteResource): RemoteConnectivity {
  const object = asObject(value, path)
  only(object, ['transport', 'via', 'host', 'port', 'remoteShell', 'client', 'trust'], path)

  const transport = optionalText(object, 'transport', path) ?? 'ssh'
  if (transport !== 'ssh') {
    throw new RemoteTargetsFailure('unsupported-protocol', i18n.t('config.protocol-unsupported', { transport }))
  }

  const via = (optionalText(object, 'via', path) ?? 'direct') as TargetVia
  if (via !== 'direct' && via !== 'frp') failure(i18n.t('config.via-invalid', { path, via }))

  const host = requiredText(object, 'host', path)
  const port = optionalInteger(object, 'port', path) ?? 22
  if (port < 1 || port > 65535) failure(i18n.t('config.port-range', { path, port }))

  const defaultShell: RemoteShell = resource.kind === 'windows-device' ? 'cmd' : 'posix'
  const remoteShell = (optionalText(object, 'remoteShell', path) ?? defaultShell) as RemoteShell
  if (remoteShell !== 'posix' && remoteShell !== 'cmd') {
    failure(i18n.t('config.remote-shell', { path, shell: remoteShell }))
  }

  const client = optionalText(object, 'client', path)
  const trust = normalizeTrust(object.trust, `${path}.trust`)

  return {
    transport,
    via,
    host,
    port,
    remoteShell,
    ...(client === undefined ? {} : { client }),
    ...(trust === undefined ? {} : { trust }),
  }
}

function normalizeStoredTarget(value: unknown, path: string): RemoteTarget {
  const object = asObject(value, path)
  only(object, ['id', 'resource', 'identity', 'access', 'connectivity'], path)
  const id = requiredText(object, 'id', path)
  validateId(id)

  const resource = normalizeResource(object.resource, `${path}.resource`)
  const identity = normalizeIdentity(object.identity, `${path}.identity`, id)
  const access = normalizeAccess(object.access, `${path}.access`)
  const connectivity = normalizeConnectivity(object.connectivity, `${path}.connectivity`, resource)

  return { id, resource, identity, access, connectivity }
}
