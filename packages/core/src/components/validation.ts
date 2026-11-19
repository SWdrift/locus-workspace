import { isAbsolute } from 'node:path'
import { i18n } from '../i18n/core.ts'
import { InvocationFailure } from '../invocation/errors.ts'
import { snapshotOperationMetadata } from '../invocation/operation.ts'
import type { LocusMethod, OperationDefinition, OperationMetadata } from '../invocation/types.ts'
import { ComponentFailure } from './errors.ts'
import type {
  ComponentConfig,
  ComponentCredential,
  ComponentDeploy,
  ComponentInfo,
  ComponentProbe,
  ComponentSpec,
  CredentialField,
} from './types.ts'

const COMPONENT_ID = /^[a-z][a-z0-9-]{0,63}$/
const OPERATION = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const SCHEME = /^[a-z][a-z0-9+.-]*$/
const AUTHORITY = /^[a-z0-9][a-z0-9.-]*(?::\d+)?$/
const CREDENTIAL_ID = /^[a-z][a-z0-9-]{0,63}$/
const FIELD_NAME = /^[a-z][a-zA-Z0-9]{0,63}$/
const METHODS: readonly LocusMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const SPEC_KEYS: Record<string, true> = {
  id: true,
  version: true,
  name: true,
  summary: true,
  kind: true,
  requires: true,
  operations: true,
  credentials: true,
  config: true,
  probe: true,
  deploy: true,
  info: true,
}
const ARGV_PROBE_KEYS: Record<string, true> = {
  kind: true,
  argv: true,
  timeoutMs: true,
  onFailure: true,
}
const TCP_PROBE_KEYS: Record<string, true> = {
  kind: true,
  host: true,
  port: true,
  timeoutMs: true,
  onFailure: true,
}
const HTTP_PROBE_KEYS: Record<string, true> = {
  kind: true,
  url: true,
  expectStatus: true,
  timeoutMs: true,
  onFailure: true,
}
const DEPLOY_KEYS: Record<string, true> = { argv: true, timeoutMs: true }
const INFO_KEYS: Record<string, true> = { text: true, json: true }
const OPERATION_KEYS: Record<string, true> = {
  id: true,
  summary: true,
  method: true,
  scheme: true,
  authority: true,
  path: true,
  auth: true,
  query: true,
  input: true,
  output: true,
  fields: true,
  run: true,
}
const CREDENTIAL_KEYS: Record<string, true> = { id: true, fields: true }
const CREDENTIAL_DEFINITION_KEYS: Record<string, true> = {
  id: true,
  declaration: true,
  input: true,
  secretFields: true,
}
const FIELD_KEYS: Record<string, true> = { name: true, secret: true, required: true }

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

export function validateComponent(input: unknown, options: ValidationOptions): ValidatedComponent {
  const object = requirePlainObject(input, i18n.t('label.component-definition'))
  requireKeys(object, SPEC_KEYS, i18n.t('label.component-definition'))

  const id = requireText(object.id, 'id')
  if (!COMPONENT_ID.test(id)) {
    invalid(i18n.t('validation.id-invalid'))
  }
  const version = requireText(object.version, 'version')
  const name = requireText(object.name, 'name')
  const summary = requireText(object.summary, 'summary')
  const kind = object.kind
  if (kind !== 'locus' && kind !== 'external') {
    invalid(i18n.t('validation.kind-invalid'))
  }

  if (object.operations !== undefined && !options.allowContract) {
    invalid(i18n.t('validation.yaml-operations'))
  }
  if (object.credentials !== undefined && !options.allowContract) {
    invalid(i18n.t('validation.yaml-credentials'))
  }
  if (kind === 'external' && (object.operations !== undefined || object.credentials !== undefined)) {
    invalid(i18n.t('validation.locus-only-contract'))
  }

  let requires: readonly string[] | undefined
  if (object.requires !== undefined) {
    if (kind !== 'locus') invalid(i18n.t('validation.locus-only-requires'))
    if (!Array.isArray(object.requires)) invalid(i18n.t('validation.requires-array'))
    const values = object.requires.map((item, index) => requireText(item, `requires[${index}]`))
    for (const value of values) {
      if (!COMPONENT_ID.test(value)) invalid(i18n.t('validation.requires-invalid-id', { value }))
    }
    if (new Set(values).size !== values.length) invalid(i18n.t('validation.requires-duplicate'))
    if (values.includes(id)) invalid(i18n.t('validation.requires-self'))
    requires = values
  }

  if (object.probe !== undefined && kind !== 'external') {
    invalid(i18n.t('validation.external-only-probe'))
  }

  const operationsResult =
    object.operations === undefined ? undefined : validateOperations(object.operations, options.executable)
  const credentials = object.credentials === undefined ? undefined : validateCredentials(object.credentials)

  const spec: ComponentSpec = {
    id,
    version,
    name,
    summary,
    kind,
    ...(requires === undefined ? {} : { requires }),
    ...(operationsResult === undefined ? {} : { operations: operationsResult.operations }),
    ...(credentials === undefined ? {} : { credentials }),
    ...(object.config === undefined ? {} : { config: validateConfig(object.config) }),
    ...(object.probe === undefined ? {} : { probe: validateProbe(object.probe) }),
    ...(object.deploy === undefined ? {} : { deploy: validateDeploy(object.deploy) }),
    ...(object.info === undefined ? {} : { info: validateInfo(object.info) }),
  }
  return {
    spec: deepFreeze(spec),
    ...(operationsResult === undefined ? {} : { operations: operationsResult.defined }),
  }
}

