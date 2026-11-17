import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { isCredentialRef } from '@locus/core'
import {
  RemoteTargetsFailure,
  type Capability,
  type RemoteAccess,
  type RemoteConnectivity,
  type RemoteIdentity,
  type RemoteResource,
  type RemoteTarget,
  type RemoteTrust,
  type RemoteShell,
  type TargetVia,
} from './types.ts'
import { parseYamlDocument, stringifyYamlDocument } from './yaml.ts'

type JsonObject = Record<string, unknown>

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
const CAPABILITIES: readonly Capability[] = ['exec', 'shell']
const DOCUMENT_VERSION = 1

function failure(message: string): never {
  throw new RemoteTargetsFailure('invalid-spec', message)
}

function asObject(value: unknown, path: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    failure(`${path} 必须是对象`)
  }
  return value as JsonObject
}

function only(object: JsonObject, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) failure(`${path} 含未知字段：${key}`)
  }
}

function requiredText(object: JsonObject, key: string, path: string): string {
  const value = object[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    failure(`${path}.${key} 必须是非空字符串`)
  }
  return value
}

function optionalText(object: JsonObject, key: string, path: string): string | undefined {
  const value = object[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    failure(`${path}.${key} 必须是非空字符串`)
  }
  return value
}

function optionalInteger(object: JsonObject, key: string, path: string): number | undefined {
  const value = object[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    failure(`${path}.${key} 必须是整数`)
  }
  return value
}

function validateId(id: string): void {
  if (!ID_PATTERN.test(id)) {
    failure(`目标 id 只能包含小写字母、数字、点、下划线和连字符，且以字母或数字开头：${id}`)
  }
}

/** 只允许目标根目录内的相对路径，避免凭据引用逃逸到任意文件。 */
function validateRelativePath(value: string, path: string): void {
  if (isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    failure(`${path} 必须是相对路径：${value}`)
  }
  if (value.split(/[\\/]/).includes('..')) {
    failure(`${path} 不能包含 ..：${value}`)
  }
}

