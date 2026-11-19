import { InvocationFailure } from './errors.ts'
import { snapshotOperationMetadata } from './operation.ts'
import { AUTHORITY, encodeSegment, parseLocusUri, SCHEME } from './uri.ts'
import { LOCUS_METHODS } from './types.ts'
import type { ApiRouter, LocusMethod, OperationDefinition } from './types.ts'
import { i18n } from '../i18n/core.ts'

const PARAMETER = /^[a-z][a-zA-Z0-9]*$/

type TemplateSegment =
  { readonly kind: 'static'; readonly value: string } | { readonly kind: 'parameter'; readonly name: string }

interface Route {
  readonly namespace: string
  readonly operation: OperationDefinition<any, any, any>
  readonly segments: readonly TemplateSegment[]
  readonly signature: string
}

export function createApiRouter(): ApiRouter {
  const byId = new Map<string, Route>()
  const routes: Route[] = []

  function register(namespace: string, operation: OperationDefinition<any, any, any>): void {
    assertMetadata(namespace, operation)
    const registered = Object.freeze({ ...operation, ...snapshotOperationMetadata(operation) })
    if (byId.has(operation.id)) {
      throw new InvocationFailure('conflict', i18n.t('invocation.operation-duplicate', { id: operation.id }))
    }
    const segments = parseTemplate(operation.path)
    const signature = routeSignature(operation.scheme, operation.authority, operation.method, segments)
    if (routes.some(route => route.signature === signature)) {
      throw new InvocationFailure(
        'conflict',
        i18n.t('invocation.route-conflict', {
          method: operation.method,
          scheme: operation.scheme,
          authority: operation.authority,
          path: operation.path,
        }),
      )
    }
    const route: Route = Object.freeze({ namespace, operation: registered, segments, signature })
    byId.set(operation.id, route)
    routes.push(route)
  }

  function build(operationId: string, params: Readonly<Record<string, string>>): string {
    const route = byId.get(operationId)
    if (route === undefined)
      throw new InvocationFailure('not-found', i18n.t('invocation.operation-missing', { id: operationId }))
    const used = new Set<string>()
    const path = route.segments
      .map(segment => {
        if (segment.kind === 'static') return encodeSegment(segment.value)
        const value = params[segment.name]
        if (typeof value !== 'string') {
          throw new InvocationFailure(
            'invalid-argument',
            i18n.t('invocation.url-param-missing', { name: segment.name }),
          )
        }
        used.add(segment.name)
        return encodeSegment(value)
      })
      .join('/')
    for (const name of Object.keys(params)) {
      if (!used.has(name))
        throw new InvocationFailure('invalid-argument', i18n.t('invocation.url-param-unknown', { name }))
    }
    const { scheme, authority } = route.operation
    return `${scheme}://${authority}${path.length === 0 ? '' : `/${path}`}`
  }

  function resolve(method: LocusMethod, uri: string) {
    const url = parseLocusUri(uri)
    const candidates = routes.filter(
      route => route.operation.scheme === url.scheme && route.operation.authority === url.authority,
    )
    if (candidates.length === 0) {
      const schemeKnown = routes.some(route => route.operation.scheme === url.scheme)
      throw new InvocationFailure(
        schemeKnown ? 'not-found' : 'unsupported-scheme',
        schemeKnown
          ? i18n.t('invocation.resource-missing', { href: url.href })
          : i18n.t('invocation.scheme-unsupported', { scheme: url.scheme }),
      )
    }
    // `url.path` 是已编码的规范表示；路由匹配前只解码一次。
    const segments =
      url.path.length === 0
        ? []
        : url.path
            .slice(1)
            .split('/')
            .map(segment => decodeURIComponent(segment))
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
    if (!pathMatched)
      throw new InvocationFailure('not-found', i18n.t('invocation.resource-missing', { href: url.href }))
    if (best === undefined) {
      throw new InvocationFailure('unsupported-method', i18n.t('invocation.method-unsupported', { method }))
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
      return Object.freeze(
        routes.map(route =>
          Object.freeze({
            namespace: route.namespace,
            operation: route.operation,
          }),
        ),
      )
    },
  })
}