function invalid(message: string): never {
  throw new ComponentFailure('invalid-spec', message)
}

function requirePlainObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(i18n.t('validation.map-required', { field }))
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(i18n.t('validation.plain-map-required', { field }))
  }
  return value as Record<string, unknown>
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid(i18n.t('validation.non-empty-string', { field }))
  }
  if (value.includes('\0')) {
    invalid(i18n.t('validation.nul-forbidden', { field }))
  }
  if (value !== value.trim()) {
    invalid(i18n.t('validation.no-surrounding-space', { field }))
  }
  return value
}

function requireKeys(value: Record<string, unknown>, allowed: Record<string, true>, field: string): void {
  for (const key of Object.keys(value)) {
    if (allowed[key] !== true) invalid(i18n.t('validation.unknown-field', { field, key }))
  }
}

function validateSlotId(value: unknown, field: string): string {
  const id = requireText(value, field)
  if (!CREDENTIAL_ID.test(id)) {
    invalid(i18n.t('validation.slot-id-invalid', { field }))
  }
  return id
}

function validateFields(value: unknown, field: string): readonly CredentialField[] {
  if (!Array.isArray(value) || value.length === 0) invalid(i18n.t('validation.non-empty-array', { field }))
  const names = new Set<string>()
  let hasSecret = false
  return value
    .map((item, index) => {
      const itemField = `${field}[${index}]`
      const object = requirePlainObject(item, itemField)
      requireKeys(object, FIELD_KEYS, itemField)
      const name = requireText(object.name, `${itemField}.name`)
      if (!FIELD_NAME.test(name)) invalid(i18n.t('validation.field-name-invalid', { itemField }))
      if (names.has(name)) invalid(i18n.t('validation.duplicate-field', { field, name }))
      names.add(name)
      if (typeof object.secret !== 'boolean') invalid(i18n.t('validation.boolean-secret', { itemField }))
      if (typeof object.required !== 'boolean') invalid(i18n.t('validation.boolean-required', { itemField }))
      if (object.secret) hasSecret = true
      return { name, secret: object.secret, required: object.required }
    })
    .map(fieldValue => {
      if (!hasSecret) invalid(i18n.t('validation.secret-field-required', { field }))
      return fieldValue
    })
}

function declarationOf(item: unknown, field: string): { id: unknown; fields: unknown } {
  const object = requirePlainObject(item, field)
  if (object.declaration !== undefined) {
    requireKeys(object, CREDENTIAL_DEFINITION_KEYS, field)
    const declaration = requirePlainObject(object.declaration, `${field}.declaration`)
    return { id: declaration.id, fields: declaration.fields }
  }
  requireKeys(object, CREDENTIAL_KEYS, field)
  return { id: object.id, fields: object.fields }
}

function validateCredentials(value: unknown): readonly ComponentCredential[] {
  if (!Array.isArray(value)) invalid(i18n.t('validation.credentials-array'))
  const ids = new Set<string>()
  return value.map((item, index) => {
    const field = `credentials[${index}]`
    const { id: rawId, fields: rawFields } = declarationOf(item, field)
    const id = validateSlotId(rawId, `${field}.id`)
    if (ids.has(id)) invalid(i18n.t('validation.credential-slot-duplicate', { id }))
    ids.add(id)
    return Object.freeze({ id, fields: Object.freeze(validateFields(rawFields, `${field}.fields`)) })
  })
}