function parseText(text: string): unknown {
  try {
    return parseYamlDocument(text)
  } catch (error) {
    failure(`无法解析配置：${error instanceof Error ? error.message : String(error)}`)
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
  only(auth, ['method', 'credential', 'path', 'root'], `${path}.auth`)
  const method = requiredText(auth, 'method', `${path}.auth`)
  const credential = optionalText(auth, 'credential', `${path}.auth`)
  const credentialPath = optionalText(auth, 'path', `${path}.auth`)
  const credentialRoot = optionalText(auth, 'root', `${path}.auth`)

  if (method === 'private-key' || (method === 'password' && credential !== undefined)) {
    if (method === 'private-key' && credential === undefined) {
      failure(`${path}.auth.credential 在 private-key 认证时必填`)
    }
    if (credential === undefined || !isCredentialRef(credential)) {
      failure(`${path}.auth.credential 必须是 credential:<id> 稳定引用`)
    }
    if (credentialPath !== undefined || credentialRoot !== undefined) {
      failure(`${path}.auth 不能同时提供 credential 与旧 path/root`)
    }
    return { login, auth: { method, credential: credential as `credential:${string}` } }
  }

  if (method !== 'key' && method !== 'password') {
    failure(`${path}.auth.method 只能是 private-key、password 或旧 key：${method}`)
  }
  if (credential !== undefined) failure(`${path}.auth 旧认证方式不能同时提供 credential`)
  const legacyPath = credentialPath
    ?? `credentials/${id}/${method === 'key' ? 'id_ed25519' : 'password'}`
  validateRelativePath(legacyPath, `${path}.auth.path`)
  if (
    credentialRoot !== undefined
    && !isAbsolute(credentialRoot)
    && !/^[A-Za-z]:[\\/]/.test(credentialRoot)
  ) {
    failure(`${path}.auth.root 必须是绝对路径：${credentialRoot}`)
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
  if (!Array.isArray(raw)) failure(`${path}.capabilities 必须是数组`)

  const capabilities: Capability[] = []
  for (const item of raw) {
    if (typeof item !== 'string' || !CAPABILITIES.includes(item as Capability)) {
      failure(`${path}.capabilities 含不支持的能力：${String(item)}`)
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

function normalizeConnectivity(
  value: unknown,
  path: string,
  resource: RemoteResource,
): RemoteConnectivity {
  const object = asObject(value, path)
  only(object, ['transport', 'via', 'host', 'port', 'remoteShell', 'client', 'trust'], path)

  const transport = optionalText(object, 'transport', path) ?? 'ssh'
  if (transport !== 'ssh') {
    throw new RemoteTargetsFailure('unsupported-protocol', `暂不支持协议：${transport}`)
  }

  const via = (optionalText(object, 'via', path) ?? 'direct') as TargetVia
  if (via !== 'direct' && via !== 'frp') failure(`${path}.via 只能是 direct 或 frp：${via}`)

  const host = requiredText(object, 'host', path)
  const port = optionalInteger(object, 'port', path) ?? 22
  if (port < 1 || port > 65535) failure(`${path}.port 必须在 1-65535 之间：${port}`)

  const defaultShell: RemoteShell = resource.kind === 'windows-device' ? 'cmd' : 'posix'
  const remoteShell = (optionalText(object, 'remoteShell', path) ?? defaultShell) as RemoteShell
  if (remoteShell !== 'posix' && remoteShell !== 'cmd') {
    failure(`${path}.remoteShell 只能是 posix 或 cmd：${remoteShell}`)
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

export function normalizeTargetFromSpec(value: unknown, id: string): RemoteTarget {
  validateId(id)
  const object = asObject(value, 'spec')
  only(object, ['id', 'resource', 'identity', 'access', 'connectivity'], 'spec')

  const declaredId = optionalText(object, 'id', 'spec')
  if (declaredId !== undefined && declaredId !== id) {
    failure(`spec.id 与命令参数不一致：${declaredId} != ${id}`)
  }

  const resource = normalizeResource(object.resource, 'spec.resource')
  const identity = normalizeIdentity(object.identity, 'spec.identity', id)
  const access = normalizeAccess(object.access, 'spec.access')
  const connectivity = normalizeConnectivity(object.connectivity, 'spec.connectivity', resource)

  return { id, resource, identity, access, connectivity }
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

export function parseDocument(text: string): readonly RemoteTarget[] {
  const raw = parseText(text)

  const object = asObject(raw, '配置')
  only(object, ['version', 'targets'], '配置')
  if (object.version !== DOCUMENT_VERSION) {
    failure(`配置版本必须是 ${DOCUMENT_VERSION}`)
  }
  if (!Array.isArray(object.targets)) failure('配置.targets 必须是数组')

  const targets = object.targets.map((item, index) => normalizeStoredTarget(item, `targets[${index}]`))
  const ids = new Set<string>()
  for (const target of targets) {
    if (ids.has(target.id)) failure(`目标 id 重复：${target.id}`)
    ids.add(target.id)
  }
  return targets
}

export function parseAddSpecText(text: string, id: string): RemoteTarget {
  return normalizeTargetFromSpec(parseText(text), id)
}

/** 目标安全配置摘要；认证材料与方法由 Core capability/slot 绑定负责，不纳入此摘要。 */
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
      ...(target.connectivity.trust === undefined ? {} : {
        trust: {
          ...(target.connectivity.trust.fingerprint === undefined ? {} : { fingerprint: target.connectivity.trust.fingerprint }),
          ...(target.connectivity.trust.knownHosts === undefined ? {} : { knownHosts: target.connectivity.trust.knownHosts }),
        },
      }),
    },
  }
  return createHash('sha256').update(JSON.stringify(view)).digest('hex')
}

export function serializeDocument(targets: readonly RemoteTarget[]): string {
  return stringifyYamlDocument({ version: DOCUMENT_VERSION, targets }, { lineWidth: 0 })
}
