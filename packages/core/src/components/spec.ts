import { isAbsolute } from 'node:path'
import type {
  CredentialDefinition,
  InputField,
  LocusMethod,
  OperationDefinition,
  OperationMetadata,
} from '../invocation.ts'

/** 组件类别：包提供的组件，或仅在数据目录登记的外部组件。 */
export type ComponentKind = 'locus' | 'external'

/** 外部软件的观察状态；未探查不落值。 */
export type ExternalState = 'healthy' | 'stopped' | 'abnormal' | 'absent'

/** 部署状态；`not-deployable` 表示定义没有部署入口。 */
export type DeployState = 'deployed' | 'failed' | 'not-deployed' | 'not-deployable'

export interface ComponentInfo {
  readonly text?: string
  readonly json?: unknown
}

export interface ArgvProbe {
  readonly kind?: 'argv'
  readonly argv: readonly string[]
  readonly timeoutMs?: number
  /** 探针非零退出时的归类；默认 abnormal。 */
  readonly onFailure?: 'stopped' | 'abnormal'
}

export interface TcpProbe {
  readonly kind: 'tcp'
  readonly host: string
  readonly port: number
  readonly timeoutMs?: number
  readonly onFailure?: 'stopped' | 'abnormal'
}

export interface HttpProbe {
  readonly kind: 'http'
  readonly url: string
  /** 期望状态码；默认 200。 */
  readonly expectStatus?: number
  readonly timeoutMs?: number
  readonly onFailure?: 'stopped' | 'abnormal'
}

export type ComponentProbe = ArgvProbe | TcpProbe | HttpProbe

export interface ComponentDeploy {
  readonly argv: readonly string[]
  readonly timeoutMs?: number
}

/** 组件自有配置：内联映射，或相对数据目录的路径（文件/文件夹）。 */
export type ComponentConfig = Readonly<Record<string, unknown>> | string

/** 凭据字段；秘密字段进入 Keyring，公开字段进入 SQLite 元数据。 */
export interface CredentialField {
  readonly name: string
  readonly secret: boolean
  readonly required: boolean
}

/** 组件声明的凭据槽；字段结构属于可信代码契约。 */
export interface ComponentCredential {
  readonly id: string
  readonly fields: readonly CredentialField[]
}

/** 组件元数据；operation 与凭据由两个定义视图分别扩展。 */
interface ComponentMetadata {
  readonly id: string
  readonly version: string
  readonly name: string
  readonly summary: string
  readonly kind: ComponentKind
  readonly requires?: readonly string[]
  readonly config?: ComponentConfig
  readonly probe?: ComponentProbe
  readonly deploy?: ComponentDeploy
  readonly info?: ComponentInfo
}

/** Core 消费的可序列化定义；不包含函数。 */
export interface ComponentSpec extends ComponentMetadata {
  readonly operations?: readonly OperationMetadata[]
  readonly credentials?: readonly ComponentCredential[]
}

/** 包作者写的一份定义；operation 带 handler。 */
export interface ComponentDefinition extends ComponentMetadata {
  readonly operations?: readonly OperationDefinition<any, any, any>[]
  readonly credentials?: readonly CredentialDefinition[]
}

/** defineComponent 的两个运行时视图。 */
export interface DefinedComponent {
  readonly component: ComponentSpec
  readonly operations: readonly OperationDefinition<any, any, any>[]
}

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

const COMPONENT_ID = /^[a-z][a-z0-9-]{0,63}$/
const OPERATION = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const SCHEME = /^[a-z][a-z0-9+.-]*$/
const AUTHORITY = /^[a-z0-9][a-z0-9.-]*(?::\d+)?$/
const CREDENTIAL_ID = /^[a-z][a-z0-9-]{0,63}$/
const FIELD_NAME = /^[a-z][a-zA-Z0-9]{0,63}$/
const METHODS: readonly LocusMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
/** 组件 id 同时是顶层命令名；这些名字保留给内置命令与别名。 */
const RESERVED_COMPONENT_IDS: Record<string, true> = {
  version: true,
  workspace: true,
  component: true,
  shell: true,
  help: true,
  rt: true,
  init: true,
  security: true,
  credential: true,
  pg: true,
}
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
const FIELD_INPUT_KEYS: Record<string, true> = { secret: true, tty: true }
const CREDENTIAL_KEYS: Record<string, true> = { id: true, fields: true }
const CREDENTIAL_DEFINITION_KEYS: Record<string, true> = { id: true, declaration: true, input: true, secretFields: true }
const FIELD_KEYS: Record<string, true> = { name: true, secret: true, required: true }