function validateOperations(
  value: unknown,
  executable: boolean,
): {
  readonly operations: readonly OperationMetadata[]
  readonly defined: readonly OperationDefinition<any, any, any>[]
} {
  if (!Array.isArray(value)) invalid(i18n.t('validation.operations-array'))
  const ids = new Set<string>()
  const metadata: OperationMetadata[] = []
  const defined: OperationDefinition<any, any, any>[] = []
  for (const [index, item] of value.entries()) {
    const field = `operations[${index}]`
    const object = requirePlainObject(item, field)
    requireKeys(object, OPERATION_KEYS, field)
    const id = requireText(object.id, `${field}.id`)
    if (!OPERATION.test(id)) invalid(i18n.t('validation.operation-id-invalid', { field }))
    if (ids.has(id)) invalid(i18n.t('validation.operation-duplicate', { id }))
    ids.add(id)
    const method = object.method
    if (!METHODS.includes(method as LocusMethod)) invalid(i18n.t('validation.method-invalid', { field }))
    const scheme = requireText(object.scheme, `${field}.scheme`)
    if (!SCHEME.test(scheme) || scheme !== scheme.toLowerCase())
      invalid(i18n.t('validation.scheme-lowercase', { field }))
    const authority = requireText(object.authority, `${field}.authority`)
    if (!AUTHORITY.test(authority) || authority !== authority.toLowerCase())
      invalid(i18n.t('validation.authority-lowercase', { field }))
    const path = object.path
    if (typeof path !== 'string' || (path !== '' && !/^\/[^/]+(?:\/[^/]+)*$/.test(path))) {
      invalid(i18n.t('validation.path-invalid', { field }))
    }
    const auth = object.auth
    if (auth !== 'user' && auth !== 'root' && auth !== 'none') invalid(i18n.t('validation.auth-invalid', { field }))
    const inputSchema = object.input as { parse?: unknown } | undefined
    const outputSchema = object.output as { parse?: unknown } | undefined
    const querySchema = object.query as { parse?: unknown } | undefined
    if (executable && (typeof inputSchema?.parse !== 'function' || typeof outputSchema?.parse !== 'function')) {
      invalid(i18n.t('validation.io-parse-required', { field }))
    }
    if (executable && object.query !== undefined && typeof querySchema?.parse !== 'function') {
      invalid(i18n.t('validation.query-parse-required', { field }))
    }
    if (executable) {
      if (typeof object.run !== 'function') invalid(i18n.t('validation.run-reference', { field }))
    } else if (object.run !== undefined) {
      invalid(i18n.t('validation.run-definition-only', { field }))
    }
    let declaration: OperationMetadata
    try {
      declaration = snapshotOperationMetadata({
        id,
        method: method as LocusMethod,
        scheme,
        authority,
        path,
        auth,
        ...(object.summary === undefined ? {} : { summary: object.summary as string }),
        ...(object.fields === undefined ? {} : { fields: object.fields as OperationMetadata['fields'] }),
      })
    } catch (error) {
      if (error instanceof InvocationFailure) invalid(`${field}：${error.message}`)
      throw error
    }
    metadata.push(declaration)
    if (executable) {
      defined.push(
        Object.freeze({
          ...declaration,
          input: inputSchema as OperationDefinition<any, any, any>['input'],
          output: outputSchema as OperationDefinition<any, any, any>['output'],
          ...(object.query === undefined ? {} : { query: querySchema as OperationDefinition<any, any, any>['query'] }),
          run: object.run as OperationDefinition<any, any, any>['run'],
        }) as OperationDefinition<any, any, any>,
      )
    }
  }
  return { operations: Object.freeze(metadata), defined: Object.freeze(defined) }
}

