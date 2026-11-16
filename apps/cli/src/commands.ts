import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Command, Option } from 'commander'
import { isCredentialRef, SecurityFailure } from '@locus/core'
import type { ComponentView, CredentialRef, LocusCore, Mount, SecurityGrantScope, SecurityHost, Workspace, WorkspaceRelation } from '@locus/core'
import { component as templatesComponent, createTemplateService } from '@locus/templates'
import { api as postgresApi, component as postgresComponent } from '@locus/postgres'
import { component as giteaComponent } from '@locus/gitea'
import {
  api as remoteTargetsApi,
  assertUnencryptedPrivateKey,
  component as remoteTargetsComponent,
  createRemoteTargetsService,
  readCredentialFile,
  targetBinding,
} from '@locus/remote-targets'
import type { RemoteTarget, RemoteTargetView } from '@locus/remote-targets'
import { createCliSecurityHost } from './security-host.ts'
import type { CliSecurityUI } from './security-host.ts'
import { runWorkspaceShell } from './shell.ts'

const PACKAGE_COMPONENT_IDS = [templatesComponent.id, remoteTargetsComponent.id, postgresComponent.id, giteaComponent.id]

function jsonEnabled(command: Command): boolean {
  return command.optsWithGlobals<{ json?: boolean }>().json === true
}

