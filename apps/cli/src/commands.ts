import { Command, Option } from 'commander'
import type { LocusCore, Workspace, WorkspaceRelation } from '@locus/core'

function jsonEnabled(command: Command): boolean {
  return command.optsWithGlobals<{ json?: boolean }>().json === true
}

function emit(command: Command, value: unknown, text: string): void {
  process.stdout.write(jsonEnabled(command) ? `${JSON.stringify(value)}\n` : `${text}\n`)
}

function relationText(relation: WorkspaceRelation): string {
  return `${relation.id}  ${relation.kind}  ${relation.target.namespace}  ${relation.target.id}  [${relation.source.kind}: ${relation.source.detail}]`
}

function workspaceText(workspace: Workspace): string {
  const relations = workspace.relations.map(relationText)
  return [
    `Workspace: ${workspace.name}`,
    `Identity: ${workspace.id}`,
    `创建时间: ${workspace.createdAt}`,
    '长期关系:',
    ...relations.map((line) => `  ${line}`),
    ...(relations.length ? [] : ['  无']),
  ].join('\n')
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
      result.map((item) => `${item.id}  ${item.name}`).join('\n') || '没有 Workspace。',
    )
  })
  const show = workspace.command('show <id>').alias('open').description('按 Identity 打开并查看；不设置隐式当前目录')
  show.action((id: string) => {
    const result = locus.workspaces.get(id)
    emit(show, result, workspaceText(result))
  })
  const rename = workspace.command('rename <id> <name>').description('改名而不改变 Identity')
  rename.action((id: string, name: string) => {
    const result = locus.workspaces.rename(id, name)
    emit(rename, result, workspaceText(result))
  })
  const link = workspace.command('link <id> <namespace> <reference>')
    .description('显式保存外部引用；关联 Workspace 时 namespace 为 locus.workspace')
    .addOption(new Option('--kind <kind>', '长期关系种类').choices(['member', 'association']).default('association'))
    .option('--source <detail>', '确认来源说明', 'CLI 显式输入')
  link.action((id: string, namespace: string, reference: string) => {
    const options = link.opts<{ kind: WorkspaceRelation['kind']; source: string }>()
    const result = locus.workspaces.link(
      id,
      options.kind,
      { namespace, id: reference },
      { kind: 'manual', detail: options.source },
    )
    emit(link, result, relationText(result))
  })
  const unlink = workspace.command('unlink <id> <relation-id>')
    .description('仅解除这条长期关系，不删除外部资源或被引用 Workspace')
    .requiredOption('--yes', '确认移除关系；不等待交互输入')
  unlink.action((id: string, relationId: string) => {
    locus.workspaces.unlink(id, relationId)
    emit(unlink, { workspaceId: id, removedRelationId: relationId }, `已解除关系 ${relationId}；外部资源未删除。`)
  })

  return program
}
