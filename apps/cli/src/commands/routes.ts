import type { Command } from 'commander'
import { describeOperation, LOCUS_METHODS, parseLocusUri } from '@locus/core/invocation'
import type { ApiRouter, InvocationUrl, OperationDescription } from '@locus/core/invocation'
import { i18n } from '../i18n.ts'
import { emit } from '../output/output.ts'

interface RouteScope {
  readonly scheme: string
  readonly routes: number
}

/** 路由发现只读取已装配的声明，不创建 Session、不调用 handler 或领域服务。 */
export function registerRoutesCommand(program: Command, router: ApiRouter): void {
  const routes = program.command('routes [uri]').description(i18n.t('command.routes.description'))
  routes.action((uri?: string) => {
    if (uri === undefined) {
      const scopes = routeScopes(router)
      emit(
        routes,
        scopes,
        scopes
          .map(
            scope =>
              `  ${i18n.t('routes.route-line', {
                scheme: scope.scheme.padEnd(12),
                count: scope.routes,
              })}`,
          )
          .join('\n'),
      )
      return
    }
    const descriptions = selectOperations(router, uri)
    if (descriptions.length === 0) routes.error(i18n.t('routes.no-routes', { uri }), { exitCode: 1 })
    emit(routes, descriptions, operationListText(descriptions))
  })
}

function describeOperations(router: ApiRouter): readonly OperationDescription[] {
  return router.operations.map(({ namespace, operation }) => describeOperation(operation, namespace))
}

/** 默认只列域；scheme:// 平铺整域，URL 前缀平铺下一级，具体资源 URL 显示可用声明。 */
function routeScopes(router: ApiRouter): readonly RouteScope[] {
  const counts = new Map<string, number>()
  for (const { operation } of router.operations) {
    counts.set(operation.scheme, (counts.get(operation.scheme) ?? 0) + 1)
  }
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([scheme, routes]) => Object.freeze({ scheme: `${scheme}://`, routes }))
}

function selectOperations(router: ApiRouter, uri: string): readonly OperationDescription[] {
  const descriptions = describeOperations(router)
  const matches = new Set<string>()
  const schemeRoot = /^([a-z][a-z0-9+.-]*):\/\/$/i.exec(uri)
  if (schemeRoot !== null) {
    const scheme = schemeRoot[1]!.toLowerCase()
    for (const operation of descriptions) {
      if (operation.scheme === scheme) matches.add(operation.id)
    }
    return descriptions.filter(operation => matches.has(operation.id))
  }
  // 无效 URI 不在此报错；继续逐方法解析，由统一的 no-routes 诊断收口。
  const prefix = tryParseUri(uri)
  if (prefix !== undefined) {
    for (const operation of descriptions) {
      if (isUnderPrefix(operation, prefix)) matches.add(operation.id)
    }
  }
  for (const method of LOCUS_METHODS) {
    try {
      matches.add(router.resolve(method, uri).operation.id)
    } catch {
      // 同一资源不必实现全部方法；未匹配的方法不产生业务调用。
    }
  }
  return descriptions.filter(operation => matches.has(operation.id))
}

function tryParseUri(uri: string): InvocationUrl | undefined {
  try {
    return parseLocusUri(uri)
  } catch {
    return undefined
  }
}

/** 平铺下一级：路由模板以给定前缀按路径段边界开头即命中，例如 ws 包含 ws/:id。 */
function isUnderPrefix(operation: OperationDescription, prefix: InvocationUrl): boolean {
  if (operation.scheme !== prefix.scheme || operation.authority !== prefix.authority) return false
  return operation.path === prefix.path || operation.path.startsWith(`${prefix.path}/`)
}

function operationListText(operations: readonly OperationDescription[]): string {
  return operations
    .map(operation => {
      const lines = [
        `  ${operation.method} ${operation.scheme}://${operation.authority}${operation.path}`,
        `    ${operation.summary ?? operation.id}`,
        `    id: ${operation.id}  auth: ${operation.auth}`,
      ]
      for (const [name, field] of Object.entries(operation.fields ?? {})) {
        const traits = [
          ...(field.required === undefined
            ? []
            : [field.required ? i18n.t('routes.trait-required') : i18n.t('routes.trait-optional')]),
          ...(field.tty === true ? ['tty'] : []),
          ...(field.file === true ? ['file'] : []),
          ...(field.secret === true ? ['secret'] : []),
        ]
        lines.push(
          `    ${name}${traits.length === 0 ? '' : ` [${traits.join(', ')}]`}${field.description === undefined ? '' : `：${field.description}`}`,
        )
      }
      return lines.join('\n')
    })
    .join('\n')
}
