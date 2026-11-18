import { resolve } from 'node:path'
import type { Command } from 'commander'
import type { ComponentView } from '@locus/core/components'
import { componentText } from '../output/format.ts'
import { emit } from '../output/output.ts'
import { pathParam } from './shared.ts'
import type { CallOperation } from './shared.ts'

export function registerTemplateCommands(program: Command, call: CallOperation): void {
  const template = program.command('template').description('本机项目模板：复制文件夹并记录来源')
  template.action(async () => {
    const result = (await call('GET', 'locus://components/template')) as ComponentView
    emit(template, result, componentText(result))
  })
  const list = template.command('list').description('列出内置模板')
  list.action(async () => {
    const result = (await call('GET', 'template://templates')) as Array<{
      id: string
      version?: string
      name: string
      description?: string
    }>
    emit(
      list,
      result,
      result
        .map(
          item => `${item.id}  ${item.version ?? '-'}  ${item.name}${item.description ? `  ${item.description}` : ''}`,
        )
        .join('\n') || '没有内置模板。',
    )
  })
  const create = template
    .command('create <template> <destination>')
    .description('复制模板到新目录；目标必须不存在')
    .option('--dry-run', '只计算文件、目录与 digest，不写目标')
  create.action(async (templateReference: string, destination: string) => {
    const result = (await call('POST', `template://templates/${pathParam(templateReference)}/instances`, {
      destination: resolve(destination),
      dryRun: create.opts<{ dryRun?: boolean }>().dryRun === true,
    })) as {
      dryRun: boolean
      destination: string
      template: { id: string; version?: string }
      files: readonly unknown[]
      directories: readonly unknown[]
      digest: string
      metadataPath?: string
    }
    emit(
      create,
      result,
      [
        result.dryRun ? `将创建：${result.destination}` : `已创建：${result.destination}`,
        `模板：${result.template.id}${result.template.version === undefined ? '' : `@${result.template.version}`}`,
        `文件：${result.files.length}  目录：${result.directories.length}`,
        `Digest：${result.digest}`,
        ...(result.dryRun || result.metadataPath === undefined ? [] : [`实例记录：${result.metadataPath}`]),
      ].join('\n'),
    )
  })
}
