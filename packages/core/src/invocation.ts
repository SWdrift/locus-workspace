import { createHash, randomUUID } from 'node:crypto'
import type { ComponentCredential, CredentialField } from './components/spec.ts'
import { DomainFailure, SecurityFailure } from './security/errors.ts'
import type {
  CredentialRef,
  CredentialValues,
  OperationCredentialPort,
  SecurityHost,
  SecuritySession,
} from './security/types.ts'

export type LocusMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export const LOCUS_METHODS: readonly LocusMethod[] = Object.freeze(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

/** 输入运行时解析；输出只约束类型，并在契约测试中解析，不在执行后改判业务结果。 */
export interface OperationSchema<T> {
  parse(value: unknown): T
}

export interface CredentialDefinition {
  readonly id: string
  readonly declaration: ComponentCredential
  readonly input: OperationSchema<CredentialValues>
  readonly secretFields: readonly string[]
}

export interface InputField {
  readonly secret?: boolean
  readonly tty?: boolean
}

/** 保留重复 query 值；路由、授权与建链共用规范 URI，参数只解码一次。 */
export interface InvocationUrl {
  readonly href: string
  readonly scheme: string
  readonly authority: string
  readonly path: string
  readonly pathParams: Readonly<Record<string, string>>
  readonly query: Readonly<Record<string, readonly string[]>>
}

export interface OperationContext {
  readonly namespace: string
  readonly operationId: string
  readonly requestId: string
  /** 组件自有配置/状态的根目录；由 Host 注入，不来自 URL。 */
  readonly dataDirectory: string
  readonly url: InvocationUrl
  /** 只读组件状态窄视图，供领域组件检查传输等前置条件。 */
  readonly components: {
    get(id: string): { readonly id: string; readonly kind: 'locus' | 'external'; readonly state: string | null } | undefined
  }
  readonly credential: {
    read<T>(
      credential: CredentialDefinition,
      resourceKey: string,
      consume: (values: CredentialValues) => T | Promise<T>,
    ): Promise<T>
    /** 只在实际获准 root 时可用；写当前 namespace、slot、resourceKey。 */
    write(credential: CredentialDefinition, resourceKey: string, values: CredentialValues): Promise<CredentialRef>
  }
  /** 领域事件接入点；Core 填充 specversion/id/source/subject/time。 */
  emit(type: string, data: unknown): void
}

export interface OperationMetadata {
  readonly id: string
  readonly method: LocusMethod
  readonly scheme: string
  readonly authority: string
  readonly path: string
  readonly auth: 'user' | 'root' | 'none'
}

export interface OperationDefinition<Q, I, O> extends OperationMetadata {
  readonly query?: OperationSchema<Q>
  readonly input: OperationSchema<I>
  readonly output: OperationSchema<O>
  /** Host 用于收集与脱敏；tty 字段禁止来自外部 Body，但可进入 handler input。 */
  readonly fields?: Readonly<Record<string, InputField>>
  readonly run: (query: Q, input: I, context: OperationContext) => NoInfer<O> | Promise<NoInfer<O>>
}

/** 类型推导入口；路由冲突与声明合法性由注册阶段检查。 */
export function defineOperation<Q = undefined, I = unknown, O = unknown>(
  definition: OperationDefinition<Q, I, O>,
): OperationDefinition<Q, I, O> {
  return definition
}

const CREDENTIAL_SLOT = /^[a-z][a-z0-9-]{0,63}$/
const FIELD_NAME = /^[a-z][a-zA-Z0-9]{0,63}$/

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
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
  if (!declarationFields.some((field) => field.secret)) {
    throw new Error('凭据至少需要一个 secret 字段')
  }
  const declaration: ComponentCredential = Object.freeze({
    id: definition.id,
    fields: Object.freeze(declarationFields),
  })
  const declared = new Map(declaration.fields.map((field) => [field.name, field]))
  return Object.freeze({
    id: definition.id,
    declaration,
    secretFields: Object.freeze(declaration.fields.filter((field) => field.secret).map((field) => field.name)),
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

/** 协议级失败；Dispatcher 据此生成稳定错误码，而不把内部异常细节暴露给客户端。 */
export class InvocationFailure extends Error {
  readonly code: InvocationErrorCode
  readonly details: Readonly<Record<string, unknown>> | undefined

  constructor(
    code: InvocationErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message)
    this.name = 'InvocationFailure'
    this.code = code
    this.details = details
  }
}

const SCHEME = /^[a-z][a-z0-9+.-]*$/
const AUTHORITY = /^[a-z0-9][a-z0-9.-]*(?::\d+)?$/
const PARAMETER = /^[a-z][a-zA-Z0-9]*$/
const ENCODED_SEPARATOR = /%(?:2f|5c|00)/i
const CONTROL = /[\u0000-\u001f\u007f]/

function invalidUri(message: string): never {
  throw new InvocationFailure('invalid-uri', message)
}

function decodeSegment(raw: string): string {
  if (ENCODED_SEPARATOR.test(raw)) invalidUri('路径不能包含编码后的分隔符或 NUL')
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    invalidUri('路径包含无效的百分号编码')
  }
  if (decoded.length === 0) invalidUri('路径不能包含空段')
  if (decoded.includes('/') || decoded.includes('\\') || CONTROL.test(decoded)) {
    invalidUri('路径段解码后不能包含分隔符、控制字符或 NUL')
  }
  return decoded
}

function encodeSegment(value: string): string {
  if (value.length === 0 || value.includes('/') || value.includes('\\') || CONTROL.test(value)) {
    throw new InvocationFailure('invalid-argument', 'URL 参数不能为空或包含分隔符、控制字符')
  }
  return encodeURIComponent(value)
}

/**
 * 使用 WHATWG URL 做标准规范化（包括 dot segment），再执行 Locus 特有约束。
 * 路由、建链和授权共用该规范表示；分段只解码一次。
 */
export function parseLocusUri(uri: string): InvocationUrl {
  if (typeof uri !== 'string' || uri.trim().length === 0 || CONTROL.test(uri)) {
    invalidUri('URI 必须是非空字符串，且不能包含控制字符')
  }
  if (uri !== uri.trim()) invalidUri('URI 不能有首尾空白')
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    invalidUri('URI 不是合法 URL')
  }
  const scheme = url.protocol.slice(0, -1).toLowerCase()
  if (!SCHEME.test(scheme)) invalidUri('scheme 不合法')
  if (url.username.length > 0 || url.password.length > 0) invalidUri('URI 不能包含 userinfo')
  if (url.hash.length > 0) invalidUri('URI 不能包含 fragment')
  if (url.hostname.length === 0) invalidUri('URI 缺少 authority')
  const authority = url.host.toLowerCase()
  if (!AUTHORITY.test(authority)) invalidUri('authority 不合法')

  let rawPath = url.pathname
  if (rawPath === '/') rawPath = ''
  else if (rawPath.endsWith('/')) rawPath = rawPath.slice(0, -1)
  const rawSegments = rawPath.length === 0 ? [] : rawPath.slice(1).split('/')
  const segments = rawSegments.map(decodeSegment)
  const path = segments.length === 0 ? '' : `/${segments.map(encodeSegment).join('/')}`

  const query: Record<string, readonly string[]> = Object.create(null) as Record<string, readonly string[]>
  const pairs: Array<[string, string]> = []
  for (const [key, value] of url.searchParams) {
    if (CONTROL.test(key) || CONTROL.test(value)) invalidUri('query 不能包含控制字符')
    if (key.length === 0) invalidUri('query 参数名不能为空')
    pairs.push([key, value])
    const current = query[key]
    query[key] = current === undefined ? Object.freeze([value]) : Object.freeze([...current, value])
  }
  const search = new URLSearchParams(pairs).toString()
  const href = `${scheme}://${authority}${path}${search.length === 0 ? '' : `?${search}`}`

  return Object.freeze({
    href,
    scheme,
    authority,
    path,
    pathParams: Object.freeze(Object.create(null) as Record<string, string>),
    query: Object.freeze(query),
  })
}

