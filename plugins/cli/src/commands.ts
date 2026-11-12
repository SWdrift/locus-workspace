import { Command, InvalidArgumentError, Option } from 'commander'
import type {
  FilesystemObservation,
  FilesystemService,
  LocusService,
  Workspace,
  WorkspaceRelation,
} from '@locus/contracts'

export interface CommandResult {
  readonly value: unknown
  readonly text: string
  readonly exitCode?: number
}

export interface ParsedCommand {
  readonly program: Command
  execute(): Promise<CommandResult> | undefined
  json(): boolean
  shell(): boolean
  parse(argv: readonly string[]): void
}

function integer(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    throw new InvalidArgumentError('必须为正整数。')
  }
  return Number(value)
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

function relationText(relation: WorkspaceRelation): string {
  return `${relation.id}  ${relation.kind}  ${relation.target.namespace}  ${relation.target.id}  [${relation.source.kind}: ${relation.source.detail}]`
}

function observationText(value: FilesystemObservation): string {
  return `${value.state}  ${value.kind}  ${value.path}${value.error ? `  (${value.error})` : ''}`
}

export function createCommands(
  locus: LocusService,
  filesystem: FilesystemService | undefined,
): ParsedCommand {
  const program = new Command()
    .name('dsh --profile locus')
    .description('Locus 长期 Workspace；目录登记、发现与成员确认相互独立。')
    .option('--json', '输出机器可读 JSON，诊断仍写入 stderr')
    .usage('[options] [command]')
    .showHelpAfterError()
  let operation: (() => CommandResult | Promise<CommandResult>) | undefined
  let selected = program
  let shellMode = false
  const choose = (command: Command, action: () => CommandResult | Promise<CommandResult>): void => {
    selected = command
    operation = action
  }
  const fs = (): FilesystemService => {
    if (!filesystem) throw new Error('Filesystem 能力不可用：profile 未加载 locusFilesystem；Workspace 与已保存关系不受影响。')
    return filesystem
  }

  program.argument('[command]')
  program.action((command?: string) => {
    program.error(command === undefined ? '请指定命令，使用 --help 查看操作。' : `未知命令：${command}`, { exitCode: 1 })
  })
  const version = program.command('version').description('读取 Locus 产品版本（不是 DSH 版本）')
  version.action(() => choose(version, () => ({ value: locus.info, text: locus.info.version })))

  const shell = program.command('shell').description('进入长驻交互式 shell，复用当前 DSH 进程中的命令树')
  shell.action(() => {
    shellMode = true
    selected = shell
  })

  const workspace = program.command('workspace').description('持久工作语境与显式关系，不依赖目录')
  const create = workspace.command('create <name>').description('创建具有新 UUID 的 Workspace，可无目录')
  create.action((name: string) => choose(create, () => {
    const result = locus.workspaces.create(name)
    return { value: result, text: workspaceText(result) }
  }))
  const list = workspace.command('list').description('列举长期 Workspace')
  list.action(() => choose(list, () => {
    const result = locus.workspaces.list()
    return { value: result, text: result.map((item) => `${item.id}  ${item.name}`).join('\n') || '没有 Workspace。' }
  }))
  const show = workspace.command('show <id>').alias('open').description('按 Identity 打开并查看；不设置隐藏的当前目录或会话')
  show.action((id: string) => choose(show, () => {
    const result = locus.workspaces.get(id)
    return { value: result, text: workspaceText(result) }
  }))
  const rename = workspace.command('rename <id> <name>').description('改名而不改变 Identity')
  rename.action((id: string, name: string) => choose(rename, () => {
    const result = locus.workspaces.rename(id, name)
    return { value: result, text: workspaceText(result) }
  }))
  const link = workspace.command('link <id> <namespace> <reference>')
    .description('显式保存外部引用；关联 Workspace 时 namespace 为 locus.workspace')
    .addOption(new Option('--kind <kind>', '长期关系种类').choices(['member', 'association']).default('association'))
    .option('--source <detail>', '确认来源说明', 'CLI 显式输入')
  link.action((id: string, namespace: string, reference: string) => choose(link, () => {
    const result = locus.workspaces.link(id, link.opts<{ kind: WorkspaceRelation['kind'] }>().kind, { namespace, id: reference }, {
      kind: 'manual', detail: String(link.opts().source),
    })
    return { value: result, text: relationText(result) }
  }))
  const unlink = workspace.command('unlink <id> <relation-id>')
    .description('仅解除这条长期关系，不删除外部资源或被引用 Workspace')
    .requiredOption('--yes', '确认移除关系；不等待交互输入')
  unlink.action((id: string, relationId: string) => choose(unlink, () => {
    locus.workspaces.unlink(id, relationId)
    return { value: { workspaceId: id, removedRelationId: relationId }, text: `已解除关系 ${relationId}；外部资源未删除。` }
  }))

  const files = program.command('fs').description('Filesystem：显式位置、单层发现与按需读取，不自动确认成员')
  const register = files.command('register <workspace> <path>').description('登记发现位置；允许路径当前缺失')
  register.action((id: string, path: string) => choose(register, () => {
    const result = fs().register(id, path)
    return { value: result, text: `${result.id}  ${result.path}\n仅登记发现位置，尚未确认为成员。` }
  }))
  const locations = files.command('locations <workspace>').description('列举已登记位置')
  locations.action((id: string) => choose(locations, () => {
    const result = fs().locations(id)
    return { value: result, text: result.map((item) => `${item.id}  ${item.path}`).join('\n') || '没有已登记位置。' }
  }))
  const unregister = files.command('unregister <workspace> <location>')
    .description('取消位置登记，不删除文件或已确认关系')
    .requiredOption('--yes', '确认取消，不等待交互输入')
  unregister.action((id: string, location: string) => choose(unregister, () => {
    fs().unregister(id, location)
    return { value: { workspaceId: id, removedLocationId: location }, text: `已取消位置 ${location}；文件与长期关系未删除。` }
  }))
  const inspect = files.command('inspect <workspace> <location> [relative]').description('读取当前资源状态，区分缺失、拒绝与观察错误')
  inspect.action((id: string, location: string, relative?: string) => choose(inspect, async () => {
    const result = await fs().inspect(id, location, relative)
    return { value: result, text: observationText(result) }
  }))
  const discover = files.command('discover <workspace> <location> [relative]')
    .description('只发现指定目录一层；不递归，不跟随符号链接，不登记成员')
    .option('--limit <count>', '最多返回的条目数（1–1000）', integer, 200)
  discover.action((id: string, location: string, relative?: string) => choose(discover, async () => {
    const result = await fs().discover(id, location, relative, Number(discover.opts().limit))
    return {
      value: result,
      text: [observationText(result.root), ...result.entries.map(observationText), result.truncated ? '结果已截断。' : '发现完成；尚未确认的结果不是长期成员。'].join('\n'),
      exitCode: result.root.state === 'accessible' ? 0 : 2,
    }
  }))
  const read = files.command('read <workspace> <location> [relative]')
    .description('读取普通文件 UTF-8 文本（有界，不修改原文件）')
    .option('--max-bytes <count>', '最多读取字节数（1–1048576）', integer, 65536)
  read.action((id: string, location: string, relative?: string) => choose(read, async () => {
    const result = await fs().read(id, location, relative, Number(read.opts().maxBytes))
    return { value: result, text: `${result.resource.path}\n${result.text}${result.truncated ? '\n[内容已截断]' : ''}` }
  }))
  const confirm = files.command('confirm <workspace> <location> [relative]')
    .description('显式确认当前可访问资源为成员或关联；只保存引用，不复制文件')
    .addOption(new Option('--kind <kind>', '长期关系种类').choices(['member', 'association']).default('member'))
  confirm.action((id: string, location: string, relative?: string) => choose(confirm, async () => {
    const resource = await fs().inspect(id, location, relative)
    if (resource.state !== 'accessible') throw new Error(`无法确认 ${resource.path}：${resource.state}${resource.error ? ` (${resource.error})` : ''}`)
    const result = locus.workspaces.link(id, confirm.opts<{ kind: WorkspaceRelation['kind'] }>().kind, resource.reference, {
      kind: 'discovery', detail: `Filesystem 位置 ${location}，路径 ${resource.path}`,
    })
    return { value: result, text: relationText(result) }
  }))

  return {
    program,
    execute: () => operation ? Promise.resolve().then(operation) : undefined,
    json: () => selected.optsWithGlobals<{ json?: boolean }>().json === true,
    shell: () => shellMode,
    parse: (argv) => {
      operation = undefined
      selected = program
      shellMode = false
      program.parse([...argv], { from: 'user' })
    },
  }
}
