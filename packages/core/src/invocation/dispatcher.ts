import { createHash, randomUUID } from 'node:crypto'
import type { EventBus } from '../events/types.ts'
import { SecurityFailure } from '../security/errors.ts'
import type {
  CredentialRef,
  CredentialValues,
  OperationCredentialPort,
  SecurityHost,
  SecuritySession,
} from '../security/types.ts'
import { errorResult, InvocationFailure, toFailure } from './errors.ts'
import { isPlainRecord } from './operation.ts'
import { LOCUS_METHODS } from './types.ts'
import type {
  ApiRouter,
  ComponentStateView,
  CredentialDefinition,
  Dispatcher,
  InvocationRequest,
  InvocationResult,
  InvocationUrl,
  OperationContext,
  OperationDefinition,
} from './types.ts'

export function createDispatcher(
  router: ApiRouter,
  host: SecurityHost,
  session: SecuritySession,
  events?: EventBus,
  dataDirectory = '',
  componentState?: ComponentStateView,
  options: { readonly debug?: boolean } = {},
): Dispatcher {
  const debug = options.debug === true
  async function runOne(
    request: InvocationRequest,
    trustedInput?: Readonly<Record<string, unknown>>,
  ): Promise<InvocationResult> {
    const requestId = randomUUID()
    let uri = typeof request.uri === 'string' ? request.uri : ''
    let operationId: string | undefined
    const failed = (error: unknown): InvocationResult => {
      const failure = toFailure(error, debug)
      const result = errorResult(
        uri,
        requestId,
        failure.code,
        failure.message,
        failure.details,
        operationId === undefined ? undefined : { method: request.method, operation: operationId },
      )
      const domain = failure.details?.domain
      events?.publish(
        Object.freeze({
          specversion: '1.0' as const,
          id: randomUUID(),
          type: 'locus.request.failed',
          source: 'locus://core',
          ...(uri.length === 0 ? {} : { subject: uri }),
          time: new Date().toISOString(),
          data: {
            method: request.method,
            requestId,
            code: failure.code,
            ...(operationId === undefined ? {} : { operation: operationId }),
            ...(typeof domain === 'string' ? { domain } : {}),
          },
        }),
      )
      return result
    }
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
      operationId = operation.id

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
        input = operation.input.parse(
          request.method === 'GET' && request.body === undefined && trustedInput === undefined
            ? undefined
            : Object.keys(body).length === 0 && request.body === undefined
              ? undefined
              : body,
        )
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
        try {
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
              events?.publish(
                Object.freeze({
                  specversion: '1.0' as const,
                  id: randomUUID(),
                  type,
                  source: `locus://${namespace}`,
                  subject: url.href,
                  time: new Date().toISOString(),
                  data,
                }),
              )
            },
          })
          const data = await operation.run(query, input, context)
          events?.publish(
            Object.freeze({
              specversion: '1.0' as const,
              id: randomUUID(),
              type: 'locus.request.succeeded',
              source: `locus://${namespace}`,
              subject: url.href,
              time: new Date().toISOString(),
              data: { method: request.method, operation: operation.id, requestId },
            }),
          )
          return Object.freeze({
            ok: true as const,
            uri: url.href,
            requestId,
            data,
            links: Object.freeze({ self: url.href }),
            meta: Object.freeze({ method: request.method, operation: operation.id }),
          })
        } catch (error) {
          // 恢复 Grant 时也执行此闭包，结果分类与请求事件不能依赖首次调用的调用栈。
          return failed(error)
        }
      }

      let result: InvocationResult
      if (operation.auth === 'none') {
        if (namespace !== 'locus' || operation.id !== 'locus.security.initialize') {
          throw new InvocationFailure('forbidden', `auth: none 只允许 init：${operation.id}`)
        }
        if (session.source !== 'human') {
          throw new InvocationFailure('forbidden', 'init 只接受可信 Host 的 human Session')
        }
        result = await invoke(
          Object.freeze({
            read: () => Promise.reject(new SecurityFailure('access-denied', { reason: 'unauthorized-component' })),
            write: () => Promise.reject(new SecurityFailure('access-denied', { reason: 'unauthorized-component' })),
          }),
        )
      } else {
        const port = host.bindComponent(session, namespace)
        result = await port.execute(securityRequest, credential => invoke(credential))
      }
      return result
    } catch (error) {
      return failed(error)
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
  const value: Record<string, string | readonly string[]> = Object.create(null) as Record<
    string,
    string | readonly string[]
  >
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
  return createHash('sha256')
    .update(JSON.stringify(value) ?? 'undefined')
    .digest('hex')
}
