import { Command, InvalidArgumentError, Option } from 'commander'
import type {
  CapabilityDescriptor,
  FilesystemObservation,
  FilesystemService,
  GitService,
  LocusService,
  SessionService,
  SessionSummary,
  Workspace,
  WorkspaceRelation,
} from '@locus/contracts'
import { SESSION_NAMESPACE_PREFIX } from '@locus/contracts'

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
  const capabilities = workspace.capabilities.map((item) => `${item.id} (${item.provider})`)
  return [
    `Workspace: ${workspace.name}`,
    `Identity: ${workspace.id}`,
    `创建时间: ${workspace.createdAt}`,
    `能力选择: ${capabilities.join(', ') || '无'}`,
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

function sessionText(value: SessionSummary): string {
  const title = value.title === undefined ? '' : `  ${value.title}`
  const directory = value.cwd === undefined ? '（无 cwd）' : value.cwd
  return `${value.state}  ${value.sessionId}  ${directory}${title}${value.error ? `  (${value.error})` : ''}`
}

/** 语法解析只选择用例，异步 I/O 留到 parseCmdline 完成后执行。 */
export function createCommands(
  locus: LocusService,
  filesystem: FilesystemService | undefined,
  git: GitService | undefined,
  session: SessionService | undefined,
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
  const sessionService = (): SessionService => {
    if (!session) throw new Error('Session 能力不可用：profile 未加载 locusSession；Workspace 与已保存关系不受影响。')
    return session
  }
  const declared: CapabilityDescriptor[] = []
  if (filesystem) declared.push(filesystem.capability)
  if (git) declared.push(git.capability)
  if (session) declared.push(session.capability)
  const descriptor = (input: string): CapabilityDescriptor => {
    const result = declared.find((item) => item.id === input || item.provider === input)
      ?? declared.find((item) => item.id === `locus.${input}`)
    if (!result) {
      const available = declared.map((item) => item.id).join(', ') || '无'
      throw new Error(`没有已加载的提供方匹配 ${input}；可用能力：${available}。先在 profile 装配对应插件。`)
    }
    return result
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

  const capability = program.command('capability').description('Workspace 能力选择与当前提供方状态；Tag 不参与依赖或授权')
  const status = capability.command('list <id>').description('分别查看声明、配置、提供方加载与可用性')
  status.action((id: string) => choose(status, async () => {
    const current = locus.workspaces.get(id)
    const gitAvailability = git ? await git.availability() : undefined
    const sessionAvailability = session ? await session.availability() : undefined
    const loaded = new Map(declared.map((item) => [item.id, item]))
    const ids = new Set([...current.capabilities.map((item) => item.id), ...loaded.keys()])
    const result = [...ids].map((capabilityId) => {
      const configured = current.capabilities.find((entry) => entry.id === capabilityId)
      const provider = loaded.get(capabilityId)
      const declaredHere = provider !== undefined
      const sameProvider = configured === undefined || provider === undefined || configured.provider === provider.provider
      const loadedHere = declaredHere && sameProvider
      const available = loadedHere && (
        capabilityId === 'locus.git'
          ? gitAvailability?.available === true
          : capabilityId === 'locus.session'
            ? sessionAvailability?.available === true
            : true
      )
      const reason = !declaredHere
        ? '所选提供方未加载；长期配置与关系保留。'
        : !sameProvider
          ? `已加载提供方 ${provider.provider} 与保存选择 ${configured?.provider} 不同；未自动替换。`
          : !available
            ? capabilityId === 'locus.git'
              ? gitAvailability?.error ?? '原生依赖不可用。'
              : sessionAvailability?.error ?? 'Session 查询服务不可用。'
            : '服务已就绪；具体资源的访问状态由能力查询。'
      return {
        id: capabilityId,
        provider: configured?.provider ?? provider?.provider ?? 'unknown',
        tags: configured?.tags ?? provider?.tags ?? [],
        declared: declaredHere,
        configured: configured !== undefined,
        loaded: loadedHere,
        available,
        authorization: loadedHere ? 'checked-per-operation' : 'unknown',
        reason,
      }
    })
    return {
      value: result,
      text: result.map((item) => `${item.id}  ${item.provider}  声明=${item.declared ? '是' : '否'} 配置=${item.configured ? '是' : '否'} 加载=${item.loaded ? '是' : '否'} 可用=${item.available ? '是' : '否'}  ${item.reason}`).join('\n') || '没有能力声明或已保存选择。',
    }
  }))
  const configure = capability.command('configure <id> <capability>').description('选择已加载提供方，例如 filesystem；不授予操作权限')
  configure.action((id: string, name: string) => choose(configure, () => {
    const result = locus.workspaces.configureCapability(id, descriptor(name))
    return { value: result, text: workspaceText(result) }
  }))
  const remove = capability.command('remove <id> <capability>')
    .description('取消能力选择，保留领域配置和成员；不卸载 Plugin')
    .requiredOption('--yes', '确认取消，不等待交互输入')
  remove.action((id: string, name: string) => choose(remove, () => {
    const saved = locus.workspaces.get(id).capabilities.find((entry) => entry.id === name || entry.provider === name)
    if (!saved && (name.includes('@') || name.includes('/'))) {
      throw new Error(`Workspace 未保存提供方 ${name} 的能力选择`)
    }
    const capabilityId = saved?.id ?? (name.startsWith('locus.') ? name : `locus.${name}`)
    const result = locus.workspaces.removeCapability(id, capabilityId)
    return { value: result, text: workspaceText(result) }
  }))

  const files = program.command('fs').description('Filesystem：显式位置、单层发现与按需读取，不自动确认成员')
  const register = files.command('register <workspace> <path>').description('登记位置；先 capability configure，允许缺失路径')
  register.action((id: string, path: string) => choose(register, () => {
    const result = fs().register(id, path)
    return { value: result, text: `${result.id}  ${result.path}\n仅登记发现位置，尚未确认为成员。` }
  }))
  const locations = files.command('locations <workspace>').description('列举位置配置；取消能力选择后仍可查看')
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

  const repositories = program.command('git').description('只读 Git；直接使用 Filesystem 的位置，不要求每个 Workspace 有仓库')
  const gitInspect = repositories.command('inspect <workspace> <location> [relative]').description('查询真实仓库、分支、提交、工作区状态与脱敏 Remote')
  gitInspect.action((id: string, location: string, relative?: string) => choose(gitInspect, async () => {
    if (!git) throw new Error('Git 能力不可用：profile 未提供 locusGit；Workspace 和 Filesystem 不受影响。')
    const result = await git.inspect(id, location, relative)
    const text = result.state === 'repository'
      ? [
        `仓库: ${result.root}`,
        `分支: ${result.branch ?? 'detached HEAD'}`,
        `提交: ${result.commit ?? '尚无提交'}`,
        `工作区: ${result.dirty ? '有变化' : '干净'}`,
        ...(result.remotes ?? []).map((remote) => `${remote.name}  ${remote.url}`),
      ].join('\n')
      : `${result.state}: ${result.filesystem.path}${result.error ? ` (${result.error})` : ''}`
    return { value: result, text, exitCode: result.state === 'repository' || result.state === 'not-repository' ? 0 : 2 }
  }))
  const gitConfirm = repositories.command('confirm <workspace> <location> [relative]')
    .description('显式关联观察到的本地仓库，不自动登记 Remote')
  gitConfirm.action((id: string, location: string, relative?: string) => choose(gitConfirm, async () => {
    if (!git) throw new Error('Git 能力不可用：profile 未提供 locusGit。')
    const result = await git.inspect(id, location, relative)
    if (result.state !== 'repository' || !result.reference) {
      throw new Error(`没有可关联的仓库：${result.state}${result.error ? ` (${result.error})` : ''}`)
    }
    const relation = locus.workspaces.link(id, 'association', result.reference, {
      kind: 'discovery', detail: `Git 只读观察，Filesystem 位置 ${location}，仓库 ${result.root}`,
    })
    return { value: relation, text: relationText(relation) }
  }))

  const sessionGroup = program.command('session')
    .description('DSH Session：只读发现、显式关联与原生返回；不复制消息历史')
  const sessionList = sessionGroup.command('list')
    .description('列出当前 DSH 来源可查询的 Session 元信息；不输出消息正文')
  sessionList.action(() => choose(sessionList, async () => {
    const result = await sessionService().discover()
    return {
      value: result,
      text: result.map(sessionText).join('\n') || '没有可发现的 Session。',
    }
  }))
  const sessionShow = sessionGroup.command('show <session>')
    .description('查看当前 DSH 来源的一个 Session；区分 live、persisted 与不可访问')
  sessionShow.action((id: string) => choose(sessionShow, async () => {
    const result = await sessionService().inspect(id)
    return { value: result, text: sessionText(result), exitCode: result.state === 'unavailable' ? 2 : 0 }
  }))
  const sessionAssociate = sessionGroup.command('associate <workspace> <session>')
    .description('显式把已发现的 Session 关联到 Workspace；不改变 Session 生命周期')
  sessionAssociate.action((workspaceId: string, sessionId: string) => choose(sessionAssociate, async () => {
    const service = sessionService()
    const workspace = locus.workspaces.get(workspaceId)
    if (!workspace.capabilities.some((entry) =>
      entry.id === service.capability.id && entry.provider === service.capability.provider)) {
      throw new Error(`Workspace ${workspace.name} (${workspaceId}) 尚未启用能力 ${service.capability.id}；请先配置提供方 ${service.capability.provider}。`)
    }
    const inspected = await service.inspect(sessionId)
    if (inspected.state === 'unavailable') {
      throw new Error(`无法关联 Session ${sessionId}：${inspected.error ?? '当前不可访问'}`)
    }
    const relation = locus.workspaces.link(workspaceId, 'association', inspected.reference, {
      kind: 'manual',
      detail: `DSH Session ${inspected.sessionId}，来源 ${inspected.source.label} (${inspected.source.id})`,
    })
    return { value: relation, text: relationText(relation) }
  }))
  const sessionLinks = sessionGroup.command('links <workspace>')
    .description('列举 Workspace 保存的 Session 关联；查询失败或插件停用仍保留关系')
  sessionLinks.action((workspaceId: string) => choose(sessionLinks, async () => {
    const workspace = locus.workspaces.get(workspaceId)
    const relations = workspace.relations.filter((relation) =>
      relation.target.namespace.startsWith(SESSION_NAMESPACE_PREFIX))
    const result = await Promise.all(relations.map(async (relation) => {
      if (!session) {
        return {
          relationId: relation.id,
          relation,
          summary: {
            reference: relation.target,
            sessionId: relation.target.id,
            source: { id: relation.target.namespace.slice(SESSION_NAMESPACE_PREFIX.length), label: '未知' },
            state: 'unavailable' as const,
            live: false,
            persisted: false,
            error: 'Session 能力不可用：profile 未加载 locusSession；已保存关联保留。',
          },
        }
      }
      return {
        relationId: relation.id,
        relation,
        summary: await session.inspectReference(relation.target),
      }
    }))
    return {
      value: result,
      text: result.map((item) =>
        `${item.relationId}  ${sessionText(item.summary)}  [${item.relation.source.detail}]`).join('\n')
        || '没有已保存的 Session 关联。',
    }
  }))
  const sessionDissociate = sessionGroup.command('dissociate <workspace> <relation-id>')
    .description('解除一条 Session 关联，不删除原生 Session 或消息历史')
    .requiredOption('--yes', '确认解除关系；不等待交互输入')
  sessionDissociate.action((workspaceId: string, relationId: string) => choose(sessionDissociate, () => {
    const workspace = locus.workspaces.get(workspaceId)
    const relation = workspace.relations.find((item) => item.id === relationId)
    if (!relation) throw new Error(`找不到 Workspace ${workspaceId} 的关系：${relationId}`)
    if (!relation.target.namespace.startsWith(SESSION_NAMESPACE_PREFIX)) {
      throw new Error(`关系 ${relationId} 不是 Session 关联，不能使用 session dissociate`)
    }
    locus.workspaces.unlink(workspaceId, relationId)
    return {
      value: { workspaceId, removedRelationId: relationId },
      text: `已解除 Session 关联 ${relationId}；原生 Session 与消息历史未删除。`,
    }
  }))
  const sessionOpen = sessionGroup.command('open <session>')
    .description('返回 DSH 原生入口；不复制 transcript，也不冒充 Session 生命周期')
  sessionOpen.action((sessionId: string) => choose(sessionOpen, async () => {
    const service = sessionService()
    const inspected = await service.inspect(sessionId)
    const opened = await service.open(inspected.reference)
    const text = opened.mode === 'native'
      ? [
        `工作目录: ${opened.cwd}`,
        `命令: ${opened.command?.join(' ')} "<继续任务>"`,
        opened.note,
      ].join('\n')
      : opened.note
    return { value: opened, text, exitCode: opened.mode === 'unavailable' ? 2 : 0 }
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
