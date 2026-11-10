import type { Command } from 'commander'
import type { OperationCatalogService } from '@locus/contracts'
import type { CommandResult } from './commands.ts'

/** CLI 参数到操作输入属性的映射；领域契约不包含命令语法。 */
export interface CliArgumentProjection {
  readonly name: string
  readonly property: string
  readonly optional?: boolean
}

/** 单个操作的 CLI 呈现；路径、参数、帮助和结果格式归应用所有。 */
export interface CliOperationProjection {
  readonly operationId: string
  readonly name: string
  readonly description: string
  readonly arguments: readonly CliArgumentProjection[]
  render(value: unknown): string
  exitCode(value: unknown): number
}

export interface CliOperationRegistration {
  readonly parent: Command
  readonly catalog: OperationCatalogService | undefined
  readonly projection: CliOperationProjection
  readonly choose: (command: Command, action: () => CommandResult | Promise<CommandResult>) => void
}

/**
 * 依据已安装的 Operation Definition 构造命令。Definition 缺失时不创建命令；
 * 调用时通过 Catalog 解析当前 Provider，并保留领域 Outcome 与调用错误的分界。
 */
export function registerOperationCommand(options: CliOperationRegistration): void {
  const catalog = options.catalog
  if (catalog === undefined) return
  const definition = catalog.get(options.projection.operationId)
  if (definition === undefined) return
  const syntax = options.projection.arguments
    .map((argument) => argument.optional ? `[${argument.name}]` : `<${argument.name}>`)
    .join(' ')
  const command = options.parent.command(
    syntax.length === 0 ? options.projection.name : `${options.projection.name} ${syntax}`,
  ).description(options.projection.description)

  command.action((...raw: unknown[]) => {
    const input: Record<string, unknown> = {}
    for (const [index, argument] of options.projection.arguments.entries()) {
      const value = raw[index]
      if (typeof value === 'string') input[argument.property] = value
    }
    options.choose(command, async () => {
      const result = await catalog.invoke(definition, input, {})
      if (!result.ok) {
        throw new Error(
          `${options.projection.operationId} 调用失败 [${result.error.code}]：${result.error.message}`,
        )
      }
      return {
        value: result.value,
        text: options.projection.render(result.value),
        exitCode: options.projection.exitCode(result.value),
      }
    })
  })
}
