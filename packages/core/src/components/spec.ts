import { isAbsolute } from 'node:path'
import type { CapabilityContext } from '../security/types.ts'
import { parseYamlDocument } from './yaml.ts'

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

export type CapabilityAuthLevel = 'user' | 'root'
export type CapabilityAccess = 'read' | 'write'

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

/** 能力对凭据槽的访问声明；不授予凭据本身。 */
export interface CapabilitySecret {
  readonly slot: string
  readonly access: CapabilityAccess
}

/** 能力声明；id 是组件本地名，全局名由 component.id + ':' + id 派生。 */
export interface ComponentCapability {
  readonly id: string
  readonly resourceType: string
  readonly defaultAuthLevel?: CapabilityAuthLevel
  readonly secrets?: readonly CapabilitySecret[]
}

/** 组件 handler；context 由 Core 在授权后注入，input 由 CLI/Web 传入。 */
export type CapabilityHandler<Input = unknown, Output = unknown> = (
  context: CapabilityContext,
  input: Input,
) => Output | Promise<Output>

/** 可信包定义中的能力：带具名 handler，不进入可序列化 component。 */
export interface ComponentCapabilityDefinition extends ComponentCapability {
  readonly run: CapabilityHandler<any, any>
}

/** 组件元数据；能力与凭据由两个定义视图分别扩展。 */
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
  readonly capabilities?: readonly ComponentCapability[]
  readonly credentials?: readonly ComponentCredential[]
}

/** 包作者写的一份定义；capability 带 handler。 */
export interface ComponentDefinition extends ComponentMetadata {
  readonly capabilities?: readonly ComponentCapabilityDefinition[]
  readonly credentials?: readonly ComponentCredential[]
}