function parseTemplate(path: string): readonly TemplateSegment[] {
  if (path === '') return Object.freeze([])
  if (!path.startsWith('/')) throw new InvocationFailure('invalid-argument', i18n.t('invocation.path-prefix'))
  if (path.endsWith('/') || path.includes('//')) {
    throw new InvocationFailure('invalid-argument', i18n.t('invocation.path-empty'))
  }
  const parameters = new Set<string>()
  return Object.freeze(
    path
      .slice(1)
      .split('/')
      .map((raw): TemplateSegment => {
        if (raw.startsWith(':')) {
          const name = raw.slice(1)
          if (!PARAMETER.test(name) || parameters.has(name)) {
            throw new InvocationFailure('invalid-argument', i18n.t('invocation.path-param-invalid', { segment: raw }))
          }
          parameters.add(name)
          return Object.freeze({ kind: 'parameter' as const, name })
        }
        if (raw.length === 0 || raw === '.' || raw === '..' || /[?#\s]/.test(raw)) {
          throw new InvocationFailure('invalid-argument', i18n.t('invocation.path-static-invalid', { segment: raw }))
        }
        return Object.freeze({ kind: 'static' as const, value: raw })
      }),
  )
}

function routeSignature(
  scheme: string,
  authority: string,
  method: LocusMethod,
  segments: readonly TemplateSegment[],
): string {
  return [
    scheme,
    authority,
    method,
    ...segments.map(segment => (segment.kind === 'static' ? `s:${segment.value}` : ':')),
  ].join('|')
}

function assertMetadata(namespace: string, operation: OperationDefinition<any, any, any>): void {
  if (typeof namespace !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(namespace)) {
    throw new InvocationFailure('invalid-argument', i18n.t('invocation.namespace-invalid'))
  }
  if (typeof operation.id !== 'string' || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(operation.id)) {
    throw new InvocationFailure(
      'invalid-argument',
      i18n.t('invocation.operation-id-invalid', { id: String(operation.id) }),
    )
  }
  if (
    typeof operation.scheme !== 'string' ||
    !SCHEME.test(operation.scheme) ||
    operation.scheme !== operation.scheme.toLowerCase()
  ) {
    throw new InvocationFailure(
      'invalid-argument',
      i18n.t('invocation.operation-scheme-invalid', { scheme: String(operation.scheme) }),
    )
  }
  if (
    typeof operation.authority !== 'string' ||
    !AUTHORITY.test(operation.authority) ||
    operation.authority !== operation.authority.toLowerCase()
  ) {
    throw new InvocationFailure(
      'invalid-argument',
      i18n.t('invocation.operation-authority-invalid', { authority: String(operation.authority) }),
    )
  }
  if (!LOCUS_METHODS.includes(operation.method)) {
    throw new InvocationFailure(
      'invalid-argument',
      i18n.t('invocation.operation-method-invalid', { method: String(operation.method) }),
    )
  }
  if (operation.auth !== 'user' && operation.auth !== 'root' && operation.auth !== 'none') {
    throw new InvocationFailure(
      'invalid-argument',
      i18n.t('invocation.operation-auth-invalid', { auth: String(operation.auth) }),
    )
  }
  if (operation.auth === 'none' && (namespace !== 'locus' || operation.id !== 'locus.security.initialize')) {
    throw new InvocationFailure('invalid-argument', i18n.t('invocation.auth-none-restricted'))
  }
  if (typeof operation.input?.parse !== 'function' || typeof operation.output?.parse !== 'function') {
    throw new InvocationFailure('invalid-argument', i18n.t('invocation.operation-schema-missing', { id: operation.id }))
  }
  if (operation.query !== undefined && typeof operation.query.parse !== 'function') {
    throw new InvocationFailure('invalid-argument', i18n.t('invocation.operation-query-invalid', { id: operation.id }))
  }
  if (typeof operation.run !== 'function') {
    throw new InvocationFailure('invalid-argument', i18n.t('invocation.operation-run-missing', { id: operation.id }))
  }
}
