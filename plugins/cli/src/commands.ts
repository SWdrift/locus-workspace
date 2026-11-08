import { Command, InvalidArgumentError, Option } from 'commander'
import type {
  CapabilityDescriptor,
  ConnectionAttempt,
  ConnectionInspection,
  ConnectionOpen,
  ConnectionProfile,
  ConnectionProfileUpdate,
  ConnectionTransport,
  ConnectivityService,
  FilesystemObservation,
  FilesystemService,
  GitService,
  LocusService,
  MachineAddress,
  MachineAddressKind,
  MachineObservation,
  RemoteMachine,
  RemoteMachineService,
  SessionService,
  SessionSummary,
  Workspace,
  WorkspaceRelation,
} from '@locus/contracts'
import { REMOTE_MACHINE_NAMESPACE, SESSION_NAMESPACE_PREFIX } from '@locus/contracts'

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

function port(value: string): number {
  const parsed = integer(value)
  if (parsed > 65535) throw new InvalidArgumentError('必须在 1–65535 之间。')
  return parsed
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

function addressText(value: MachineAddress): string {
  const endpoint = `${value.value}${value.port === undefined ? '' : `:${value.port}`}`
  return `${value.id}  ${value.kind}  ${endpoint}${value.label === undefined ? '' : `  (${value.label})`}`
}

function machineSummaryText(value: RemoteMachine): string {
  const addresses = value.addresses.map((address) =>
    `${address.kind}:${address.value}${address.port === undefined ? '' : `:${address.port}`}`).join(', ')
  return `${value.id}  ${value.name}  ${addresses || '无地址'}`
}

function machineText(value: RemoteMachine): string {
  return [
    `Machine: ${value.name}`,
    `Identity: ${value.id}`,
    `描述: ${value.description || '无'}`,
    `创建时间: ${value.createdAt}`,
    `更新时间: ${value.updatedAt}`,
    '地址:',
    ...value.addresses.map((address) => `  ${addressText(address)}`),
    ...(value.addresses.length ? [] : ['  无']),
  ].join('\n')
}

function machineObservationText(value: MachineObservation): string {
  const endpoint = `${value.source.endpoint}${value.source.port === undefined ? '' : `:${value.source.port}`}`
  return [
    `${value.state}  ${endpoint}  ${value.observedAt}`,
    ...(value.host === undefined ? [] : [`hostname: ${value.host.hostname}`]),
    ...(value.error === undefined ? [] : [value.error]),
    `范围: 单一 SSH 地址（${value.source.addressId}），不代表机器全局在线。`,
  ].join('\n')
}

function redactProfile(value: ConnectionProfile): Record<string, unknown> {
  return {
    id: value.id,
    machineId: value.machineId,
    name: value.name,
    transport: value.transport,
    target: value.target,
    ...(value.port === undefined ? {} : { port: value.port }),
    ...(value.user === undefined ? {} : { user: value.user }),
    ...(value.proxyJump === undefined ? {} : { proxyJump: value.proxyJump }),
    ...(value.identityFile === undefined ? {} : { identityFile: '<configured>' }),
    ...(value.knownHostsFile === undefined ? {} : { knownHostsFile: '<configured>' }),
    ...(value.sshConfigFile === undefined ? {} : { sshConfigFile: '<configured>' }),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

function profileText(value: ConnectionProfile, machineName?: string): string {
  const target = `${value.target}${value.port === undefined ? '' : `:${value.port}`}`
  return [
    `Connection Profile: ${value.name}`,
    `Identity: ${value.id}`,
    ...(machineName === undefined ? [`Machine: ${value.machineId}`] : [`Machine: ${machineName} (${value.machineId})`]),
    `Transport: ${value.transport}`,
    `Target: ${target}${value.user === undefined ? '' : `  用户 ${value.user}`}`,
    ...(value.proxyJump === undefined ? [] : [`ProxyJump: ${value.proxyJump}`]),
    `配置引用: ${value.sshConfigFile === undefined ? '系统 OpenSSH 默认' : '已配置'}`,
    `身份文件: ${value.identityFile === undefined ? 'OpenSSH 默认' : '已配置'}`,
    `known_hosts: ${value.knownHostsFile === undefined ? 'OpenSSH 默认' : '已配置'}`,
    `更新时间: ${value.updatedAt}`,
  ].join('\n')
}

function inspectionText(value: ConnectionInspection): string {
  return [
    `${value.state}  ${value.transport}  ${value.target}  ${value.observedAt}`,
    ...(value.resolved === undefined
      ? []
      : [`有效目标: ${value.resolved.hostname}:${value.resolved.port}  用户 ${value.resolved.user}`]),
    ...(value.resolved?.proxyJump === undefined ? [] : [`ProxyJump: ${value.resolved.proxyJump}`]),
    ...value.checks.map((check) => `  [${check.state}] ${check.code}: ${check.message}`),
    ...(value.error === undefined ? [] : [value.error]),
  ].join('\n')
}

function attemptText(value: ConnectionAttempt): string {
  return [
    `${value.state}  ${value.transport}  ${value.source.target}${value.source.port === undefined ? '' : `:${value.source.port}`}  ${value.durationMs}ms`,
    ...(value.host === undefined ? [] : [`hostname: ${value.host.hostname}`]),
    ...(value.error === undefined ? [] : [value.error]),
    `开始: ${value.startedAt}  结束: ${value.finishedAt}`,
  ].join('\n')
}

function shellArgument(value: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`
}

function openText(value: ConnectionOpen): string {
  return [
    value.mode,
    ...(value.command === undefined ? [] : [value.command.map(shellArgument).join(' ')]),
    value.note,
  ].join('\n')
}

/** 语法解析只选择用例，异步 I/O 留到 parseCmdline 完成后执行。 */
export function createCommands(
  locus: LocusService,
  filesystem: FilesystemService | undefined,
  git: GitService | undefined,
  session: SessionService | undefined,
  remoteMachine: RemoteMachineService | undefined,
  connectivity: ConnectivityService | undefined,
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
  const remoteMachineService = (): RemoteMachineService => {
    if (!remoteMachine) throw new Error('Remote Machine 能力不可用：profile 未加载 locusRemoteMachine；Workspace 与已保存关系不受影响。')
    return remoteMachine
  }
  const connectivityService = (): ConnectivityService => {
    if (!connectivity) throw new Error('Connectivity 能力不可用：profile 未加载 locusConnectivity；Connection Profile 不受影响。')
    return connectivity
  }
  const workspacesFor = (machineId: string): { workspaceId: string; workspaceName: string; relationId: string }[] =>
    locus.workspaces.list().flatMap((workspace) =>
      workspace.relations
        .filter((relation) =>
          relation.target.namespace === REMOTE_MACHINE_NAMESPACE && relation.target.id === machineId)
        .map((relation) => ({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          relationId: relation.id,
        })))
  const declared: CapabilityDescriptor[] = []
  if (filesystem) declared.push(filesystem.capability)
  if (git) declared.push(git.capability)
  if (remoteMachine) declared.push(remoteMachine.capability)
  if (connectivity) declared.push(connectivity.capability)
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
    const remoteMachineAvailability = remoteMachine ? await remoteMachine.availability() : undefined
    const connectivityAvailability = connectivity ? await connectivity.availability() : undefined
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
          : capabilityId === 'locus.remote-machine'
            ? remoteMachineAvailability?.available === true
          : capabilityId === 'locus.connectivity'
            ? connectivityAvailability?.available === true
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
              : capabilityId === 'locus.remote-machine'
                ? remoteMachineAvailability?.error ?? 'OpenSSH 不可用；机器资料与关联仍可用。'
              : capabilityId === 'locus.connectivity'
                ? connectivityAvailability?.error ?? 'OpenSSH 不可用；Connection Profile 仍可保存。'
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

  const machines = program.command('machine')
    .description('Remote Machine：稳定机器身份、多个地址与只读 SSH 观察；登记不要求 SSH')
  const machineRegister = machines.command('register <name>')
    .description('显式登记机器并生成稳定 Identity；不要求 Workspace 或 SSH 连接')
    .option('--description <text>', '机器描述')
  machineRegister.action((name: string) => choose(machineRegister, () => {
    const result = remoteMachineService().register(name, machineRegister.opts<{ description?: string }>().description)
    return { value: result, text: `${machineText(result)}\n登记与连接验证分离；尚未关联任何 Workspace。` }
  }))
  const machineList = machines.command('list [workspace]')
    .description('列出已登记机器；给出 Workspace 时只列该 Workspace 的机器关联')
  machineList.action((workspaceId?: string) => choose(machineList, () => {
    const service = remoteMachineService()
    if (workspaceId === undefined) {
      const result = service.list()
      return {
        value: result,
        text: result.map(machineSummaryText).join('\n') || '没有已登记机器。',
      }
    }
    const workspace = locus.workspaces.get(workspaceId)
    const relations = workspace.relations.filter((relation) =>
      relation.target.namespace === REMOTE_MACHINE_NAMESPACE)
    const result = relations.map((relation) => {
      try {
        return { relation, machine: service.get(relation.target.id) }
      } catch (error) {
        return {
          relation,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })
    return {
      value: result,
      text: result.map((item) => 'machine' in item
        ? `${item.relation.id}  ${machineSummaryText(item.machine)}  [${item.relation.source.detail}]`
        : `${item.relation.id}  ${item.relation.target.id}  不可用: ${item.error}`).join('\n')
        || '该 Workspace 没有机器关联。',
    }
  }))
  const machineShow = machines.command('show <machine>')
    .description('查看机器资料、地址与 Workspace 关联')
  machineShow.action((machineId: string) => choose(machineShow, () => {
    const machine = remoteMachineService().get(machineId)
    const workspaces = workspacesFor(machine.id)
    return {
      value: { machine, workspaces },
      text: [
        machineText(machine),
        'Workspace 关联:',
        ...workspaces.map((item) =>
          `  ${item.relationId}  ${item.workspaceName} (${item.workspaceId})`),
        ...(workspaces.length ? [] : ['  无']),
      ].join('\n'),
    }
  }))
  const machineUpdate = machines.command('update <machine>')
    .description('修改名称或描述，不改变 Machine Identity')
    .option('--name <name>', '新的显示名称')
    .option('--description <text>', '新的描述；空字符串可清除')
  machineUpdate.action((machineId: string) => choose(machineUpdate, () => {
    const options = machineUpdate.opts<{ name?: string; description?: string }>()
    if (options.name === undefined && options.description === undefined) {
      throw new Error('至少提供 --name 或 --description')
    }
    const result = remoteMachineService().update(machineId, {
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(options.description === undefined ? {} : { description: options.description }),
    })
    return { value: result, text: machineText(result) }
  }))
  const machineAddress = machines.command('address')
    .description('机器地址：同一机器可有多个地址，地址重合不证明机器身份相同')
  const machineAddressAdd = machineAddress.command('add <machine>')
    .description('添加已知地址；不会自动创建或验证连接')
    .addOption(new Option('--kind <kind>', '地址类型').choices(['ssh', 'hostname', 'ip', 'other']).default('ssh'))
    .requiredOption('--value <value>', '地址值，例如 user@host 或 192.0.2.10')
    .option('--port <port>', 'SSH 端口（仅 ssh）', port)
    .option('--label <label>', '地址标签')
  machineAddressAdd.action((machineId: string) => choose(machineAddressAdd, () => {
    const options = machineAddressAdd.opts<{
      kind: MachineAddressKind
      value: string
      port?: number
      label?: string
    }>()
    const result = remoteMachineService().addAddress(machineId, {
      kind: options.kind,
      value: options.value,
      ...(options.port === undefined ? {} : { port: options.port }),
      ...(options.label === undefined ? {} : { label: options.label }),
    })
    return { value: result, text: machineText(result) }
  }))
  const machineAddressUpdate = machineAddress.command('update <machine> <address>')
    .description('修改地址值、类型、端口或标签，不改变 Machine Identity')
    .addOption(new Option('--kind <kind>', '地址类型').choices(['ssh', 'hostname', 'ip', 'other']))
    .option('--value <value>', '新的地址值')
    .option('--port <port>', 'SSH 端口（仅 ssh）', port)
    .option('--label <label>', '新的地址标签')
  machineAddressUpdate.action((machineId: string, addressId: string) => choose(machineAddressUpdate, () => {
    const options = machineAddressUpdate.opts<{
      kind?: MachineAddressKind
      value?: string
      port?: number
      label?: string
    }>()
    if (options.kind === undefined && options.value === undefined &&
      options.port === undefined && options.label === undefined) {
      throw new Error('至少提供 --kind、--value、--port 或 --label')
    }
    const result = remoteMachineService().updateAddress(machineId, addressId, {
      ...(options.kind === undefined ? {} : { kind: options.kind }),
      ...(options.value === undefined ? {} : { value: options.value }),
      ...(options.port === undefined ? {} : { port: options.port }),
      ...(options.label === undefined ? {} : { label: options.label }),
    })
    return { value: result, text: machineText(result) }
  }))
  const machineAddressRemove = machineAddress.command('remove <machine> <address>')
    .description('移除一个已知地址，不删除机器或其他地址')
    .requiredOption('--yes', '确认移除地址；不等待交互输入')
  machineAddressRemove.action((machineId: string, addressId: string) => choose(machineAddressRemove, () => {
    const result = remoteMachineService().removeAddress(machineId, addressId)
    return {
      value: result,
      text: `已移除地址 ${addressId}；Machine ${machineId} 与其他地址未删除。\n${machineText(result)}`,
    }
  }))
  const machineAssociate = machines.command('associate <workspace> <machine>')
    .description('显式把机器关联到 Workspace；不创建连接，不改变机器生命周期')
  machineAssociate.action((workspaceId: string, machineId: string) => choose(machineAssociate, () => {
    const service = remoteMachineService()
    const workspace = locus.workspaces.get(workspaceId)
    if (!workspace.capabilities.some((entry) =>
      entry.id === service.capability.id && entry.provider === service.capability.provider)) {
      throw new Error(`Workspace ${workspace.name} (${workspaceId}) 尚未启用能力 ${service.capability.id}；请先配置提供方 ${service.capability.provider}。`)
    }
    const machine = service.get(machineId)
    const relation = locus.workspaces.link(workspaceId, 'association', service.reference(machine.id), {
      kind: 'manual',
      detail: `Remote Machine ${machine.name} (${machine.id})`,
    })
    return { value: relation, text: relationText(relation) }
  }))
  const machineDissociate = machines.command('dissociate <workspace> <relation-id>')
    .description('解除一条机器关联，不删除机器、地址或其他 Workspace 的关联')
    .requiredOption('--yes', '确认解除关系；不等待交互输入')
  machineDissociate.action((workspaceId: string, relationId: string) => choose(machineDissociate, () => {
    const workspace = locus.workspaces.get(workspaceId)
    const relation = workspace.relations.find((item) => item.id === relationId)
    if (!relation) throw new Error(`找不到 Workspace ${workspaceId} 的关系：${relationId}`)
    if (relation.target.namespace !== REMOTE_MACHINE_NAMESPACE) {
      throw new Error(`关系 ${relationId} 不是 Remote Machine 关联，不能使用 machine dissociate`)
    }
    locus.workspaces.unlink(workspaceId, relationId)
    return {
      value: { workspaceId, removedRelationId: relationId },
      text: `已解除机器关联 ${relationId}；机器、地址与其他 Workspace 关系未删除。`,
    }
  }))
  const machineWorkspaces = machines.command('workspaces <machine>')
    .description('从机器查看它的 Workspace 关联')
  machineWorkspaces.action((machineId: string) => choose(machineWorkspaces, () => {
    const machine = remoteMachineService().get(machineId)
    const result = workspacesFor(machine.id)
    return {
      value: result,
      text: result.map((item) =>
        `${item.relationId}  ${item.workspaceName} (${item.workspaceId})`).join('\n')
        || '该机器没有 Workspace 关联。',
    }
  }))
  const machineObserve = machines.command('observe <machine> [address]')
    .description('通过 OpenSSH 对一个 ssh 地址做只读观察；不代表机器全局在线')
  machineObserve.action((machineId: string, addressId?: string) => choose(machineObserve, async () => {
    const result = await remoteMachineService().observe(machineId, addressId)
    return {
      value: result,
      text: machineObservationText(result),
      exitCode: result.state === 'observed' ? 0 : 2,
    }
  }))

  const connection = program.command('connect')
    .description('Connectivity：SSH Connection Profile、配置检查、真实连接验证与原生入口')
  const connectionList = connection.command('list [workspace]')
    .description('列出 Connection Profile；给出 Workspace 时只列其机器关联下的 Profile')
  connectionList.action((workspaceId?: string) => choose(connectionList, () => {
    const service = connectivityService()
    const profiles = service.list()
    if (workspaceId === undefined) {
      return {
        value: profiles.map(redactProfile),
        text: profiles.map((profile) => profileText(profile)).join('\n') || '没有 Connection Profile。',
      }
    }
    const workspace = locus.workspaces.get(workspaceId)
    const machineIds = new Set(workspace.relations
      .filter((relation) => relation.target.namespace === REMOTE_MACHINE_NAMESPACE)
      .map((relation) => relation.target.id))
    const selected = profiles.filter((profile) => machineIds.has(profile.machineId))
    return {
      value: selected.map(redactProfile),
      text: selected.map((profile) => profileText(profile)).join('\n') || '该 Workspace 没有 Connection Profile。',
    }
  }))
  const connectionProfile = connection.command('profile')
    .description('机器级 Connection Profile；同一 Machine 可有多个入口')
  const connectionProfileList = connectionProfile.command('list <machine>')
    .description('列出某台 Machine 的 Connection Profile；不建立新的机器身份')
  connectionProfileList.action((machineId: string) => choose(connectionProfileList, () => {
    const machine = remoteMachineService().get(machineId)
    const result = connectivityService().list(machine.id)
    return {
      value: result.map(redactProfile),
      text: result.map((profile) => profileText(profile, machine.name)).join('\n')
        || `Machine ${machine.name} 没有 Connection Profile。`,
    }
  }))
  const connectionProfileShow = connectionProfile.command('show <profile>')
    .description('查看 Profile 配置摘要；默认隐藏身份文件与 known_hosts 路径')
  connectionProfileShow.action((profileId: string) => choose(connectionProfileShow, () => {
    const profile = connectivityService().get(profileId)
    const machine = remoteMachineService().get(profile.machineId)
    return {
      value: { profile: redactProfile(profile), machine: { id: machine.id, name: machine.name } },
      text: profileText(profile, machine.name),
    }
  }))
  const connectionProfileAdd = connectionProfile.command('add <machine> <name>')
    .description('登记一套可复用 SSH 连接；只引用配置，不保存凭据')
    .addOption(new Option('--transport <kind>', '连接方式').choices(['direct', 'proxy-jump', 'frp']).default('direct'))
    .requiredOption('--target <target>', 'SSH alias 或 host，例如 host-alias、user@host')
    .option('--port <port>', 'SSH/visitor 端口（1–65535）', port)
    .option('--user <user>', 'SSH 登录用户')
    .option('--proxy-jump <target>', 'OpenSSH ProxyJump 目标或 alias')
    .option('--identity-file <path>', '引用现有私钥路径；不读取或复制内容')
    .option('--known-hosts-file <path>', '引用现有 known_hosts 路径')
    .option('--ssh-config-file <path>', '引用非默认 OpenSSH 配置文件')
  connectionProfileAdd.action((machineId: string, name: string) => choose(connectionProfileAdd, () => {
    const options = connectionProfileAdd.opts<{
      transport: ConnectionTransport
      target: string
      port?: number
      user?: string
      proxyJump?: string
      identityFile?: string
      knownHostsFile?: string
      sshConfigFile?: string
    }>()
    const machine = remoteMachineService().get(machineId)
    const result = connectivityService().add(machine.id, {
      name,
      transport: options.transport,
      target: options.target,
      ...(options.port === undefined ? {} : { port: options.port }),
      ...(options.user === undefined ? {} : { user: options.user }),
      ...(options.proxyJump === undefined ? {} : { proxyJump: options.proxyJump }),
      ...(options.identityFile === undefined ? {} : { identityFile: options.identityFile }),
      ...(options.knownHostsFile === undefined ? {} : { knownHostsFile: options.knownHostsFile }),
      ...(options.sshConfigFile === undefined ? {} : { sshConfigFile: options.sshConfigFile }),
    })
    return { value: redactProfile(result), text: profileText(result, machine.name) }
  }))
  const connectionProfileUpdate = connectionProfile.command('update <profile>')
    .description('修改 Profile；Machine Identity 不变')
    .option('--name <name>', '新的 Profile 名称')
    .addOption(new Option('--transport <kind>', '连接方式').choices(['direct', 'proxy-jump', 'frp']))
    .option('--target <target>', '新的 SSH alias 或 host')
    .option('--port <port>', '新的 SSH/visitor 端口', port)
    .option('--user <user>', '新的 SSH 用户')
    .option('--proxy-jump <target>', '新的 ProxyJump 目标')
    .option('--identity-file <path>', '新的身份文件路径引用')
    .option('--known-hosts-file <path>', '新的 known_hosts 路径引用')
    .option('--ssh-config-file <path>', '新的 OpenSSH 配置文件引用')
  connectionProfileUpdate.action((profileId: string) => choose(connectionProfileUpdate, () => {
    const options = connectionProfileUpdate.opts<{
      name?: string
      transport?: ConnectionTransport
      target?: string
      port?: number
      user?: string
      proxyJump?: string
      identityFile?: string
      knownHostsFile?: string
      sshConfigFile?: string
    }>()
    if (Object.values(options).every((value) => value === undefined)) {
      throw new Error('至少提供一个 Profile 修改选项')
    }
    const changes: ConnectionProfileUpdate = {
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(options.transport === undefined ? {} : { transport: options.transport }),
      ...(options.target === undefined ? {} : { target: options.target }),
      ...(options.port === undefined ? {} : { port: options.port }),
      ...(options.user === undefined ? {} : { user: options.user }),
      ...(options.proxyJump === undefined ? {} : { proxyJump: options.proxyJump }),
      ...(options.identityFile === undefined ? {} : { identityFile: options.identityFile }),
      ...(options.knownHostsFile === undefined ? {} : { knownHostsFile: options.knownHostsFile }),
      ...(options.sshConfigFile === undefined ? {} : { sshConfigFile: options.sshConfigFile }),
    }
    const result = connectivityService().update(profileId, changes)
    const machine = remoteMachineService().get(result.machineId)
    return { value: redactProfile(result), text: profileText(result, machine.name) }
  }))
  const connectionProfileRemove = connectionProfile.command('remove <profile>')
    .description('删除连接配置，不删除 Machine、Workspace 关联或外部资源')
    .requiredOption('--yes', '确认删除 Profile；不等待交互输入')
  connectionProfileRemove.action((profileId: string) => choose(connectionProfileRemove, () => {
    const profile = connectivityService().get(profileId)
    connectivityService().remove(profileId)
    return {
      value: { removedProfileId: profileId, machineId: profile.machineId },
      text: `已删除 Connection Profile ${profile.name}；Machine 与 Workspace 关系未删除。`,
    }
  }))
  const connectionInspect = connection.command('inspect <profile>')
    .description('只读检查 OpenSSH 有效配置、身份/known_hosts 前提与 FRP visitor 端口')
  connectionInspect.action((profileId: string) => choose(connectionInspect, async () => {
    const result = await connectivityService().inspect(profileId)
    return {
      value: result,
      text: inspectionText(result),
      exitCode: result.state === 'error' || result.state === 'unavailable' ? 2 : 0,
    }
  }))
  const connectionVerify = connection.command('verify <profile>')
    .description('通过 OpenSSH 执行一次只读 hostname 验证；不修改远端状态')
  connectionVerify.action((profileId: string) => choose(connectionVerify, async () => {
    const result = await connectivityService().verify(profileId)
    return {
      value: result,
      text: attemptText(result),
      exitCode: result.state === 'connected' ? 0 : 2,
    }
  }))
  const connectionOpen = connection.command('open <profile>')
    .description('返回可执行的原生 SSH 入口；当前 CLI 不接管 Agent/Web 终端')
  connectionOpen.action((profileId: string) => choose(connectionOpen, () => {
    const result = connectivityService().open(profileId)
    return { value: result, text: openText(result), exitCode: result.mode === 'native' ? 0 : 2 }
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
