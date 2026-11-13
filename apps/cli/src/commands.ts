import { Command, Option } from 'commander'
import type { LocusCore, Mount, Workspace, WorkspaceRelation } from '@locus/core'
import { runWorkspaceShell } from './shell.ts'

function jsonEnabled(command: Command): boolean {
  return command.optsWithGlobals<{ json?: boolean }>().json === true
}

function emit(command: Command, value: unknown, text: string): void {
  process.stdout.write(jsonEnabled(command) ? `${JSON.stringify(value)}\n` : `${text}\n`)
}

function relationText(relation: WorkspaceRelation): string {
  return `${relation.id}  ${relation.kind}  ${relation.target.namespace}  ${relation.target.id}  [${relation.source.kind}: ${relation.source.detail}]`
}

function mountText(mount: Mount): string {
  return `${mount.id}  ${mount.name}  ${mount.path}`
}

function workspaceText(workspace: Workspace): string {
  const relations = workspace.relations.map(relationText)
  const mounts = workspace.mounts.map(mountText)
  return [
    `Workspace: ${workspace.name}`,
    `Identity: ${workspace.id}`,
    `创建时间: ${workspace.createdAt}`,
    '挂载:',
    ...mounts.map((line) => `  ${line}`),
    ...(mounts.length ? [] : ['  无']),
    '长期关系:',
    ...relations.map((line) => `  ${line}`),
    ...(relations.length ? [] : ['  无']),
  ].join('\n')
}

/** CLI 接受稳定 Identity 或唯一名称；名称歧义时要求使用 Identity。 */
function resolveWorkspace(locus: LocusCore, reference: string): Workspace {
  const workspaces = locus.workspaces.list()
  const byId = workspaces.find((workspace) => workspace.id === reference)
  if (byId !== undefined) return byId
  const byName = workspaces.filter((workspace) => workspace.name === reference)
  if (byName.length === 1 && byName[0] !== undefined) return byName[0]
  if (byName.length > 1) {
    throw new Error(`Workspace 名称不唯一：${reference}；请使用 Identity`)
  }
  throw new Error(`找不到 Workspace：${reference}`)
}

