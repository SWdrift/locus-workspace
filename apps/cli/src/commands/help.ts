import type { Command } from 'commander'
import { describeOperation, LOCUS_METHODS } from '@locus/core/invocation'
import type { ApiRouter, OperationDescription } from '@locus/core/invocation'
import { i18n } from '../i18n.ts'
import { emit } from '../output/output.ts'

interface RouteScope {
  readonly scheme: string
  readonly routes: number
}

/** 帮助只读取已装配的声明，不创建 Session、不调用 handler 或领域服务。 */
export function registerHelpCommand(program: Command, router: ApiRouter): void {
  const help = program.command('help [uri]').description(i18n.t('command.help.description'))
  help.action((uri?: string) => {
    if (uri === undefined) {
      const scopes = routeScopes(router)
      emit(
        help,
        scopes,
        scopes
          .map(
            scope =>
              `  ${i18n.t('help.route-line', {
                scheme: scope.scheme.padEnd(12),
                count: scope.routes,
              })}`,
          )
          .join('\n'),
      )
      return
    }
    const descriptions = selectOperations(router, uri)
    if (descriptions.length === 0) help.error(i18n.t('help.no-routes', { uri }), { exitCode: 1 })
    emit(help, descriptions, operationHelpText(descriptions))
  })
}

function describeOperations(router: ApiRouter): readonly OperationDescription[] {
  return router.operations.map(({ namespace, operation }) => describeOperation(operation, namespace))
}

/** 默认只列域，不展开路由；细节由 scheme:// 或具体 URL 按需查询。 */
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
  const schemeRoot = /^([a-z][a-z0-9+.-]*):\/\/$/i.exec(uri)
  if (schemeRoot !== null) {
    const scheme = schemeRoot[1]!.toLowerCase()
    return describeOperations(router).filter(operation => operation.scheme === scheme)
  }
  const matches = new Set<string>()
  for (const method of LOCUS_METHODS) {
    try {
      matches.add(router.resolve(method, uri).operation.id)
    } catch {
      // 同一资源不必实现全部方法；未匹配的方法不产生业务调用。
    }
  }
  return describeOperations(router).filter(operation => matches.has(operation.id))
}

function operationHelpText(operations: readonly OperationDescription[]): string {
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
            : [field.required ? i18n.t('help.trait-required') : i18n.t('help.trait-optional')]),
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