type TemplateSegment =
  | { readonly kind: 'static'; readonly value: string }
  | { readonly kind: 'parameter'; readonly name: string }

interface Route {
  readonly namespace: string
  readonly operation: OperationDefinition<any, any, any>
  readonly segments: readonly TemplateSegment[]
  readonly signature: string
}

function parseTemplate(path: string): readonly TemplateSegment[] {
  if (path === '') return Object.freeze([])
  if (!path.startsWith('/')) throw new InvocationFailure('invalid-argument', 'operation path 必须以 / 开头或为空')
  if (path.endsWith('/') || path.includes('//')) {
    throw new InvocationFailure('invalid-argument', 'operation path 不能包含空段或以 / 结尾')
  }
  const parameters = new Set<string>()
  return Object.freeze(path.slice(1).split('/').map((raw): TemplateSegment => {
    if (raw.startsWith(':')) {
      const name = raw.slice(1)
      if (!PARAMETER.test(name) || parameters.has(name)) {
        throw new InvocationFailure('invalid-argument', `operation path 参数不合法或重复：${raw}`)
      }
      parameters.add(name)
      return Object.freeze({ kind: 'parameter' as const, name })
    }
    if (raw.length === 0 || raw === '.' || raw === '..' || /[?#\s]/.test(raw)) {
      throw new InvocationFailure('invalid-argument', `operation path 静态段不合法：${raw}`)
    }
    return Object.freeze({ kind: 'static' as const, value: raw })
  }))
}

function routeSignature(
  scheme: string,
  authority: string,
  method: LocusMethod,
  segments: readonly TemplateSegment[],
): string {
  return [scheme, authority, method, ...segments.map((segment) => (
    segment.kind === 'static' ? `s:${segment.value}` : ':'
  ))].join('|')
}

function assertMetadata(namespace: string, operation: OperationDefinition<any, any, any>): void {
  if (typeof namespace !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(namespace)) {
    throw new InvocationFailure('invalid-argument', 'namespace 必须是小写组件 id')
  }
  if (typeof operation.id !== 'string' || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(operation.id)) {
    throw new InvocationFailure('invalid-argument', `operation id 不合法：${String(operation.id)}`)
  }
  if (typeof operation.scheme !== 'string' || !SCHEME.test(operation.scheme) || operation.scheme !== operation.scheme.toLowerCase()) {
    throw new InvocationFailure('invalid-argument', `operation scheme 不合法：${String(operation.scheme)}`)
  }
  if (
    typeof operation.authority !== 'string' ||
    !AUTHORITY.test(operation.authority) ||
    operation.authority !== operation.authority.toLowerCase()
  ) {
    throw new InvocationFailure('invalid-argument', `operation authority 不合法：${String(operation.authority)}`)
  }
  if (!LOCUS_METHODS.includes(operation.method)) {
    throw new InvocationFailure('invalid-argument', `operation method 不合法：${String(operation.method)}`)
  }
  if (operation.auth !== 'user' && operation.auth !== 'root' && operation.auth !== 'none') {
    throw new InvocationFailure('invalid-argument', `operation auth 不合法：${String(operation.auth)}`)
  }
  if (typeof operation.input?.parse !== 'function' || typeof operation.output?.parse !== 'function') {
    throw new InvocationFailure('invalid-argument', `operation ${operation.id} 缺少 input/output schema`)
  }
  if (operation.query !== undefined && typeof operation.query.parse !== 'function') {
    throw new InvocationFailure('invalid-argument', `operation ${operation.id} 的 query schema 不合法`)
  }
  if (typeof operation.run !== 'function') {
    throw new InvocationFailure('invalid-argument', `operation ${operation.id} 缺少 run`)
  }
}

export interface ApiRouter {
  register(namespace: string, operation: OperationDefinition<any, any, any>): void
  build(operationId: string, params: Readonly<Record<string, string>>): string
  resolve(method: LocusMethod, uri: string): {
    readonly namespace: string
    /** 异构 operation 在路由边界擦除类型；Dispatcher 必须先用其 schema 解析再执行。 */
    readonly operation: OperationDefinition<any, any, any>
    readonly url: InvocationUrl
  }
  readonly operations: readonly {
    readonly namespace: string
    readonly operation: OperationDefinition<any, any, any>
  }[]
}

export function createApiRouter(): ApiRouter {
  const byId = new Map<string, Route>()
  const routes: Route[] = []

  function register(namespace: string, operation: OperationDefinition<any, any, any>): void {
    assertMetadata(namespace, operation)
    if (byId.has(operation.id)) {
      throw new InvocationFailure('conflict', `operation id 重复：${operation.id}`)
    }
    const segments = parseTemplate(operation.path)
    const signature = routeSignature(operation.scheme, operation.authority, operation.method, segments)
    if (routes.some((route) => route.signature === signature)) {
      throw new InvocationFailure('conflict', `operation 路由冲突：${operation.method} ${operation.scheme}://${operation.authority}${operation.path}`)
    }
    const route: Route = Object.freeze({ namespace, operation, segments, signature })
    byId.set(operation.id, route)
    routes.push(route)
  }

  function build(operationId: string, params: Readonly<Record<string, string>>): string {
    const route = byId.get(operationId)
    if (route === undefined) throw new InvocationFailure('not-found', `找不到 operation：${operationId}`)
    const used = new Set<string>()
    const path = route.segments.map((segment) => {
      if (segment.kind === 'static') return encodeSegment(segment.value)
      const value = params[segment.name]
      if (typeof value !== 'string') {
        throw new InvocationFailure('invalid-argument', `缺少 URL 参数：${segment.name}`)
      }
      used.add(segment.name)
      return encodeSegment(value)
    }).join('/')
    for (const name of Object.keys(params)) {
      if (!used.has(name)) throw new InvocationFailure('invalid-argument', `未知 URL 参数：${name}`)
    }
    const { scheme, authority } = route.operation
    return `${scheme}://${authority}${path.length === 0 ? '' : `/${path}`}`
  }

  function resolve(method: LocusMethod, uri: string) {
    const url = parseLocusUri(uri)
    const candidates = routes.filter((route) => (
      route.operation.scheme === url.scheme && route.operation.authority === url.authority
    ))
    if (candidates.length === 0) {
      const schemeKnown = routes.some((route) => route.operation.scheme === url.scheme)
      throw new InvocationFailure(
        schemeKnown ? 'not-found' : 'unsupported-scheme',
        schemeKnown ? `没有匹配的资源：${url.href}` : `不支持的 scheme：${url.scheme}`,
      )
    }
    // `url.path` 是已编码的规范表示；路由匹配前只解码一次。
    const segments = url.path.length === 0
      ? []
      : url.path.slice(1).split('/').map((segment) => decodeURIComponent(segment))
    let pathMatched = false
    let best: { route: Route; values: Record<string, string>; staticCount: number } | undefined
    for (const route of candidates) {
      if (route.segments.length !== segments.length) continue
      const values: Record<string, string> = Object.create(null) as Record<string, string>
      let matched = true
      let staticCount = 0
      for (let index = 0; index < route.segments.length; index++) {
        const segment = route.segments[index]!
        const value = segments[index]!
        if (segment.kind === 'static') {
          if (segment.value !== value) {
            matched = false
            break
          }
          staticCount += 1
        } else {
          values[segment.name] = value
        }
      }
      if (!matched) continue
      pathMatched = true
      if (route.operation.method !== method) continue
      if (best === undefined || staticCount > best.staticCount) {
        best = { route, values, staticCount }
      }
    }
    if (!pathMatched) throw new InvocationFailure('not-found', `没有匹配的资源：${url.href}`)
    if (best === undefined) {
      throw new InvocationFailure('unsupported-method', `资源不支持方法：${method}`)
    }
    const pathParams = Object.freeze(best.values)
    return Object.freeze({
      namespace: best.route.namespace,
      operation: best.route.operation,
      url: Object.freeze({ ...url, pathParams }),
    })
  }

  return Object.freeze({
    register,
    build,
    resolve,
    get operations() {
      return Object.freeze(routes.map((route) => Object.freeze({
        namespace: route.namespace,
        operation: route.operation,
      })))
    },
  })
}

export type InvocationErrorCode =
  | 'invalid-argument' | 'invalid-body' | 'invalid-uri'
  | 'unsupported-scheme' | 'unsupported-method' | 'unsupported-media-type'
  | 'not-found' | 'unauthorized' | 'forbidden' | 'conflict'
  | 'timeout' | 'unavailable' | 'unknown-result' | 'internal'

export type InvocationResult<T = unknown> = {
  readonly uri: string
  readonly requestId: string
  readonly meta?: Readonly<Record<string, unknown>>
} & ({
  readonly ok: true
  readonly data: T
  readonly links: Readonly<Record<string, string>>
} | {
  readonly ok: false
  readonly error: {
    readonly code: InvocationErrorCode
    readonly message: string
    readonly details?: Readonly<Record<string, unknown>>
  }
})

/** 成功结果的窄类型，便于消费方在 ok 判别后取得 data。 */
export type InvocationSuccess<T = unknown> = InvocationResult<T> & {
  readonly ok: true
  readonly data: T
  readonly links: Readonly<Record<string, string>>
}

/** 失败结果的窄类型，便于 CLI 与测试按 code 分支。 */
export type InvocationFailureResult = InvocationResult<never> & {
  readonly ok: false
  readonly error: {
    readonly code: InvocationErrorCode
    readonly message: string
    readonly details?: Readonly<Record<string, unknown>>
  }
}

/** 不接受 principal；身份只来自可信 Host 的真实 Session。 */
export interface InvocationRequest {
  readonly method: LocusMethod
  readonly uri: string
  readonly body?: unknown
  /** 只接受 application/json 或 +json；未提供时按无 Body 处理。 */
  readonly contentType?: string
}

export interface Dispatcher {
  /** 第二参数只由可信 Host 提供；合并并校验后直接交给可信 handler，不写日志或事件。 */
  invoke(request: InvocationRequest, trustedInput?: Readonly<Record<string, unknown>>): Promise<InvocationResult>
  /** 按输入顺序返回逐项结果；只允许 GET，不因单项业务失败丢弃其他结果。 */
  invokeAll(requests: readonly (InvocationRequest & { readonly method: 'GET' })[]): Promise<readonly InvocationResult[]>
}

/** 组合根可注入的组件状态窄视图；不暴露组件服务或可写入口。 */
export interface ComponentStateView {
  get(id: string): { readonly id: string; readonly kind: 'locus' | 'external'; readonly state: string | null } | undefined
}

/* ------------------------------ 结果与错误映射 ------------------------------ */

function errorResult(
  uri: string,
  requestId: string,
  code: InvocationErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): InvocationFailureResult {
  return Object.freeze({
    ok: false,
    uri,
    requestId,
    error: Object.freeze({ code, message, ...(details === undefined ? {} : { details }) }),
  })
}

const COMPONENT_ERROR_CODES: Readonly<Record<string, InvocationErrorCode>> = Object.freeze({
  'invalid-spec': 'invalid-argument',
  'invalid-definition': 'invalid-argument',
  'component-exists': 'conflict',
  'component-not-found': 'not-found',
  'component-package': 'conflict',
  'no-probe': 'unsupported-method',
  'no-deploy': 'unsupported-method',
  'no-external': 'unsupported-method',
})

const DOMAIN_ERROR_CODES: Readonly<Record<string, InvocationErrorCode>> = Object.freeze({
  'invalid-spec': 'invalid-argument',
  'target-exists': 'conflict',
  'target-not-found': 'not-found',
  'ambiguous-target': 'conflict',
  'unsupported-protocol': 'unsupported-scheme',
  'credential-missing': 'not-found',
  'credential-too-large': 'unavailable',
  'capability-unsupported': 'unsupported-method',
  'target-config-mismatch': 'conflict',
  'component-unavailable': 'unavailable',
  'access-denied': 'forbidden',
  'migration-required': 'conflict',
  'already-migrated': 'conflict',
  'encrypted-key-unsupported': 'invalid-argument',
  'delivery-failed': 'unavailable',
  io: 'internal',
})

function securityError(error: SecurityFailure): { code: InvocationErrorCode; details: Readonly<Record<string, unknown>> } {
  switch (error.code) {
    case 'access-denied':
      return { code: 'forbidden', details: { reason: error.reason } }
    case 'authentication-required':
      return {
        code: 'unauthorized',
        details: { ...(error.challenge === undefined ? {} : { challenge: error.challenge }) },
      }
    case 'credential-missing':
      return { code: 'not-found', details: { security: error.code } }
    case 'security-uninitialized':
      return { code: 'unauthorized', details: { security: error.code } }
    case 'security-already-initialized':
      return { code: 'conflict', details: { security: error.code } }
    case 'credential-fields-mismatch':
      return { code: 'invalid-argument', details: { security: error.code } }
    case 'provider-unavailable':
    case 'delivery-failed':
    case 'credential-too-large':
      return { code: 'unavailable', details: { security: error.code } }
    case 'operation-failed':
    case 'io':
      return { code: 'internal', details: { security: error.code } }
    default:
      return { code: 'unauthorized', details: { security: error.code } }
  }
}

function toFailure(error: unknown): {
  code: InvocationErrorCode
  message: string
  details?: Readonly<Record<string, unknown>>
} {
  if (error instanceof InvocationFailure) {
    return { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) }
  }
  if (error instanceof SecurityFailure) {
    const mapped = securityError(error)
    return {
      code: mapped.code,
      message: error.message,
      details: { ...mapped.details, ...(error.reason === undefined ? {} : { reason: error.reason }) },
    }
  }
  if (error instanceof Error) {
    const name = error.name
    if (name === 'ComponentFailure') {
      const code = (error as Error & { code?: string }).code
      return {
        code: code === undefined ? 'internal' : COMPONENT_ERROR_CODES[code] ?? 'internal',
        message: error.message,
        ...(code === undefined ? {} : { details: { component: code } }),
      }
    }
    if (error instanceof DomainFailure) {
      const code = (error as Error & { code?: string }).code
      return {
        code: code === undefined ? 'internal' : DOMAIN_ERROR_CODES[code] ?? 'internal',
        message: error.message,
        ...(code === undefined ? {} : { details: { domain: code } }),
      }
    }
    if (error.name === 'ZodError') {
      return { code: 'invalid-argument', message: '输入或查询参数不符合 operation 契约' }
    }
    return { code: 'internal', message: error.message }
  }
  return { code: 'internal', message: '未知错误' }
}