/** 构造独立 CLI 的命令树；所有用例直接调用 Core 的公开 Workspace 服务。 */
export function createProgram(locus: LocusCore): Command {
  const program = new Command()
    .name('locus')
    .description('Locus 本地工作空间：Workspace 身份与显式长期关系。')
    .option('--json', '输出机器可读 JSON，诊断仍写入 stderr')
    .usage('[options] [command]')
    .showHelpAfterError()
    .argument('[command]')
    .action((command?: string) => {
      if (command === undefined) {
        program.help({ error: true })
      }
      program.error(`未知命令：${command}`, { exitCode: 1 })
    })

  const version = program.command('version').description('读取 Locus 产品版本')
  version.action(() => {
    emit(version, locus.info, locus.info.version)
  })

  const workspace = program.command('workspace').description('持久工作语境与显式关系，不依赖目录')
  const create = workspace.command('create <name>').description('创建具有新 UUID 的 Workspace，可无目录')
  create.action((name: string) => {
    const result = locus.workspaces.create(name)
    emit(create, result, workspaceText(result))
  })
  const list = workspace.command('list').description('列举长期 Workspace')
  list.action(() => {
    const result = locus.workspaces.list()
    emit(
      list,
      result,
      result.map((item) => `${item.id}  ${item.name}  [${item.mounts.length} 挂载]`).join('\n')
        || '没有 Workspace。',
    )
  })
  const show = workspace.command('show <workspace>').alias('open').description('按 Identity 或唯一名称查看挂载与关系')
  show.action((reference: string) => {
    const result = resolveWorkspace(locus, reference)
    emit(show, result, workspaceText(result))
  })
  const rename = workspace.command('rename <workspace> <name>').description('改名而不改变 Identity')
  rename.action((reference: string, name: string) => {
    const target = resolveWorkspace(locus, reference)
    const result = locus.workspaces.rename(target.id, name)
    emit(rename, result, workspaceText(result))
  })
  const remove = workspace.command('remove <workspace>')
    .description('删除 Workspace 及其挂载与关系，不删除外部目录')
    .requiredOption('--yes', '确认删除；不等待交互输入')
  remove.action((reference: string) => {
    const target = resolveWorkspace(locus, reference)
    locus.workspaces.remove(target.id)
    emit(remove, { workspaceId: target.id, removed: true }, `已删除 Workspace ${target.id}；外部目录未删除。`)
  })
  const link = workspace.command('link <workspace> <namespace> <reference>')
    .description('显式保存外部引用；关联 Workspace 时 namespace 为 locus.workspace')
    .addOption(new Option('--kind <kind>', '长期关系种类').choices(['member', 'association']).default('association'))
    .option('--source <detail>', '确认来源说明', 'CLI 显式输入')
  link.action((workspaceReference: string, namespace: string, reference: string) => {
    const target = resolveWorkspace(locus, workspaceReference)
    const options = link.opts<{ kind: WorkspaceRelation['kind']; source: string }>()
    const result = locus.workspaces.link(
      target.id,
      options.kind,
      { namespace, id: reference },
      { kind: 'manual', detail: options.source },
    )
    emit(link, result, relationText(result))
  })
  const unlink = workspace.command('unlink <workspace> <relation-id>')
    .description('仅解除这条长期关系，不删除外部资源或被引用 Workspace')
    .requiredOption('--yes', '确认移除关系；不等待交互输入')
  unlink.action((reference: string, relationId: string) => {
    const target = resolveWorkspace(locus, reference)
    locus.workspaces.unlink(target.id, relationId)
    emit(
      unlink,
      { workspaceId: target.id, removedRelationId: relationId },
      `已解除关系 ${relationId}；外部资源未删除。`,
    )
  })
  const mount = workspace.command('mount <workspace> <path>')
    .description('挂载本机绝对目录；默认名称取目录名')
    .option('--name <name>', '挂载名称，用于 shell 环境变量')
  mount.action((reference: string, path: string) => {
    const target = resolveWorkspace(locus, reference)
    const name = mount.opts<{ name?: string }>().name
    const result = name === undefined
      ? locus.mounts.add(target.id, path)
      : locus.mounts.add(target.id, path, { name })
    emit(mount, result, mountText(result))
  })
  const mounts = workspace.command('mounts <workspace>').description('列举 Workspace 的本机挂载')
  mounts.action((reference: string) => {
    const target = resolveWorkspace(locus, reference)
    const result = locus.mounts.list(target.id)
    emit(mounts, result, result.map(mountText).join('\n') || '没有挂载。')
  })
  const unmount = workspace.command('unmount <workspace> <mount>')
    .description('取消挂载，不删除外部目录')
    .requiredOption('--yes', '确认取消挂载；不等待交互输入')
  unmount.action((reference: string, mountReference: string) => {
    const target = resolveWorkspace(locus, reference)
    locus.mounts.remove(target.id, mountReference)
    emit(
      unmount,
      { workspaceId: target.id, removedMount: mountReference },
      `已取消挂载 ${mountReference}；外部目录未删除。`,
    )
  })

  const shell = program.command('shell <workspace>')
    .description('在 Workspace 上下文中启动用户 shell；注入 locus、挂载与 LOCUS_* 环境')
    .option('--shell <path>', '指定 shell 可执行文件')
    .option('--command <command>', '执行一条命令后退出，不进入交互模式')
    .option('--print-env', '只输出解析后的 shell 上下文 JSON，不启动 shell')
  shell.action((reference: string) => {
    const target = resolveWorkspace(locus, reference)
    const options = shell.opts<{
      shell?: string | undefined
      command?: string | undefined
      printEnv?: boolean | undefined
    }>()
    const exitCode = runWorkspaceShell(locus, target, options)
    if (exitCode !== 0) {
      process.exitCode = exitCode
    }
  })

  return program
}
