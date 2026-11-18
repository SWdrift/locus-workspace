import type { Command } from 'commander'
import { describeOperation, LOCUS_METHODS } from '@locus/core/invocation'
import type { ApiRouter, OperationDescription } from '@locus/core/invocation'
import { emit } from '../output/output.ts'

/** 帮助只读取已装配的声明，不创建 Session、不调用 handler 或领域服务。 */
export function registerHelpCommand(program: Command, router: ApiRouter): void {
  program.addHelpText('after', () => `\n已注册路由：\n${operationHelpText(describeOperations(router))}\n`)
  const help = program.command('help [uri]').description('查看已注册 URL 的方法与输入声明；支持 scheme:// 筛选')
  help.action((uri?: string) => {
    if (uri === undefined) {
      program.outputHelp()
      return
    }
    const descriptions = selectOperations(router, uri)
    if (descriptions.length === 0) help.error(`没有匹配的已注册路由：${uri}`, { exitCode: 1 })
    emit(help, descriptions, operationHelpText(descriptions))
  })
}

function describeOperations(router: ApiRouter): readonly OperationDescription[] {
  return router.operations.map(({ namespace, operation }) => describeOperation(operation, namespace))
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
          ...(field.required === undefined ? [] : [field.required ? '必填' : '可选']),
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