/* -------------------------------- 事件总线 -------------------------------- */

export interface LocusEvent {
  readonly specversion: '1.0'
  readonly id: string
  readonly type: string
  readonly source: string
  readonly subject?: string
  readonly time: string
  readonly data: unknown
}

export interface EventFilter {
  readonly type?: string
  readonly subject?: string
  readonly limit?: number
}

/** 持久化端口；实现必须 best-effort，不能因记录失败改判业务结果。 */
export interface EventStore {
  append(event: LocusEvent): void
  list(filter?: EventFilter): readonly LocusEvent[]
  dispose?(): void
}

/** 返回 undefined 而非 void，防止把 async 函数误注册为同步监听器。 */
export type EventListener = (event: LocusEvent) => undefined

export interface EventBus {
  publish(event: LocusEvent): void
  subscribe(type: string, listener: EventListener): void
  unsubscribe(type: string, listener: EventListener): void
  list(filter?: EventFilter): readonly LocusEvent[]
}

export function createEventBus(store?: EventStore): EventBus {
  const listeners = new Map<string, Set<EventListener>>()
  const memory: LocusEvent[] = []
  const LIMIT = 1000

  function publish(event: LocusEvent): void {
    const registered = listeners.get(event.type)
    if (registered !== undefined) {
      for (const listener of [...registered]) {
        try {
          listener(event)
        } catch {
          // 逐项隔离异常；事件观察不能阻断业务操作。
        }
      }
    }
    memory.push(event)
    if (memory.length > LIMIT) memory.splice(0, memory.length - LIMIT)
    try {
      store?.append(event)
    } catch {
      // 持久化失败不阻断业务操作，也不宣称完整审计。
    }
  }

  return Object.freeze({
    publish,
    subscribe(type: string, listener: EventListener) {
      if (typeof type !== 'string' || type.length === 0 || typeof listener !== 'function') {
        throw new InvocationFailure('invalid-argument', '事件订阅需要 type 与同步监听器')
      }
      let registered = listeners.get(type)
      if (registered === undefined) {
        registered = new Set()
        listeners.set(type, registered)
      }
      registered.add(listener)
    },
    unsubscribe(type: string, listener: EventListener) {
      const registered = listeners.get(type)
      if (registered === undefined) return
      registered.delete(listener)
      if (registered.size === 0) listeners.delete(type)
    },
    list(filter: EventFilter = {}) {
      try {
        if (store !== undefined) return store.list(filter)
      } catch {
        // 查询失败回退到进程内记录，不把持久化故障伪装成无事件。
      }
      const limit = filter.limit ?? LIMIT
      return Object.freeze(memory
        .filter((event) => (
          (filter.type === undefined || event.type === filter.type) &&
          (filter.subject === undefined || event.subject === filter.subject)
        ))
        .slice(-limit))
    },
  })
}

