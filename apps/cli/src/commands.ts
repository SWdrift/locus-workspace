import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Command, Option } from 'commander'
import type { ComponentView, LocusCore, Mount, Workspace, WorkspaceRelation } from '@locus/core'
import { component as templatesComponent, createTemplateService } from '@locus/templates'
import {
  component as remoteTargetsComponent,
  createRemoteTargetsService,
} from '@locus/remote-targets'
import type { RemoteTarget, RemoteTargetView } from '@locus/remote-targets'
import { runWorkspaceShell } from './shell.ts'

const PACKAGE_COMPONENT_IDS = [templatesComponent.id, remoteTargetsComponent.id]

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

function componentStateText(view: ComponentView): string {
  if (view.external === undefined) return '不适用'
  const state = view.external.state ?? '未探查'
  const detail = view.external.detail.length === 0 ? '' : `  ${view.external.detail}`
  const checkedAt = view.external.checkedAt === undefined ? '' : `  ${view.external.checkedAt}`
  return `${state}${detail}${checkedAt}`
}

function truncateDetail(detail: string, limit = 120): string {
  return detail.length > limit ? `${detail.slice(0, limit)}…` : detail
}

function componentProbeText(view: ComponentView): string {
  if (view.external === undefined) return `${view.id}  不适用`
  const state = view.external.state ?? '未探查'
  const detail = truncateDetail(view.external.detail)
  const checkedAt = view.external.checkedAt === undefined ? '' : `  ${view.external.checkedAt}`
  return `${view.id}  ${state}${detail.length === 0 ? '' : `  ${detail}`}${checkedAt}`
}

function componentDeployText(view: ComponentView): string {
  const detail = truncateDetail(view.deploy.detail)
  const checkedAt = view.deploy.checkedAt === undefined ? '' : `  ${view.deploy.checkedAt}`
  return `${view.id}  ${view.deploy.state}${detail.length === 0 ? '' : `  ${detail}`}${checkedAt}`
}

/** 列表只携带定位与状态，完整说明由 show 读取。 */
function componentSummary(view: ComponentView): Record<string, unknown> {
  return {
    id: view.id,
    name: view.name,
    summary: view.summary,
    kind: view.kind,
    version: view.version,
    ...(view.codeVersion === undefined ? {} : { codeVersion: view.codeVersion }),
    needsUpgrade: view.needsUpgrade,
    requires: view.requires,
    source: view.source,
    definitionPath: view.definitionPath,
    ...(view.configPath === undefined ? {} : { configPath: view.configPath }),
    ...(view.external === undefined ? {} : { external: view.external }),
    deploy: view.deploy,
  }
}