function assertJsonValue(value: unknown, field: string): void {
  if (value === null) return
  if (typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(i18n.t('validation.finite-number', { field }))
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${field}[${index}]`))
    return
  }
  if (typeof value === 'object') {
    const object = requirePlainObject(value, field)
    for (const [key, item] of Object.entries(object)) {
      assertJsonValue(item, `${field}.${key}`)
    }
    return
  }
  invalid(i18n.t('validation.json-value', { field }))
}

function validateConfig(value: unknown): ComponentConfig {
  if (typeof value === 'string') {
    if (value.trim().length === 0 || value !== value.trim()) {
      invalid(i18n.t('validation.config-non-empty'))
    }
    if (value.includes('\0') || isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
      invalid(i18n.t('validation.config-relative'))
    }
    const segments = value.split(/[\\/]+/).filter(segment => segment.length > 0)
    if (segments.length === 0 || segments.some(segment => segment === '..')) {
      invalid(i18n.t('validation.config-traversal'))
    }
    return value
  }
  const object = requirePlainObject(value, 'config')
  assertJsonValue(object, 'config')
  return object
}

function validateArgv(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    invalid(i18n.t('validation.argv-array', { field }))
  }
  return value.map((item, index) => requireText(item, `${field}.argv[${index}]`))
}

function validateTimeout(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > 3_600_000) {
    invalid(i18n.t('validation.timeout-range', { field }))
  }
  return value as number
}

function validateOnFailure(value: unknown): 'stopped' | 'abnormal' | undefined {
  if (value === undefined) return undefined
  if (value !== 'stopped' && value !== 'abnormal') {
    invalid(i18n.t('validation.on-failure'))
  }
  return value
}

function validateProbe(value: unknown): ComponentProbe {
  const object = requirePlainObject(value, 'probe')
  const kind = object.kind
  const timeoutMs = validateTimeout(object.timeoutMs, 'probe')
  const onFailure = validateOnFailure(object.onFailure)

  if (kind === 'tcp') {
    requireKeys(object, TCP_PROBE_KEYS, 'probe')
    const host = requireText(object.host, 'probe.host')
    const port = object.port
    if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) {
      invalid(i18n.t('validation.probe-port'))
    }
    return {
      kind: 'tcp',
      host,
      port: port as number,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(onFailure === undefined ? {} : { onFailure }),
    }
  }

  if (kind === 'http') {
    requireKeys(object, HTTP_PROBE_KEYS, 'probe')
    const url = requireText(object.url, 'probe.url')
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      invalid(i18n.t('validation.probe-url'))
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      invalid(i18n.t('validation.probe-url-scheme'))
    }
    const expectStatus = object.expectStatus
    if (
      expectStatus !== undefined &&
      (!Number.isInteger(expectStatus) || (expectStatus as number) < 100 || (expectStatus as number) > 599)
    ) {
      invalid(i18n.t('validation.probe-status'))
    }
    return {
      kind: 'http',
      url,
      ...(expectStatus === undefined ? {} : { expectStatus: expectStatus as number }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(onFailure === undefined ? {} : { onFailure }),
    }
  }

  if (kind !== undefined && kind !== 'argv') {
    invalid(i18n.t('validation.probe-kind'))
  }
  requireKeys(object, ARGV_PROBE_KEYS, 'probe')
  return {
    argv: validateArgv(object.argv, 'probe'),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(onFailure === undefined ? {} : { onFailure }),
  }
}

function validateDeploy(value: unknown): ComponentDeploy {
  const object = requirePlainObject(value, 'deploy')
  requireKeys(object, DEPLOY_KEYS, 'deploy')
  const argv = validateArgv(object.argv, 'deploy')
  const timeoutMs = validateTimeout(object.timeoutMs, 'deploy')
  return { argv, ...(timeoutMs === undefined ? {} : { timeoutMs }) }
}

function validateInfo(value: unknown): ComponentInfo {
  const object = requirePlainObject(value, 'info')
  requireKeys(object, INFO_KEYS, 'info')
  const hasText = object.text !== undefined
  const hasJson = object.json !== undefined
  if (hasText === hasJson) invalid(i18n.t('validation.info-exclusive'))
  if (hasText) {
    if (typeof object.text !== 'string' || object.text.trim().length === 0) {
      invalid(i18n.t('validation.info-text'))
    }
    if (object.text.includes('\0')) invalid(i18n.t('validation.info-text-nul'))
    return { text: object.text }
  }
  assertJsonValue(object.json, 'info.json')
  return { json: object.json }
}

export interface ValidationOptions {
  readonly executable: boolean
  readonly allowContract: boolean
}

export interface ValidatedComponent {
  readonly spec: ComponentSpec
  readonly operations?: readonly OperationDefinition<any, any, any>[]
}