/* -------------------------------- Dispatcher ------------------------------- */

function isJsonMediaType(value: string | undefined): boolean {
  if (value === undefined) return false
  const type = value.split(';', 1)[0]!.trim().toLowerCase()
  return type === 'application/json' || type.endsWith('+json')
}

function parseQuery(operation: OperationDefinition<any, any, any>, query: InvocationUrl['query']): unknown {
  const names = Object.keys(query)
  if (operation.query === undefined) {
    if (names.length > 0) {
      throw new InvocationFailure('invalid-argument', `operation ${operation.id} 不接受 query 参数`)
    }
    return undefined
  }
  const value: Record<string, string | readonly string[]> = Object.create(null) as Record<string, string | readonly string[]>
  for (const [name, values] of Object.entries(query)) {
    value[name] = values.length === 1 ? values[0]! : values
  }
  try {
    return operation.query.parse(value)
  } catch {
    throw new InvocationFailure('invalid-argument', `查询参数不符合 operation ${operation.id} 的契约`)
  }
}

function hashInput(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex')
}

export function createDispatcher(
  router: ApiRouter,
  host: SecurityHost,
  session: SecuritySession,
  events?: EventBus,
  dataDirectory = '',
  componentState?: ComponentStateView,
): Dispatcher {
  async function runOne(
    request: InvocationRequest,
    trustedInput?: Readonly<Record<string, unknown>>,
  ): Promise<InvocationResult> {
    const requestId = randomUUID()
    let uri = typeof request.uri === 'string' ? request.uri : ''
    try {
      if (!LOCUS_METHODS.includes(request.method)) {
        throw new InvocationFailure('unsupported-method', `不支持的方法：${String(request.method)}`)
      }
      if (typeof request.uri !== 'string' || request.uri.length === 0) {
        throw new InvocationFailure('invalid-uri', '缺少 URI')
      }
      const resolved = router.resolve(request.method, request.uri)
      uri = resolved.url.href
      const { operation, url, namespace } = resolved

      if (request.method === 'GET' && request.body !== undefined) {
        throw new InvocationFailure('invalid-body', 'GET 不接受 Body')
      }
      if (request.body !== undefined && !isJsonMediaType(request.contentType)) {
        throw new InvocationFailure('unsupported-media-type', '只接受 application/json 或 +json')
      }
      if (request.body !== undefined && !isPlainRecord(request.body)) {
        throw new InvocationFailure('invalid-body', 'JSON Body 必须是对象')
      }

      const fields = operation.fields ?? {}
      const body: Record<string, unknown> = request.body === undefined ? {} : { ...request.body }
      if (trustedInput !== undefined) {
        if (!isPlainRecord(trustedInput)) {
          throw new InvocationFailure('invalid-body', '可信输入必须是映射')
        }
        for (const [name, value] of Object.entries(trustedInput)) {
          const field = fields[name]
          if (field === undefined || field.tty !== true) {
            throw new InvocationFailure('invalid-argument', `可信输入字段未声明为 tty：${name}`)
          }
          body[name] = value
        }
      }
      for (const [name, field] of Object.entries(fields)) {
        if (field.tty === true && request.body !== undefined && Object.hasOwn(request.body, name)) {
          throw new InvocationFailure('invalid-body', `外部 Body 不能包含 tty 字段：${name}`)
        }
      }

      const query = parseQuery(operation, url.query)
      let input: unknown
      try {
        input = operation.input.parse(request.method === 'GET' && request.body === undefined && trustedInput === undefined
          ? undefined
          : Object.keys(body).length === 0 && request.body === undefined
            ? undefined
            : body)
      } catch (error) {
        if (error instanceof InvocationFailure) throw error
        throw new InvocationFailure('invalid-argument', `输入不符合 operation ${operation.id} 的契约`)
      }

      const parameters = Object.freeze({
        method: request.method,
        uri: url.href,
        query: Object.freeze(Object.fromEntries(Object.entries(url.query).map(([key, values]) => [key, [...values]]))),
        input: hashInput(input),
      })
      const securityRequest = Object.freeze({
        component: namespace,
        operation: operation.id,
        parameters,
      })

      const invoke = async (credential: OperationCredentialPort): Promise<InvocationResult> => {
        const context: OperationContext = Object.freeze({
          namespace,
          operationId: operation.id,
          requestId,
          dataDirectory,
          url,
          components: Object.freeze({
            get: (id: string) => componentState?.get(id),
          }),
          credential: {
            read: <T>(
              definition: CredentialDefinition,
              resourceKey: string,
              consume: (values: CredentialValues) => T | Promise<T>,
            ): Promise<T> => credential.read(definition.id, resourceKey, consume),
            write: (
              definition: CredentialDefinition,
              resourceKey: string,
              values: CredentialValues,
            ): Promise<CredentialRef> => credential.write(definition.id, resourceKey, values),
          },
          emit(type: string, data: unknown) {
            events?.publish(Object.freeze({
              specversion: '1.0' as const,
              id: randomUUID(),
              type,
              source: `locus://${namespace}`,
              subject: url.href,
              time: new Date().toISOString(),
              data,
            }))
          },
        })
        const data = await operation.run(query, input, context)
        return Object.freeze({
          ok: true as const,
          uri: url.href,
          requestId,
          data,
          links: Object.freeze({ self: url.href }),
          meta: Object.freeze({ method: request.method, operation: operation.id }),
        })
      }

      let result: InvocationResult
      if (operation.auth === 'none') {
        if (operation.id !== 'locus.security.initialize') {
          throw new InvocationFailure('forbidden', `auth: none 只允许 init：${operation.id}`)
        }
        if (session.source !== 'human') {
          throw new InvocationFailure('forbidden', 'init 只接受可信 Host 的 human Session')
        }
        result = await invoke(Object.freeze({
          read: () => Promise.reject(new SecurityFailure('access-denied', { reason: 'unauthorized-component' })),
          write: () => Promise.reject(new SecurityFailure('access-denied', { reason: 'unauthorized-component' })),
        }))
      } else {
        const port = host.bindComponent(session, namespace)
        result = await port.execute(securityRequest, (credential) => invoke(credential))
      }
      events?.publish(Object.freeze({
        specversion: '1.0' as const,
        id: randomUUID(),
        type: 'locus.request.succeeded',
        source: `locus://${namespace}`,
        subject: url.href,
        time: new Date().toISOString(),
        data: { method: request.method, operation: operation.id, requestId },
      }))
      return result
    } catch (error) {
      const failure = toFailure(error)
      const result = errorResult(uri, requestId, failure.code, failure.message, failure.details)
      events?.publish(Object.freeze({
        specversion: '1.0' as const,
        id: randomUUID(),
        type: 'locus.request.failed',
        source: 'locus://core',
        ...(uri.length === 0 ? {} : { subject: uri }),
        time: new Date().toISOString(),
        data: { method: request.method, requestId, code: failure.code },
      }))
      return result
    }
  }

  return Object.freeze({
    invoke: runOne,
    async invokeAll(requests: readonly (InvocationRequest & { readonly method: 'GET' })[]) {
      const results: InvocationResult[] = []
      for (const request of requests) {
        if (request.method !== 'GET') {
          results.push(errorResult(request.uri, randomUUID(), 'unsupported-method', '批量请求只允许 GET'))
          continue
        }
        results.push(await runOne(request))
      }
      return Object.freeze(results)
    },
  })
}