/** defineComponent 的两个运行时视图。 */
export interface DefinedComponent {
  readonly component: ComponentSpec
  readonly api: Readonly<Record<string, CapabilityHandler<any, any>>>
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
/** 本地能力 id 不含冒号；冒号保留给全局限定名。 */
const CAPABILITY_NAME = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const RESOURCE_TYPE = /^[a-z][a-z0-9-]{0,63}$/
const CREDENTIAL_ID = /^[a-z][a-z0-9-]{0,63}$/
const FIELD_NAME = /^[a-z][a-zA-Z0-9]{0,63}$/
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
  capabilities: true,
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
const CAPABILITY_KEYS: Record<string, true> = {
  id: true,
  resourceType: true,
  defaultAuthLevel: true,
  secrets: true,
  run: true,
}
const CREDENTIAL_KEYS: Record<string, true> = { id: true, fields: true }
const FIELD_KEYS: Record<string, true> = { name: true, secret: true, required: true }
const SECRET_KEYS: Record<string, true> = { slot: true, access: true }
const ACCESS_MODES: readonly CapabilityAccess[] = ['read', 'write']

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

function validateCapabilityName(value: unknown, field: string): string {
  const name = requireText(value, field)
  if (!CAPABILITY_NAME.test(name)) {
    invalid(`${field} 必须以小写字母开头，名称段只包含小写字母和数字，以 . 或 - 分隔，不能包含冒号`)
  }
  return name
}

function validateResourceType(value: unknown, field: string): string {
  const type = requireText(value, field)
  if (!RESOURCE_TYPE.test(type)) {
    invalid(`${field} 必须以小写字母开头，只包含小写字母、数字和短横线`)
  }
  return type
}

function validateSlotId(value: unknown, field: string): string {
  const id = requireText(value, field)
  if (!CREDENTIAL_ID.test(id)) {
    invalid(`${field} 必须以小写字母开头，只包含小写字母、数字和短横线，最长 64 字符`)
  }
  return id
}

function validateCapabilitySecrets(value: unknown, field: string): readonly CapabilitySecret[] {
  if (!Array.isArray(value)) invalid(`${field} 必须是数组`)
  const slots = new Set<string>()
  return value.map((item, index) => {
    const itemField = `${field}[${index}]`
    const object = requirePlainObject(item, itemField)
    requireKeys(object, SECRET_KEYS, itemField)
    const slot = validateSlotId(object.slot, `${itemField}.slot`)
    const access = object.access
    if (!ACCESS_MODES.includes(access as CapabilityAccess)) {
      invalid(`${itemField}.access 必须是 read 或 write`)
    }
    if (slots.has(slot)) invalid(`${field} 不能重复声明凭据槽：${slot}`)
    slots.add(slot)
    return { slot, access: access as CapabilityAccess }
  })
}

function validateCapabilities(
  value: unknown,
  executable: boolean,
): { readonly capabilities: readonly ComponentCapability[]; readonly api: Readonly<Record<string, CapabilityHandler>> } {
  if (!Array.isArray(value)) invalid('capabilities 必须是数组')
  const ids = new Set<string>()
  const api: Record<string, CapabilityHandler<any, any>> = Object.create(null) as Record<string, CapabilityHandler<any, any>>
  const capabilities = value.map((item, index) => {
    const field = `capabilities[${index}]`
    const object = requirePlainObject(item, field)
    requireKeys(object, CAPABILITY_KEYS, field)
    const id = validateCapabilityName(object.id, `${field}.id`)
    if (ids.has(id)) invalid(`capabilities 包含重复能力 id：${id}`)
    ids.add(id)
    const resourceType = validateResourceType(object.resourceType, `${field}.resourceType`)
    const defaultAuthLevel = object.defaultAuthLevel
    if (defaultAuthLevel !== undefined && defaultAuthLevel !== 'user' && defaultAuthLevel !== 'root') {
      invalid(`${field}.defaultAuthLevel 必须是 user 或 root`)
    }
    const secrets = object.secrets === undefined
      ? undefined
      : validateCapabilitySecrets(object.secrets, `${field}.secrets`)
    if (executable) {
      if (typeof object.run !== 'function') invalid(`${field}.run 必须是具名函数引用`)
      api[id] = object.run as CapabilityHandler
    } else if (object.run !== undefined) {
      invalid(`${field}.run 只能出现在 defineComponent 的定义中`)
    }
    return {
      id,
      resourceType,
      ...(defaultAuthLevel === undefined ? {} : { defaultAuthLevel: defaultAuthLevel as CapabilityAuthLevel }),
      ...(secrets === undefined ? {} : { secrets }),
    }
  })
  return { capabilities, api: Object.freeze(api) }
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

function validateCredentials(value: unknown): readonly ComponentCredential[] {
  if (!Array.isArray(value)) invalid('credentials 必须是数组')
  const ids = new Set<string>()
  return value.map((item, index) => {
    const field = `credentials[${index}]`
    const object = requirePlainObject(item, field)
    requireKeys(object, CREDENTIAL_KEYS, field)
    const id = validateSlotId(object.id, `${field}.id`)
    if (ids.has(id)) invalid(`credentials 包含重复凭据槽 id：${id}`)
    ids.add(id)
    return { id, fields: validateFields(object.fields, `${field}.fields`) }
  })
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

interface ValidationOptions {
  readonly executable: boolean
  readonly allowCapabilities: boolean
}

interface ValidatedComponent {
  readonly spec: ComponentSpec
  readonly api?: Readonly<Record<string, CapabilityHandler>>
}

function validateComponent(input: unknown, options: ValidationOptions): ValidatedComponent {
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

  if (object.capabilities !== undefined && !options.allowCapabilities) {
    invalid('可编辑 YAML 不能声明 capabilities；能力属于可信代码契约')
  }
  if (object.credentials !== undefined && !options.allowCapabilities) {
    invalid('可编辑 YAML 不能声明 credentials；凭据字段属于可信代码契约')
  }
  if (kind === 'external' && (object.capabilities !== undefined || object.credentials !== undefined)) {
    invalid('只有 locus 组件可以声明 capabilities 与 credentials')
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

  const capabilitiesResult = object.capabilities === undefined
    ? undefined
    : validateCapabilities(object.capabilities, options.executable)
  const capabilities = capabilitiesResult?.capabilities
  const credentials = object.credentials === undefined ? undefined : validateCredentials(object.credentials)

  if (capabilities !== undefined && credentials !== undefined) {
    const slots = new Set(credentials.map((credential) => credential.id))
    for (const capability of capabilities) {
      for (const secret of capability.secrets ?? []) {
        if (!slots.has(secret.slot)) {
          invalid(`capability ${capability.id} 引用了未声明的凭据槽：${secret.slot}`)
        }
      }
    }
  } else if (capabilities !== undefined) {
    for (const capability of capabilities) {
      if ((capability.secrets ?? []).length > 0) {
        invalid(`capability ${capability.id} 声明了 secrets，但组件没有 credentials`)
      }
    }
  }

  const spec: ComponentSpec = {
    id,
    version,
    name,
    summary,
    kind,
    ...(requires === undefined ? {} : { requires }),
    ...(capabilities === undefined ? {} : { capabilities }),
    ...(credentials === undefined ? {} : { credentials }),
    ...(object.config === undefined ? {} : { config: validateConfig(object.config) }),
    ...(object.probe === undefined ? {} : { probe: validateProbe(object.probe) }),
    ...(object.deploy === undefined ? {} : { deploy: validateDeploy(object.deploy) }),
    ...(object.info === undefined ? {} : { info: validateInfo(object.info) }),
  }
  return {
    spec: deepFreeze(spec),
    ...(capabilitiesResult === undefined ? {} : { api: capabilitiesResult.api }),
  }
}

function parseYaml(text: string): unknown {
  try {
    return parseYamlDocument(text)
  } catch (error) {
    throw new ComponentFailure(
      'invalid-spec',
      `YAML 解析失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * 解析可序列化组件定义。字符串走 YAML；默认拒绝 capabilities/credentials，
 * 防止可编辑 YAML 形成第二份能力或凭据真源。
 */
export function parseComponent(
  input: unknown,
  options: { readonly allowCapabilities?: boolean } = {},
): ComponentSpec {
  const value = typeof input === 'string' ? parseYaml(input) : input
  if (value === null || value === undefined) throw new ComponentFailure('invalid-spec', '组件定义不能为空')
  return validateComponent(value, {
    executable: false,
    allowCapabilities: options.allowCapabilities === true,
  }).spec
}

/**
 * 定义组件的唯一可信入口：同时产出可序列化 component 与按本地 id 索引的 api。
 * 不写文件、不注册全局状态。
 */
export function defineComponent(input: ComponentDefinition): DefinedComponent {
  const result = validateComponent(input, { executable: true, allowCapabilities: true })
  return deepFreeze({
    component: result.spec,
    api: result.api ?? Object.freeze({}),
  })
}
