import { Option } from 'commander'
import type { Command } from 'commander'
import type { Workspace, WorkspaceRelation } from '@locus/core/workspaces'
import { mountText, relationText, workspaceText } from '../output/format.ts'
import { emit } from '../output/output.ts'
import { pathParam } from './shared.ts'
import type { CallOperation } from './shared.ts'

export function registerWorkspaceCommands(program: Command, call: CallOperation): void {
  const workspace = program.command('workspace').description('持久工作语境与显式关系，不依赖目录')
  const create = workspace.command('create <name>').description('创建具有新 UUID 的 Workspace，可无目录')
  create.action(async (name: string) => {
    const result = (await call('POST', 'locus://workspaces', { name })) as Workspace
    emit(create, result, workspaceText(result))
  })
  const list = workspace.command('list').description('列举长期 Workspace')
  list.action(async () => {
    const result = (await call('GET', 'locus://workspaces')) as Workspace[]
    emit(
      list,
      result,
      result.map(item => `${item.id}  ${item.name}  [${item.mounts.length} 挂载]`).join('\n') || '没有 Workspace。',
    )
  })
  const show = workspace.command('show <workspace>').alias('open').description('按 Identity 或唯一名称查看挂载与关系')
  show.action(async (reference: string) => {
    const result = (await call('GET', `locus://workspaces/${pathParam(reference)}`)) as Workspace
    emit(show, result, workspaceText(result))
  })
  const rename = workspace.command('rename <workspace> <name>').description('改名而不改变 Identity')
  rename.action(async (reference: string, name: string) => {
    const result = (await call('PATCH', `locus://workspaces/${pathParam(reference)}`, { name })) as Workspace
    emit(rename, result, workspaceText(result))
  })
  const remove = workspace
    .command('remove <workspace>')
    .description('删除 Workspace 及其挂载与关系，不删除外部目录')
    .requiredOption('--yes', '确认删除；不等待交互输入')
  remove.action(async (reference: string) => {
    const result = await call('DELETE', `locus://workspaces/${pathParam(reference)}`)
    emit(remove, result, `已删除 Workspace ${reference}；外部目录未删除。`)
  })
  const link = workspace
    .command('link <workspace> <namespace> <reference>')
    .description('显式保存外部引用；关联 Workspace 时 namespace 为 locus.workspace')
    .addOption(new Option('--kind <kind>', '长期关系种类').choices(['member', 'association']).default('association'))
    .option('--source <detail>', '确认来源说明', 'CLI 显式输入')
  link.action(async (workspaceReference: string, namespace: string, reference: string) => {
    const source = link.opts<{ kind: WorkspaceRelation['kind']; source: string }>()
    const result = (await call('POST', `locus://workspaces/${pathParam(workspaceReference)}/relations`, {
      kind: source.kind,
      namespace,
      id: reference,
      source: { kind: 'manual', detail: source.source },
    })) as WorkspaceRelation
    emit(link, result, relationText(result))
  })
  const unlink = workspace
    .command('unlink <workspace> <relation-id>')
    .description('仅解除这条长期关系，不删除外部资源或被引用 Workspace')
    .requiredOption('--yes', '确认移除关系；不等待交互输入')
  unlink.action(async (reference: string, relationId: string) => {
    const result = await call('DELETE', `locus://workspaces/${pathParam(reference)}/relations/${pathParam(relationId)}`)
    emit(unlink, result, `已解除关系 ${relationId}；外部资源未删除。`)
  })
  const mount = workspace
    .command('mount <workspace> <path>')
    .description('挂载本机绝对目录；默认名称取目录名')
    .option('--name <name>', '挂载名称，用于 shell 环境变量')
  mount.action(async (reference: string, path: string) => {
    const name = mount.opts<{ name?: string }>().name
    const result = (await call('POST', `locus://workspaces/${pathParam(reference)}/mounts`, {
      path,
      ...(name === undefined ? {} : { name }),
    })) as Workspace['mounts'][number]
    emit(mount, result, mountText(result))
  })
  const mounts = workspace.command('mounts <workspace>').description('列举 Workspace 的本机挂载')
  mounts.action(async (reference: string) => {
    const result = (await call('GET', `locus://workspaces/${pathParam(reference)}/mounts`)) as Workspace['mounts']
    emit(mounts, result, result.map(mountText).join('\n') || '没有挂载。')
  })
  const unmount = workspace
    .command('unmount <workspace> <mount>')
    .description('取消挂载，不删除外部目录')
    .requiredOption('--yes', '确认取消挂载；不等待交互输入')
  unmount.action(async (reference: string, mountReference: string) => {
    const result = await call(
      'DELETE',
      `locus://workspaces/${pathParam(reference)}/mounts/${pathParam(mountReference)}`,
    )
    emit(unmount, result, `已取消挂载 ${mountReference}；外部目录未删除。`)
  })
}