function formatAge(iso: string): string {
  const timestamp = Date.parse(iso)
  if (!Number.isFinite(timestamp)) return '-'
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86_400)}d`
}

function componentText(view: ComponentView): string {
  const version = view.needsUpgrade
    ? `${view.version}（代码版本 ${view.codeVersion}，需要升级）`
    : view.version
  const lines = [
    `组件：${view.id}`,
    `名称：${view.name}`,
    `种类：${view.kind}  来源：${view.source}`,
    `版本：${version}`,
    `依赖：${view.requires.length === 0 ? '无' : view.requires.join(', ')}`,
    `外部状态：${componentStateText(view)}`,
    `部署状态：${view.deploy.state}  ${view.deploy.detail}`,
    `定义：${view.definitionPath}`,
    ...(view.configPath === undefined ? [] : [`配置：${view.configPath}`]),
  ]
  if (view.info?.text !== undefined) {
    lines.push('', view.info.text.trimEnd())
  } else if (view.info?.json !== undefined) {
    lines.push('', JSON.stringify(view.info.json, null, 2))
  }
  return lines.join('\n')
}

function componentLine(view: ComponentView): string {
  const external = view.external === undefined
    ? '-'
    : view.external.state ?? (view.external.detail || '未探查')
  const age = view.external?.checkedAt === undefined ? '-' : formatAge(view.external.checkedAt)
  const upgrade = view.needsUpgrade ? '  需要升级' : ''
  const requires = view.requires.length === 0 ? '' : `  -> ${view.requires.join(',')}`
  return `${view.id}  ${view.source}  ${view.kind}  ${view.version}${upgrade}  ${external}  ${age}  ${view.deploy.state}${requires}`
}

/** 顶层未知命令先判断是否像组件，避免拼写错误也创建数据目录。 */
function isComponentId(locus: LocusCore, id: string): boolean {
  if (PACKAGE_COMPONENT_IDS.includes(id)) return true
  const root = join(locus.dataDirectory, 'components')
  return existsSync(join(root, `${id}.yaml`)) || existsSync(join(root, id, 'component.yaml'))
}

function remoteTargetLine(target: RemoteTarget): string {
  const label = target.resource.label === undefined ? '' : `  ${target.resource.label}`
  const endpoint = `${target.connectivity.host}:${target.connectivity.port}`
  return `${target.id}  ${target.connectivity.transport}  ${target.connectivity.via}  ${endpoint}  ${target.identity.login}${label}`
}

function remoteTargetText(target: RemoteTargetView): string {
  const label = target.resource.label === undefined ? '' : `  ${target.resource.label}`
  const lines = [
    `目标：${target.id}`,
    `资源：${target.resource.kind}${label}`,
    `身份：${target.identity.login}（${target.identity.auth.method}）`,
    `凭据：${target.identity.auth.path}`,
    `能力：${target.access.capabilities.join(', ')}`,
    `连接：${target.connectivity.transport}  ${target.connectivity.via}  ${target.connectivity.host}:${target.connectivity.port}`,
    `远端 Shell：${target.connectivity.remoteShell}`,
  ]
  if (target.lastProbe !== undefined) {
    const probe = target.lastProbe
    lines.push(`最近探测：${probe.ok ? '成功' : '失败'}  ${probe.detail}  ${probe.checkedAt}`)
  }
  return lines.join('\n')
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
  const templates = createTemplateService()
  const remoteTargets = createRemoteTargetsService({
    root: join(locus.dataDirectory, 'remote-targets'),
    components: {
      get(id) {
        const found = locus.components.list().components.find((item) => item.id === id)
        if (found === undefined) return undefined
        return { id: found.id, kind: found.kind, state: found.external?.state ?? null }
      },
    },
  })
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
        return
      }
      if (!isComponentId(locus, command)) {
        program.error(`未知命令：${command}`, { exitCode: 1 })
        return
      }
      const result = locus.components.show(command)
      emit(program, result, componentText(result))
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

  const template = program.command('template').description('本机项目模板：复制文件夹并记录来源')
  template.action(() => {
    const result = locus.components.show(templatesComponent.id)
    emit(template, result, componentText(result))
  })
  const templateList = template.command('list').description('列出内置模板')
  templateList.action(async () => {
    const result = await templates.list()
    emit(
      templateList,
      result,
      result.map((item) => {
        const version = item.version === undefined ? '-' : item.version
        return `${item.id}  ${version}  ${item.name}${item.description ? `  ${item.description}` : ''}`
      }).join('\n') || '没有内置模板。',
    )
  })
  const templateCreate = template.command('create <template> <destination>')
    .description('复制模板到新目录；目标必须不存在')
    .option('--dry-run', '只计算文件、目录与 digest，不写目标')
  templateCreate.action(async (templateReference: string, destination: string) => {
    const result = await templates.create(templateReference, {
      destination: resolve(destination),
      dryRun: templateCreate.opts<{ dryRun?: boolean }>().dryRun === true,
    })
    const version = result.template.version === undefined ? '' : `@${result.template.version}`
    const lines = [
      result.dryRun ? `将创建：${result.destination}` : `已创建：${result.destination}`,
      `模板：${result.template.id}${version}`,
      `文件：${result.files.length}  目录：${result.directories.length}`,
      `Digest：${result.digest}`,
      ...(result.dryRun ? [] : [`实例记录：${result.metadataPath}`]),
    ]
    emit(templateCreate, result, lines.join('\n'))
  })

  const targets = program.command('remote-targets')
    .alias('rt')
    .description('远程目标：声明式登记 SSH 目标，经统一入口探测与执行')
  targets.action(() => {
    const result = locus.components.show(remoteTargetsComponent.id)
    emit(targets, result, componentText(result))
  })
  const targetAdd = targets.command('add <id>')
    .description('登记目标；细节通过 --spec 传入 YAML 或 JSON')
    .option('--spec <path>', '配置文件；- 表示从 stdin 读取')
    .option('--dry-run', '只校验并输出，不写配置')
  targetAdd.action((id: string) => {
    const options = targetAdd.opts<{ spec?: string; dryRun?: boolean }>()
    if (options.spec === undefined) {
      throw new Error('缺少 --spec；用 --spec <file> 或 --spec - 从 stdin 读取')
    }
    const text = options.spec === '-'
      ? readFileSync(0, 'utf8')
      : readFileSync(resolve(options.spec), 'utf8')
    const result = remoteTargets.addFromText(id, text, { dryRun: options.dryRun === true })
    const detail = options.dryRun === true ? '将登记' : '已登记'
    emit(targetAdd, result, `${detail}目标 ${result.id}\n${remoteTargetText(result)}`)
  })
  const targetList = targets.command('list').description('列举已登记目标')
  targetList.action(() => {
    const result = remoteTargets.list()
    emit(
      targetList,
      result,
      result.map(remoteTargetLine).join('\n') || '没有远程目标。',
    )
  })
  const targetShow = targets.command('show <target>')
    .description('按 id、唯一前缀或标签查看目标与最近探测')
  targetShow.action((reference: string) => {
    const result = remoteTargets.show(reference)
    emit(targetShow, result, remoteTargetText(result))
  })
  const targetRemove = targets.command('remove <target>')
    .description('移除目标定义，不删除目标自身')
    .requiredOption('--yes', '确认移除；不等待交互输入')
  targetRemove.action((reference: string) => {
    remoteTargets.remove(reference)
    emit(targetRemove, { target: reference, removed: true }, `已移除目标 ${reference}。`)
  })
  const targetProbe = targets.command('probe <target>')
    .description('只读连接并执行 whoami，记录可达性')
  targetProbe.action(async (reference: string) => {
    const result = await remoteTargets.probe(reference)
    emit(targetProbe, result, result.ok ? `探测成功：${result.detail}` : `探测失败：${result.detail}`)
    if (!result.ok) process.exitCode = 1
  })
  const targetExec = targets.command('exec <target> [command...]')
    .description('经统一入口执行远端命令，退出码透传')
  targetExec.action(async (reference: string, command: string[] = []) => {
    const result = await remoteTargets.exec(reference, command)
    if (jsonEnabled(targetExec)) {
      process.stdout.write(`${JSON.stringify(result)}\n`)
    } else {
      if (result.stdout.length > 0) process.stdout.write(result.stdout)
      if (result.stderr.length > 0) process.stderr.write(result.stderr)
    }
    if (result.exitCode !== 0) process.exitCode = result.exitCode
  })
  const targetShell = targets.command('shell <target>')
    .description('打开目标交互式 Shell；继承当前终端')
  targetShell.action(async (reference: string) => {
    const exitCode = await remoteTargets.shell(reference)
    if (exitCode !== 0) process.exitCode = exitCode
  })

  const component = program.command('component').description('组件定义、状态与生命周期')
  const componentList = component.command('list').description('列出包组件与动态组件')
  componentList.action(() => {
    const result = locus.components.list()
    const summary = {
      components: result.components.map(componentSummary),
      problems: result.problems,
    }
    const lines = [
      ...result.components.map(componentLine),
      ...result.problems.map((problem) =>
        `! ${problem.id}  ${problem.source}  ${problem.path}  ${problem.error}`),
    ]
    emit(componentList, summary, lines.join('\n') || '没有组件。')
  })
  const componentShow = component.command('show <id>').description('查看定义、状态与说明')
  componentShow.action((id: string) => {
    const result = locus.components.show(id)
    emit(componentShow, result, componentText(result))
  })
  const componentAdd = component.command('add <source>')
    .description('登记动态组件：YAML 文件、包含 component.yaml 的文件夹或 -')
  componentAdd.action((source: string) => {
    const result = source === '-'
      ? locus.components.addFromText(readFileSync(0, 'utf8'))
      : locus.components.addFromPath(resolve(source))
    emit(componentAdd, result, `已登记组件 ${result.id}\n${componentText(result)}`)
  })
  const componentUpgrade = component.command('upgrade <id>')
    .description('按包代码刷新定义字段，保留 config')
  componentUpgrade.action((id: string) => {
    const result = locus.components.upgrade(id)
    emit(componentUpgrade, result, `已升级组件 ${result.id}\n${componentText(result)}`)
  })
  const componentRemove = component.command('remove <id>')
    .description('删除动态组件定义与状态，不触碰外部软件')
    .requiredOption('--yes', '确认删除；不等待交互输入')
  componentRemove.action((id: string) => {
    locus.components.remove(id)
    emit(componentRemove, { component: id, removed: true }, `已删除组件 ${id}；外部软件未变更。`)
  })
  const componentProbe = component.command('probe [id]')
    .description('执行声明的探针并记录外部状态；--all 探查所有 external 组件')
    .option('--all', '探查所有 external 组件')
  componentProbe.action(async (id?: string) => {
    const options = componentProbe.opts<{ all?: boolean }>()
    if (options.all === true) {
      if (id !== undefined) {
        componentProbe.error('--all 不能与组件 id 同时使用', { exitCode: 1 })
      }
      const { components } = locus.components.list()
      const probed: ComponentView[] = []
      const skipped: Array<{ id: string; reason: string }> = []
      const lines: string[] = []
      let failed = false
      for (const item of components) {
        if (item.kind !== 'external') continue
        try {
          const view = await locus.components.probe(item.id)
          probed.push(view)
          lines.push(componentProbeText(view))
          if (view.external?.state !== 'healthy') failed = true
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          skipped.push({ id: item.id, reason })
          lines.push(`${item.id}  跳过  ${reason}`)
          if (!/未声明探针/.test(reason)) failed = true
        }
      }
      emit(
        componentProbe,
        { probed, skipped },
        lines.join('\n') || '没有可探查的组件。',
      )
      if (failed) process.exitCode = 1
      return
    }
    if (id === undefined) {
      componentProbe.error('缺少组件 id 或 --all', { exitCode: 1 })
      return
    }
    const result = await locus.components.probe(id)
    emit(componentProbe, result, componentProbeText(result))
    if (result.external?.state !== 'healthy') process.exitCode = 1
  })
  const componentDeploy = component.command('deploy <id>')
    .description('执行声明的部署入口并记录结果')
    .requiredOption('--yes', '确认执行部署；不等待交互输入')
  componentDeploy.action(async (id: string) => {
    const result = await locus.components.deploy(id)
    emit(componentDeploy, result, componentDeployText(result))
    if (result.deploy.state !== 'deployed') process.exitCode = 1
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