function invalid(message: string): never {
  throw new ComponentFailure('invalid-spec', message)
}

function requirePlainObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${field} 必须是映射`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(`${field} 必须是普通映射`)
  }
  return value as Record<string, unknown>
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid(`${field} 必须是非空字符串`)
  }
  if (value.includes('\0')) {
    invalid(`${field} 不能包含 NUL 字符`)
  }
  if (value !== value.trim()) {
    invalid(`${field} 不能有首尾空白`)
  }
  return value
}

function requireKeys(value: Record<string, unknown>, allowed: Record<string, true>, field: string): void {
  for (const key of Object.keys(value)) {
    if (allowed[key] !== true) invalid(`${field} 包含未知字段：${key}`)
  }
}

function validateSlotId(value: unknown, field: string): string {
  const id = requireText(value, field)
  if (!CREDENTIAL_ID.test(id)) {
    invalid(`${field} 必须以小写字母开头，只包含小写字母、数字和短横线，最长 64 字符`)
  }
  return id
}

function validateFields(value: unknown, field: string): readonly CredentialField[] {
  if (!Array.isArray(value) || value.length === 0) invalid(`${field} 必须是非空数组`)
  const names = new Set<string>()
  let hasSecret = false
  return value.map((item, index) => {
    const itemField = `${field}[${index}]`
    const object = requirePlainObject(item, itemField)
    requireKeys(object, FIELD_KEYS, itemField)
    const name = requireText(object.name, `${itemField}.name`)
    if (!FIELD_NAME.test(name)) invalid(`${itemField}.name 必须以小写字母开头，只包含字母和数字`)
    if (names.has(name)) invalid(`${field} 不能包含重复字段：${name}`)
    names.add(name)
    if (typeof object.secret !== 'boolean') invalid(`${itemField}.secret 必须是布尔值`)
    if (typeof object.required !== 'boolean') invalid(`${itemField}.required 必须是布尔值`)
    if (object.secret) hasSecret = true
    return { name, secret: object.secret, required: object.required }
  }).map((fieldValue) => {
    if (!hasSecret) invalid(`${field} 至少需要一个 secret 字段`)
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
  if (!Array.isArray(value)) invalid('credentials 必须是数组')
  const ids = new Set<string>()
  return value.map((item, index) => {
    const field = `credentials[${index}]`
    const { id: rawId, fields: rawFields } = declarationOf(item, field)
    const id = validateSlotId(rawId, `${field}.id`)
    if (ids.has(id)) invalid(`credentials 包含重复凭据槽 id：${id}`)
    ids.add(id)
    return Object.freeze({ id, fields: Object.freeze(validateFields(rawFields, `${field}.fields`)) })
  })
}

function validateOperationFields(value: unknown, field: string): Readonly<Record<string, InputField>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(`${field} 必须是映射`)
  const output: Record<string, InputField> = Object.create(null) as Record<string, InputField>
  for (const [name, raw] of Object.entries(value)) {
    if (!FIELD_NAME.test(name)) invalid(`${field}.${name} 必须以小写字母开头，只包含字母和数字`)
    const object = requirePlainObject(raw, `${field}.${name}`)
    requireKeys(object, FIELD_INPUT_KEYS, `${field}.${name}`)
    if (object.secret !== undefined && typeof object.secret !== 'boolean') {
      invalid(`${field}.${name}.secret 必须是布尔值`)
    }
    if (object.tty !== undefined && typeof object.tty !== 'boolean') {
      invalid(`${field}.${name}.tty 必须是布尔值`)
    }
    output[name] = Object.freeze({
      ...(object.secret === undefined ? {} : { secret: object.secret }),
      ...(object.tty === undefined ? {} : { tty: object.tty }),
    })
  }
  return Object.freeze(output)
}

function validateOperations(
  value: unknown,
  executable: boolean,
): {
  readonly operations: readonly OperationMetadata[]
  readonly defined: readonly OperationDefinition<any, any, any>[]
} {
  if (!Array.isArray(value)) invalid('operations 必须是数组')
  const ids = new Set<string>()
  const metadata: OperationMetadata[] = []
  const defined: OperationDefinition<any, any, any>[] = []
  for (const [index, item] of value.entries()) {
    const field = `operations[${index}]`
    const object = requirePlainObject(item, field)
    requireKeys(object, OPERATION_KEYS, field)
    const id = requireText(object.id, `${field}.id`)
    if (!OPERATION.test(id)) invalid(`${field}.id 必须以小写字母开头，以 . 或 - 分隔名称段`)
    if (ids.has(id)) invalid(`operations 包含重复 operation id：${id}`)
    ids.add(id)
    const method = object.method
    if (!METHODS.includes(method as LocusMethod)) invalid(`${field}.method 必须是 GET、POST、PUT、PATCH 或 DELETE`)
    const scheme = requireText(object.scheme, `${field}.scheme`)
    if (!SCHEME.test(scheme) || scheme !== scheme.toLowerCase()) invalid(`${field}.scheme 必须是小写 scheme`)
    const authority = requireText(object.authority, `${field}.authority`)
    if (!AUTHORITY.test(authority) || authority !== authority.toLowerCase()) invalid(`${field}.authority 必须是小写 authority`)
    const path = object.path
    if (typeof path !== 'string' || (path !== '' && !/^\/[^/]+(?:\/[^/]+)*$/.test(path))) {
      invalid(`${field}.path 必须为空或以 / 开头且不能包含空段`)
    }
    const auth = object.auth
    if (auth !== 'user' && auth !== 'root' && auth !== 'none') invalid(`${field}.auth 必须是 user、root 或 none`)
    const inputSchema = object.input as { parse?: unknown } | undefined
    const outputSchema = object.output as { parse?: unknown } | undefined
    const querySchema = object.query as { parse?: unknown } | undefined
    if (executable && (typeof inputSchema?.parse !== 'function' || typeof outputSchema?.parse !== 'function')) {
      invalid(`${field} 的 input 与 output 必须提供 parse`)
    }
    if (executable && object.query !== undefined && typeof querySchema?.parse !== 'function') {
      invalid(`${field}.query 必须提供 parse`)
    }
    if (executable) {
      if (typeof object.run !== 'function') invalid(`${field}.run 必须是具名函数引用`)
    } else if (object.run !== undefined) {
      invalid(`${field}.run 只能出现在 defineComponent 的定义中`)
    }
    const fields = object.fields === undefined ? undefined : validateOperationFields(object.fields, `${field}.fields`)
    metadata.push(Object.freeze({
      id,
      method: method as LocusMethod,
      scheme,
      authority,
      path,
      auth,
    }))
    if (executable) {
      defined.push(Object.freeze({
        id,
        method: method as LocusMethod,
        scheme,
        authority,
        path,
        auth,
        input: inputSchema as OperationDefinition<any, any, any>['input'],
        output: outputSchema as OperationDefinition<any, any, any>['output'],
        ...(object.query === undefined ? {} : { query: querySchema as OperationDefinition<any, any, any>['query'] }),
        ...(fields === undefined ? {} : { fields }),
        run: object.run as OperationDefinition<any, any, any>['run'],
      }) as OperationDefinition<any, any, any>)
    }
  }
  return { operations: Object.freeze(metadata), defined: Object.freeze(defined) }
}

function assertJsonValue(value: unknown, field: string): void {
  if (value === null) return
  if (typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(`${field} 必须是有限数字`)
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
  invalid(`${field} 必须是 JSON 值`)
}

function validateConfig(value: unknown): ComponentConfig {
  if (typeof value === 'string') {
    if (value.trim().length === 0 || value !== value.trim()) {
      invalid('config 路径必须是非空字符串且没有首尾空白')
    }
    if (value.includes('\0') || isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
      invalid('config 路径必须是相对路径')
    }
    const segments = value.split(/[\\/]+/).filter((segment) => segment.length > 0)
    if (segments.length === 0 || segments.some((segment) => segment === '..')) {
      invalid('config 路径不能为空或包含 ..')
    }
    return value
  }
  const object = requirePlainObject(value, 'config')
  assertJsonValue(object, 'config')
  return object
}

function validateArgv(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    invalid(`${field}.argv 必须是非空数组`)
  }
  return value.map((item, index) => requireText(item, `${field}.argv[${index}]`))
}

function validateTimeout(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > 3_600_000) {
    invalid(`${field}.timeoutMs 必须是 1 到 3600000 的整数`)
  }
  return value as number
}

function validateOnFailure(value: unknown): 'stopped' | 'abnormal' | undefined {
  if (value === undefined) return undefined
  if (value !== 'stopped' && value !== 'abnormal') {
    invalid('probe.onFailure 必须是 stopped 或 abnormal')
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
      invalid('probe.port 必须是 1 到 65535 的整数')
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
      invalid('probe.url 必须是合法 URL')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      invalid('probe.url 只支持 http 与 https')
    }
    const expectStatus = object.expectStatus
    if (
      expectStatus !== undefined &&
      (!Number.isInteger(expectStatus) || (expectStatus as number) < 100 || (expectStatus as number) > 599)
    ) {
      invalid('probe.expectStatus 必须是 100 到 599 的整数')
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
    invalid('probe.kind 必须是 argv、tcp 或 http')
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
  if (hasText === hasJson) invalid('info 必须且只能包含 text 或 json 之一')
  if (hasText) {
    if (typeof object.text !== 'string' || object.text.trim().length === 0) {
      invalid('info.text 必须是非空字符串')
    }
    if (object.text.includes('\0')) invalid('info.text 不能包含 NUL 字符')
    return { text: object.text }
  }
  assertJsonValue(object.json, 'info.json')
  return { json: object.json }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

export interface ValidationOptions {
  readonly executable: boolean
  readonly allowContract: boolean
}

export interface ValidatedComponent {
  readonly spec: ComponentSpec
  readonly operations?: readonly OperationDefinition<any, any, any>[]
}

export function validateComponent(input: unknown, options: ValidationOptions): ValidatedComponent {
  const object = requirePlainObject(input, '组件定义')
  requireKeys(object, SPEC_KEYS, '组件定义')

  const id = requireText(object.id, 'id')
  if (!COMPONENT_ID.test(id)) {
    invalid('id 必须以小写字母开头，只包含小写字母、数字和短横线，最长 64 字符')
  }
  if (RESERVED_COMPONENT_IDS[id] === true) {
    invalid(`id 与内置顶层命令冲突：${id}`)
  }
  const version = requireText(object.version, 'version')
  const name = requireText(object.name, 'name')
  const summary = requireText(object.summary, 'summary')
  const kind = object.kind
  if (kind !== 'locus' && kind !== 'external') {
    invalid('kind 必须是 locus 或 external')
  }

  if (object.operations !== undefined && !options.allowContract) {
    invalid('可编辑 YAML 不能声明 operations；operation 属于可信代码契约')
  }
  if (object.credentials !== undefined && !options.allowContract) {
    invalid('可编辑 YAML 不能声明 credentials；凭据字段属于可信代码契约')
  }
  if (kind === 'external' && (object.operations !== undefined || object.credentials !== undefined)) {
    invalid('只有 locus 组件可以声明 operations 与 credentials')
  }

  let requires: readonly string[] | undefined
  if (object.requires !== undefined) {
    if (kind !== 'locus') invalid('只有 locus 组件可以声明 requires')
    if (!Array.isArray(object.requires)) invalid('requires 必须是数组')
    const values = object.requires.map((item, index) => requireText(item, `requires[${index}]`))
    for (const value of values) {
      if (!COMPONENT_ID.test(value)) invalid(`requires 包含无效组件 id：${value}`)
    }
    if (new Set(values).size !== values.length) invalid('requires 不能重复')
    if (values.includes(id)) invalid('requires 不能引用自身')
    requires = values
  }

  if (object.probe !== undefined && kind !== 'external') {
    invalid('只有 external 组件可以声明 probe')
  }

  const operationsResult = object.operations === undefined
    ? undefined
    : validateOperations(object.operations, options.executable)
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

/**
 * 定义组件的唯一可信入口：同时产出可序列化 component 与 operation handler 表。
 * 不写文件、不注册全局状态。
 */
export function defineComponent(input: ComponentDefinition): DefinedComponent {
  const result = validateComponent(input, { executable: true, allowContract: true })
  return deepFreeze({
    component: result.spec,
    operations: result.operations ?? Object.freeze([]),
  })
}
