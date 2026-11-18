import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Command } from 'commander'
import type { ComponentView } from '@locus/core/components'
import { componentLine, componentText } from '../output/format.ts'
import { emit } from '../output/output.ts'
import { pathParam } from './shared.ts'
import type { CallOperation } from './shared.ts'

export function registerComponentCommands(program: Command, call: CallOperation): void {
  const component = program.command('component').description('组件定义、状态与生命周期')
  const list = component.command('list').description('列出包组件与动态组件')
  list.action(async () => {
    const result = (await call('GET', 'locus://components')) as {
      components: ComponentView[]
      problems: Array<{ id: string; source: string; path: string; error: string }>
    }
    emit(
      list,
      result,
      [
        ...result.components.map(componentLine),
        ...result.problems.map(problem => `! ${problem.id}  ${problem.source}  ${problem.path}  ${problem.error}`),
      ].join('\n') || '没有组件。',
    )
  })
  const show = component.command('show <id>').description('查看定义、状态与说明')
  show.action(async (id: string) => {
    const result = (await call('GET', `locus://components/${pathParam(id)}`)) as ComponentView
    emit(show, result, componentText(result))
  })
  const add = component.command('add <source>').description('登记动态组件：YAML 文件、包含 component.yaml 的文件夹或 -')
  add.action(async (source: string) => {
    const result = (await call(
      'POST',
      'locus://components',
      source === '-' ? { text: readFileSync(0, 'utf8') } : { path: resolve(source) },
    )) as ComponentView
    emit(add, result, `已登记组件 ${result.id}\n${componentText(result)}`)
  })
  const upgrade = component.command('upgrade <id>').description('按包代码刷新定义字段，保留 config')
  upgrade.action(async (id: string) => {
    const result = (await call('POST', `locus://components/${pathParam(id)}/actions/upgrade`)) as ComponentView
    emit(upgrade, result, `已升级组件 ${result.id}\n${componentText(result)}`)
  })
  const remove = component
    .command('remove <id>')
    .description('删除动态组件定义与状态，不触碰外部软件')
    .requiredOption('--yes', '确认删除；不等待交互输入')
  remove.action(async (id: string) => {
    const result = await call('DELETE', `locus://components/${pathParam(id)}`)
    emit(remove, result, `已删除组件 ${id}；外部软件未变更。`)
  })
  const probe = component
    .command('probe [id]')
    .description('执行声明的探针并记录外部状态；--all 探查所有 external 组件')
    .option('--all', '探查所有 external 组件')
  probe.action(async (id?: string) => {
    if (probe.opts<{ all?: boolean }>().all === true) {
      if (id !== undefined) probe.error('--all 不能与组件 id 同时使用', { exitCode: 1 })
      const result = (await call('POST', 'locus://components/actions/probe')) as {
        probed: ComponentView[]
        skipped: Array<{ id: string; reason: string }>
      }
      emit(
        probe,
        result,
        [
          ...result.probed.map(view => `${view.id}  ${view.external?.state ?? '不适用'}`),
          ...result.skipped.map(item => `${item.id}  跳过  ${item.reason}`),
        ].join('\n') || '没有可探查的组件。',
      )
      if (result.skipped.length > 0 || result.probed.some(view => view.external?.state !== 'healthy'))
        process.exitCode = 1
      return
    }
    if (id === undefined) {
      probe.error('缺少组件 id 或 --all', { exitCode: 1 })
      return
    }
    const result = (await call('POST', `locus://components/${pathParam(id)}/actions/probe`)) as ComponentView
    emit(probe, result, `${result.id}  ${result.external?.state ?? '不适用'}`)
    if (result.external?.state !== 'healthy') process.exitCode = 1
  })
  const deploy = component
    .command('deploy <id>')
    .description('执行声明的部署入口并记录结果')
    .requiredOption('--yes', '确认执行部署；不等待交互输入')
  deploy.action(async (id: string) => {
    const result = (await call('POST', `locus://components/${pathParam(id)}/actions/deploy`)) as ComponentView
    emit(deploy, result, `${result.id}  ${result.deploy.state}  ${result.deploy.detail}`)
    if (result.deploy.state !== 'deployed') process.exitCode = 1
  })
}