function emit(command: Command, value: unknown, text: string): void {
  let root = command
  while (root.parent !== null) root = root.parent
  root.configureOutput().writeOut!(jsonEnabled(command) ? `${JSON.stringify(value)}\n` : `${text}\n`)
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
    ...(view.capabilities === undefined ? {} : { capabilities: view.capabilities }),
    ...(view.credentials === undefined ? {} : { credentials: view.credentials }),
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
    `能力：${view.capabilities === undefined || view.capabilities.length === 0 ? '无' : view.capabilities.map((capability) => `${view.id}:${capability.id}`).join(', ')}`,
    `凭据槽：${view.credentials === undefined || view.credentials.length === 0 ? '无' : view.credentials.map((credential) => `${credential.id}（${credential.fields.map((field) => `${field.name}（${field.secret ? '秘密' : '公开'}，${field.required ? '必填' : '可选'}）`).join(', ')}）`).join(', ')}`,
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
  const auth = target.identity.auth
  const credential = auth.credential ?? `旧文件 ${auth.path ?? '未登记'}`
  const lines = [
    `目标：${target.id}`,
    `资源：${target.resource.kind}${label}`,
    `身份：${target.identity.login}（${auth.method}）`,
    `凭据：${credential}`,
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

/** 可信 Host 由组合根的 receiveHost 闭包注入，不从 Core 或组件取得。 */
export interface CreateProgramOptions {
  readonly host?: SecurityHost
  readonly ui?: CliSecurityUI
  readonly profile?: 'production' | 'development'
  readonly grantScope?: SecurityGrantScope
}

function securityHostFactory(
  options: CreateProgramOptions,
  currentGrantScope: () => SecurityGrantScope | undefined,
): () => ReturnType<typeof createCliSecurityHost> {
  let trusted: ReturnType<typeof createCliSecurityHost> | undefined
  return () => {
    if (options.host === undefined) throw new SecurityFailure('authentication-unavailable')
    const grantScope = options.grantScope ?? currentGrantScope()
    trusted ??= createCliSecurityHost(options.host, options.ui, {
      ...(grantScope === undefined ? {} : { grantScope }),
    })
    return trusted
  }
}

function addSecurityCommands(
  program: Command,
  locus: LocusCore,
  securityHost: () => ReturnType<typeof createCliSecurityHost>,
): void {

  const init = program.command('init').description('通过可信 TTY 隐藏输入初始化 Root；不读取参数或环境中的密码')
  init.action(async () => {
    await securityHost().initializeRoot()
    emit(init, { initialized: true }, 'Root 与默认 User 已初始化。')
  })

  const security = program.command('security').description('Root 身份、认证状态与本机管理')
  const status = security.command('status').description('读取安全元数据；不认证、不访问凭据保管器')
  status.action(async () => {
    const result = await locus.security.status()
    emit(status, result, `Root：${result.initialized ? '已初始化' : '未初始化'}\nProfile：${result.profile}`)
  })
  const reset = security.command('reset-root')
    .description('本机管理接管：TTY 明确确认后替换 Root 密码，撤销旧授权；没有 --yes 绕过')
  reset.action(async () => {
    await securityHost().resetRoot()
    emit(reset, { reset: true }, 'Root 已重置，旧授权已撤销；Workspace 与资源凭据未删除。')
  })
  const change = security.command('change-root-password')
    .description('隐藏输入新密码，使用旧 Root 密码为本次变更单独授权')
  change.action(async () => {
    await securityHost().changeRootPassword()
    emit(change, { changed: true }, 'Root 密码已变更，旧授权已撤销。')
  })

  const credential = program.command('credential').description('Root 诊断与清理；普通使用请走组件命令')
  const providerStatus = credential.command('provider-status')
    .description('查询 Provider 装配与后端声明，不读取秘密、不把绑定加载等同平台验证')
  providerStatus.action(async () => {
    const result = await locus.security.providerStatus()
    emit(providerStatus, result, `Provider：${result.id}\n后端：${result.backend}\n状态：${result.state}`)
  })
  const list = credential.command('list').description('只列举当前 Profile 的凭据元数据与公开字段，不读取秘密')
  list.action(async () => {
    const result = await securityHost().listCredentials()
    emit(list, result, result.map((item) => `${item.reference}  ${item.providerId}  ${Object.keys(item.fields).join(',') || '-'}`).join('\n') || '没有凭据。')
  })
  const remove = credential.command('remove <ref>').description('Root 授权删除指定凭据与其绑定；不输出原值')
  remove.action(async (reference: string) => {
    await securityHost().removeCredential(reference)
    emit(remove, { reference, removed: true }, `已删除凭据 ${reference} 及其绑定。`)
  })
  const bindings = credential.command('bindings').description('列举当前 Profile 的能力、资源与 slot 绑定，不读取秘密')
  bindings.action(async () => {
    const result = await securityHost().listBindings()
    emit(bindings, result, result.map((item) => `${item.componentId}:${item.capability}  ${item.slot}  ${item.resource.type}/${item.resource.id}  -> ${item.reference}`).join('\n') || '没有绑定。')
  })
  const statusOne = credential.command('status <ref>').description('Root 检查凭据元数据与 Provider 条目是否存在；不输出秘密')
  statusOne.action(async (reference: string) => {
    const result = await securityHost().credentialStatus(reference)
    emit(statusOne, result, `${result.metadata.reference}  ${result.present ? '存在' : '缺失'}`)
  })
  const cleanup = credential.command('cleanup')
    .description('Root 检查当前 Profile 精确 Keyring service 下未被元数据登记的孤立条目；--yes 才删除')
    .option('--yes', '确认删除孤立条目；不删除已知凭据、元数据或绑定')
  cleanup.action(async () => {
    const apply = cleanup.opts<{ yes?: boolean }>().yes === true
    const result = await securityHost().cleanupCredentialOrphans(apply)
    const detail = result.orphans.length === 0
      ? `service ${result.service} 没有孤立条目。`
      : `${apply ? '已删除' : '发现'} ${result.orphans.length} 个孤立条目：${result.orphans.join(', ')}；剩余 ${result.remaining}。`
    emit(cleanup, result, detail)
  })

  const capability = security.command('capability').description('组件能力的有效认证等级与 Root 覆盖')
  const capabilityList = capability.command('list').description('列出组件能力、默认等级、覆盖与最终来源')
  capabilityList.action(async () => {
    const result = await securityHost().listCapabilityAuthorities()
    emit(capabilityList, result, result.map((item) => (
      `${item.componentId}:${item.capability}  ${item.effectiveAuthLevel}  default=${item.defaultAuthLevel}  source=${item.source}`
    )).join('\n') || '没有可配置能力。')
  })
  const capabilitySet = capability.command('set <capability> <level>')
    .description('Root 覆盖组件能力的认证等级；capability 形如 postgres:register。write 能力默认 root，降为 user 即显式委派覆盖权')
  capabilitySet.action(async (reference: string, level: string) => {
    const parsed = parseQualifiedCapability(reference, capabilitySet)
    if (level !== 'user' && level !== 'root') {
      capabilitySet.error('level 必须是 user 或 root', { exitCode: 1 })
      return
    }
    const result = await securityHost().setCapabilityLevel({ componentId: parsed.componentId, capability: parsed.capability, level })
    emit(capabilitySet, result, `已设置 ${result.componentId}:${result.capability} 为 ${result.effectiveAuthLevel}（source=${result.source}）。`)
  })
  const capabilityReset = capability.command('reset <capability>')
    .description('Root 清除组件能力的覆盖，恢复组件默认等级')
  capabilityReset.action(async (reference: string) => {
    const parsed = parseQualifiedCapability(reference, capabilityReset)
    const result = await securityHost().clearCapabilityLevel({ componentId: parsed.componentId, capability: parsed.capability })
    emit(capabilityReset, result, `已恢复 ${result.componentId}:${result.capability} 为 ${result.effectiveAuthLevel}（source=${result.source}）。`)
  })
}

/** 解析 component:capability；capability 本地 id 不含冒号。 */
function parseQualifiedCapability(value: string, command: Command): { componentId: string; capability: string } {
  const index = value.indexOf(':')
  if (index <= 0 || index === value.length - 1 || value.indexOf(':', index + 1) !== -1) {
    command.error('capability 必须是 component:capability', { exitCode: 1 })
  }
  return { componentId: value.slice(0, index), capability: value.slice(index + 1) }
}

/** 构造独立 CLI 的命令树；所有用例直接调用 Core 的公开 Workspace 服务。 */
export function createProgram(locus: LocusCore, options: CreateProgramOptions = {}): Command {
  let program: Command
  const templates = createTemplateService()
  const trustedSecurityHost = securityHostFactory(
    options,
    () => program.opts<{ readonly grantScope?: SecurityGrantScope }>().grantScope,
  )
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
  async function executeRemoteAccess(
    reference: string,
    operation: 'probe' | 'exec' | 'shell',
    command: readonly string[] = [],
  ): Promise<unknown> {
    const target = remoteTargets.show(reference)
    const capability = target.identity.auth.method === 'password' ? 'password-access' : 'private-key-access'
    const handler = remoteTargetsApi[capability]
    if (handler === undefined) throw new SecurityFailure('access-denied', { reason: 'unsupported-capability' })
    return trustedSecurityHost().executeComponent(
      remoteTargetsComponent,
      capability,
      { type: 'remote-target', id: target.id },
      { operation, command: [...command] },
      (context) => Promise.resolve(handler(context, {
        root: join(locus.dataDirectory, 'remote-targets'),
        target: target.id,
        operation,
        command,
      })),
    )
  }

  program = new Command()
    .name('locus')
    .exitOverride()
    .description('Locus 本地工作空间：Workspace 身份与显式长期关系。')
    .option('--json', '输出机器可读 JSON，诊断仍写入 stderr')
    .addOption(new Option('--grant-scope <scope>', 'Root 提权范围').choices(['operation', 'session']).default('operation'))
    .addOption(new Option('--profile <profile>', '隔离安全 Profile 与 development 数据目录').choices(['production', 'development']).default(options.profile ?? 'production'))
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

  addSecurityCommands(program, locus, trustedSecurityHost)

  const pg = program.command('pg').description('PostgreSQL 组件命令：登记凭据与查询')
  const pgRegister = pg.command('register <resource>')
    .description('登记 PostgreSQL 目标与账号/密码并绑定到精确 database 资源；密码隐藏输入')
    .requiredOption('--host <host>', 'PostgreSQL 主机')
    .requiredOption('--database <database>', '数据库名')
    .option('--port <port>', 'PostgreSQL 端口')
    .requiredOption('--username <name>', 'PostgreSQL 登录名')
    .option('--credential <ref>', '稳定 CredentialRef；缺省为 credential:pg-<resource>')
  pgRegister.action(async (resource: string) => {
    const options = pgRegister.opts<{ host: string; database: string; port?: string; username: string; credential?: string }>()
    const credential = options.credential ?? `credential:pg-${resource}`
    if (!isCredentialRef(credential)) {
      pgRegister.error('credential 必须是 credential:<id>', { exitCode: 1 })
    }
    await trustedSecurityHost().executeComponent(
      postgresComponent,
      'register',
      { type: 'database', id: resource },
      {},
      async (context) => {
        const password = await trustedSecurityHost().readSecret('PostgreSQL 密码（隐藏输入）：')
        return postgresApi.register?.(context, {
          credential: credential as CredentialRef,
          host: options.host,
          database: options.database,
          ...(options.port === undefined ? {} : { port: options.port }),
          username: options.username,
          password,
        })
      },
    )
    emit(pgRegister, { resource, credential, host: options.host, database: options.database, registered: true }, `已登记 PostgreSQL ${resource}；目标 ${options.host}/${options.database}；凭据 ${credential}。`)
  })
  const pgList = pg.command('list <resource>')
    .description('使用登记时绑定的目标与 database-auth 字段连接并查询 PostgreSQL')
    .option('--sql <sql>', '查询语句', 'select 1')
    .option('--credential <ref>', '稳定 CredentialRef；缺省为 credential:pg-<resource>')
  pgList.action(async (resource: string) => {
    const options = pgList.opts<{ sql: string; credential?: string }>()
    const credential = options.credential ?? `credential:pg-${resource}`
    if (!isCredentialRef(credential)) {
      pgList.error('credential 必须是 credential:<id>', { exitCode: 1 })
    }
    let result
    try {
      result = await trustedSecurityHost().executeComponent(
        postgresComponent,
        'list',
        { type: 'database', id: resource },
        {},
        async (context) => postgresApi.list?.(context, {
          credential: credential as CredentialRef,
          sql: options.sql,
        }),
      )
    } catch (error) {
      if (error instanceof SecurityFailure && (
        error.code === 'credential-fields-mismatch' ||
        (error.code === 'access-denied' && error.reason === 'credential-binding-mismatch')
      )) {
        process.stderr.write(`提示：先运行 locus pg register ${resource} --host <host> --database <database> --username <name>${options.credential === undefined ? '' : ` --credential ${credential}`} 登记字段。\n`)
      }
      throw error
    }
    emit(pgList, result, JSON.stringify(result))
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
  async function writeTargetCredential(
    targetId: string,
    credential: CredentialRef,
    method: 'private-key' | 'password',
    file: string | undefined,
    operation: 'add' | 'update-credential',
    binding: string,
    beforeRegister?: () => void,
    rollback?: () => void,
  ): Promise<void> {
    const capability = method === 'password' ? 'register-password' : 'register-private-key'
    const handler = remoteTargetsApi[capability]
    if (handler === undefined) throw new SecurityFailure('access-denied', { reason: 'unsupported-capability' })
    await trustedSecurityHost().executeComponent(
      remoteTargetsComponent,
      capability,
      { type: 'remote-target', id: targetId },
      { operation },
      async (context) => {
        if (beforeRegister !== undefined) beforeRegister()
        try {
          if (method === 'password') {
            const password = await trustedSecurityHost().readSecret('SSH 密码（隐藏输入）：')
            await handler(context, { credential, targetBinding: binding, password })
          } else {
            const privateKey = await readCredentialFile(resolve(file!))
            await assertUnencryptedPrivateKey(privateKey)
            await handler(context, { credential, targetBinding: binding, privateKey })
          }
        } catch (error) {
          if (rollback !== undefined) {
            try { rollback() } catch { /* 保留原能力错误，配置残留由用户诊断 */ }
          }
          throw error
        }
      },
    )
  }

  const targetAdd = targets.command('add <id>')
    .description('登记目标并在 Root 批准后写入配置与对应凭证字段')
    .option('--spec <path>', '配置文件；- 表示从 stdin 读取')
    .option('--file <path>', '私钥文件；私钥认证必须提供')
    .option('--dry-run', '只校验并输出，不写配置或凭证')
  targetAdd.action(async (id: string) => {
    const options = targetAdd.opts<{ spec?: string; file?: string; dryRun?: boolean }>()
    if (options.spec === undefined) {
      throw new Error('缺少 --spec；用 --spec <file> 或 --spec - 从 stdin 读取')
    }
    const text = options.spec === '-'
      ? readFileSync(0, 'utf8')
      : readFileSync(resolve(options.spec), 'utf8')
    const preview = remoteTargets.addFromText(id, text, { dryRun: true })
    const auth = preview.identity.auth
    if (auth.credential === undefined) {
      targetAdd.error('目标必须提供 identity.auth.credential', { exitCode: 1 })
      return
    }
    if (auth.method !== 'private-key' && auth.method !== 'password') {
      targetAdd.error('新目标必须使用 method: private-key|password', { exitCode: 1 })
      return
    }
    if (auth.method === 'private-key' && options.file === undefined) {
      targetAdd.error('私钥认证必须提供 --file', { exitCode: 1 })
    }
    if (auth.method === 'password' && options.file !== undefined) {
      targetAdd.error('密码认证不能使用 --file', { exitCode: 1 })
    }
    if (options.dryRun === true) {
      emit(targetAdd, preview, `将登记目标 ${preview.id}\n${remoteTargetText(preview)}`)
      return
    }
    await writeTargetCredential(
      preview.id,
      auth.credential,
      auth.method,
      options.file,
      'add',
      targetBinding(preview),
      () => { remoteTargets.addFromText(id, text) },
      () => { remoteTargets.remove(preview.id) },
    )
    const result = remoteTargets.show(preview.id)
    emit(targetAdd, result, `已登记目标 ${result.id}（配置与凭证）\n${remoteTargetText(result)}`)
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
  const targetUpdate = targets.command('update-credential <target>')
    .alias('register')
    .description('Root 授权更新目标配置已引用的私钥或密码字段；不改目标配置')
    .requiredOption('--credential <ref>', '目标配置中已引用的 credential:<id>')
    .addOption(new Option('--method <method>', '认证方式').choices(['private-key', 'password']).makeOptionMandatory())
    .option('--file <path>', '私钥文件；私钥认证必须提供，密码认证不使用')
  targetUpdate.action(async (reference: string) => {
    const options = targetUpdate.opts<{ credential: string; method: 'private-key' | 'password'; file?: string }>()
    if (!isCredentialRef(options.credential)) {
      targetUpdate.error('credential 必须是 credential:<id>', { exitCode: 1 })
    }
    const shown = remoteTargets.show(reference)
    if (shown.identity.auth.credential !== options.credential) {
      targetUpdate.error('目标配置引用的 CredentialRef 与 --credential 不一致', { exitCode: 1 })
    }
    if (shown.identity.auth.method !== options.method) {
      targetUpdate.error('目标认证方式与 --method 不一致', { exitCode: 1 })
    }
    if (options.method === 'private-key' && options.file === undefined) {
      targetUpdate.error('私钥认证必须提供 --file', { exitCode: 1 })
    }
    if (options.method === 'password' && options.file !== undefined) {
      targetUpdate.error('密码认证不能使用 --file', { exitCode: 1 })
    }
    await writeTargetCredential(
      shown.id,
      options.credential as CredentialRef,
      options.method,
      options.file,
      'update-credential',
      targetBinding(shown),
    )
    emit(targetUpdate, { target: shown.id, credential: options.credential, method: options.method }, `已更新目标 ${shown.id} 的 ${options.method} 字段；目标配置未改写。`)
  })
  const targetMigrate = targets.command('migrate <target>')
    .description('显式导入旧凭据文件到 Core、回读验证后切换为 CredentialRef；不删除原文件')
    .requiredOption('--credential <ref>', 'Core 凭据引用 credential:<id>')
    .requiredOption('--yes', '确认写入 Core 并改写目标配置')
  targetMigrate.action(async (reference: string) => {
    const credential = targetMigrate.opts<{ credential: string }>().credential
    const legacy = remoteTargets.credentialMigration(reference)
    const capability = legacy.method === 'password' ? 'register-password' : 'register-private-key'
    let secret = ''
    try {
      if (!isCredentialRef(credential)) throw new SecurityFailure('access-denied', { reason: 'invalid-request' })
      const shown = remoteTargets.show(reference)
      const handler = remoteTargetsApi[capability]
      if (handler === undefined) throw new SecurityFailure('access-denied', { reason: 'unsupported-capability' })
      await trustedSecurityHost().executeComponent(
        remoteTargetsComponent,
        capability,
        { type: 'remote-target', id: shown.id },
        { operation: 'migrate' },
        async (context) => {
          secret = await readCredentialFile(legacy.path)
          if (capability === 'register-private-key') await assertUnencryptedPrivateKey(secret)
          const input = capability === 'register-private-key'
            ? { credential: credential as CredentialRef, targetBinding: targetBinding(shown), privateKey: secret }
            : { credential: credential as CredentialRef, targetBinding: targetBinding(shown), password: secret }
          await handler(context, input)
        },
      )
      const migrated = remoteTargets.useCredential(reference, credential as CredentialRef)
      emit(targetMigrate, { target: migrated, credential, capability }, `已迁移目标 ${migrated.id} 到 ${credential}；绑定 ${capability} remote-target/${migrated.id}；原文件保留：${legacy.path}`)
    } finally {
      secret = ''
    }
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
    const result = await executeRemoteAccess(reference, 'probe') as { readonly ok: boolean; readonly detail: string }
    emit(targetProbe, result, result.ok ? `探测成功：${result.detail}` : `探测失败：${result.detail}`)
    if (!result.ok) process.exitCode = 1
  })
  const targetExec = targets.command('exec <target> [command...]')
    .description('经统一入口执行远端命令，退出码透传')
  targetExec.action(async (reference: string, command: string[] = []) => {
    const result = await executeRemoteAccess(reference, 'exec', command) as { readonly exitCode: number; readonly stdout: string; readonly stderr: string }
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
    const exitCode = await executeRemoteAccess(reference, 'shell') as number
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
