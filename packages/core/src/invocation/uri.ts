import { InvocationFailure } from './errors.ts'
import type { InvocationUrl } from './types.ts'

export const SCHEME = /^[a-z][a-z0-9+.-]*$/
export const AUTHORITY = /^[a-z0-9][a-z0-9.-]*(?::\d+)?$/
const ENCODED_SEPARATOR = /%(?:2f|5c|00)/i
const CONTROL = /[\u0000-\u001f\u007f]/

export function encodeSegment(value: string): string {
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
