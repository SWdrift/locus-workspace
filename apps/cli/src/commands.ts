import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Command, Option } from 'commander'
import type {
  ComponentStateView, ComponentView, LocusCore, LocusMethod, SecurityGrantScope,
  SecurityHost, Workspace, WorkspaceRelation,
} from '@locus/core'
import { createCliApi, exitCodeFor, unwrap, type CliApi } from './api.ts'
import { createTerminalSecurityUI, readNewRootPassword, RESET_WARNING, type CliSecurityUI } from './security-host.ts'
import { runWorkspaceShell } from './shell.ts'

const PACKAGE_COMPONENT_IDS = ['template', 'remote-targets', 'postgres', 'gitea']

function jsonEnabled(command: Command): boolean {
  const options = command.optsWithGlobals<{ json?: boolean; human?: boolean }>()
  return options.json === true && options.human !== true
}

function prettyEnabled(command: Command): boolean {
  return command.optsWithGlobals<{ pretty?: boolean }>().pretty === true
}

function writeOut(command: Command, text: string): void {
  let root = command
  while (root.parent !== null) root = root.parent
  root.configureOutput().writeOut!(text)
}

function emit(command: Command, value: unknown, text: string): void {
  writeOut(command, jsonEnabled(command)
    ? `${JSON.stringify(value, null, prettyEnabled(command) ? 2 : 0)}\n`
    : `${text}\n`)
}

function emitJson(command: Command, value: unknown): void {
  writeOut(command, `${JSON.stringify(value, null, prettyEnabled(command) ? 2 : 0)}\n`)
}

function relationText(relation: WorkspaceRelation): string {
  return `${relation.id}  ${relation.kind}  ${relation.target.namespace}  ${relation.target.id}  [${relation.source.kind}: ${relation.source.detail}]`
}

function mountText(mount: Workspace['mounts'][number]): string {
  return `${mount.id}  ${mount.name}  ${mount.path}`
}

function componentText(view: ComponentView): string {
  const version = view.needsUpgrade
    ? `${view.version}（代码版本 ${view.codeVersion}，需要升级）`
    : view.version
  return [
    `组件：${view.id}`,
    `名称：${view.name}`,
    `种类：${view.kind}  来源：${view.source}`,
    `版本：${version}`,
    `依赖：${view.requires.length === 0 ? '无' : view.requires.join(', ')}`,
    `operation：${view.operations === undefined || view.operations.length === 0 ? '无' : view.operations.map((operation) => operation.id).join(', ')}`,
    `凭据槽：${view.credentials === undefined || view.credentials.length === 0 ? '无' : view.credentials.map((credential) => credential.id).join(', ')}`,
    `外部状态：${view.external === undefined ? '不适用' : view.external.state ?? '未探查'}`,
    `部署状态：${view.deploy.state}  ${view.deploy.detail}`,
    `定义：${view.definitionPath}`,
  ].join('\n')
}

function componentLine(view: ComponentView): string {
  const external = view.external === undefined
    ? '-'
    : view.external.state ?? (view.external.detail || '未探查')
  return `${view.id}  ${view.source}  ${view.kind}  ${view.version}  ${external}  ${view.deploy.state}`
}

function workspaceText(workspace: Workspace): string {
  return [
    `Workspace: ${workspace.name}`,
    `Identity: ${workspace.id}`,
    `创建时间: ${workspace.createdAt}`,
    '挂载:',
    ...(workspace.mounts.length === 0 ? ['  无'] : workspace.mounts.map((mount) => `  ${mountText(mount)}`)),
    '长期关系:',
    ...(workspace.relations.length === 0 ? ['  无'] : workspace.relations.map((relation) => `  ${relationText(relation)}`)),
  ].join('\n')
}

function remoteTargetLine(target: { readonly id: string; readonly connectivity: { readonly transport: string; readonly via: string; readonly host: string; readonly port: number }; readonly identity: { readonly login: string; readonly auth: { readonly method: string } } }): string {
  return `${target.id}  ${target.connectivity.transport}  ${target.connectivity.via}  ${target.connectivity.host}:${target.connectivity.port}  ${target.identity.login}  ${target.identity.auth.method}`
}

/** CLI 接受稳定 Identity 或唯一名称；名称歧义时要求使用 Identity。 */
function resolveWorkspace(locus: LocusCore, reference: string): Workspace {
  const workspaces = locus.workspaces.list()
  const byId = workspaces.find((workspace) => workspace.id === reference)
  if (byId !== undefined) return byId
  const byName = workspaces.filter((workspace) => workspace.name === reference)
  if (byName.length === 1 && byName[0] !== undefined) return byName[0]
  if (byName.length > 1) throw new Error(`Workspace 名称不唯一：${reference}；请使用 Identity`)
  throw new Error(`找不到 Workspace：${reference}`)
}

/** 顶层未知命令先判断是否像组件，避免拼写错误也创建数据目录。 */
function isComponentId(locus: LocusCore, id: string): boolean {
  if (PACKAGE_COMPONENT_IDS.includes(id)) return true
  const root = join(locus.dataDirectory, 'components')
  return existsSync(join(root, `${id}.yaml`)) || existsSync(join(root, id, 'component.yaml'))
}

function pathParam(value: string): string {
  return encodeURIComponent(value)
}

/** URL 动词也由可信 Host 收集 tty 字段；Body 中禁止携带这些字段。 */
async function trustedTtyInput(
  locus: LocusCore,
  ui: CliSecurityUI,
  method: LocusMethod,
  uris: readonly string[],
  body: unknown,
): Promise<Readonly<Record<string, string>> | undefined> {
  if (uris.length === 0) return undefined
  const collected: Record<string, string> = {}
  for (const uri of uris) {
    let fields
    try {
      fields = locus.router.resolve(method, uri).operation.fields
    } catch {
      continue
    }
    for (const [name, field] of Object.entries(fields ?? {})) {
      if (field.tty !== true) continue
      if (body !== null && typeof body === 'object' && !Array.isArray(body) && Object.hasOwn(body, name)) continue
      if (!ui.interactive) continue
      collected[name] = await ui.readSecret(`${name}（隐藏输入）：`)
    }
  }
  return Object.keys(collected).length === 0 ? undefined : collected
}

function parseQualifiedOperation(value: string, command: Command): { component: string; operation: string } {
  const index = value.indexOf(':')
  if (index <= 0 || index === value.length - 1 || value.indexOf(':', index + 1) !== -1) {
    command.error('operation 必须是 component:operation', { exitCode: 1 })
  }
  return { component: value.slice(0, index), operation: value.slice(index + 1) }
}

export interface CreateProgramOptions {
  readonly host?: SecurityHost
  readonly ui?: CliSecurityUI
  readonly profile?: 'production' | 'development'
  readonly grantScope?: SecurityGrantScope
}

function readBodyOptions(command: Command): { body: unknown; contentType: string | undefined } | undefined {
  const options = command.opts<{ data?: string; file?: string; contentType?: string }>()
  if (options.data !== undefined && options.file !== undefined) {
    command.error('--data 与 --file 不能同时使用', { exitCode: 1 })
  }
  const raw = options.data ?? (options.file === undefined
    ? undefined
    : options.file === '-'
      ? readFileSync(0, 'utf8')
      : readFileSync(resolve(options.file), 'utf8'))
  if (raw === undefined) return { body: undefined, contentType: options.contentType }
  const type = (options.contentType ?? 'application/json').split(';', 1)[0]!.trim().toLowerCase()
  if (type !== 'application/json' && !type.endsWith('+json')) {
    command.error('只接受 application/json 或 +json', { exitCode: 1 })
  }
  try {
    return { body: JSON.parse(raw), contentType: options.contentType ?? 'application/json' }
  } catch {
    command.error('Body 不是合法 JSON', { exitCode: 1 })
  }
}

/** 构造独立 CLI 的命令树；所有业务写入都经 Core operation。 */
export function createProgram(locus: LocusCore, options: CreateProgramOptions = {}): Command {
  const ui = options.ui ?? createTerminalSecurityUI()
  let program: Command

  const componentState: ComponentStateView = {
    get(id: string) {
      const found = locus.components.list().components.find((component) => component.id === id)
      return found === undefined
        ? undefined
        : { id: found.id, kind: found.kind, state: found.external?.state ?? null }
    },
  }

  async function withApi<T>(action: (api: CliApi) => Promise<T>): Promise<T> {
    if (options.host === undefined) throw new Error('缺少可信 Security Host')
    const api = createCliApi({
      host: options.host,
      router: locus.router,
      events: locus.events,
      dataDirectory: locus.dataDirectory,
      components: componentState,
      ui,
      grantScope: options.grantScope ?? program.opts<{ grantScope?: SecurityGrantScope }>().grantScope ?? 'operation',
    })
    try {
      return await action(api)
    } finally {
      api.dispose()
    }
  }

  async function call(
    method: LocusMethod,
    uri: string,
    body?: unknown,
    trustedInput?: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    return withApi(async (api) => {
      const result = await api.invoke({
        method,
        uri,
        ...(body === undefined ? {} : { body }),
        ...(body === undefined ? {} : { contentType: 'application/json' }),
      }, trustedInput)
      return unwrap(result)
    })
  }

  program = new Command()
    .name('locus')
    .exitOverride()
    .description('Locus 本地工作空间：资源 URL 与 operation。')
    .option('--json', '输出机器可读 JSON，诊断仍写入 stderr')
    .option('--pretty', '美化 JSON 输出；只影响 JSON')
    .option('--human', '强制人类可读输出')
    .addOption(new Option('--grant-scope <scope>', 'Root 提权范围').choices(['operation', 'session']).default('operation'))
    .addOption(new Option('--profile <profile>', '隔离安全 Profile 与 development 数据目录').choices(['production', 'development']).default(options.profile ?? 'production'))
    .usage('[options] <get|post|put|patch|delete> <uri...> | [command]')
    .showHelpAfterError()
    .argument('[command]')
    .action(async (command?: string) => {
      if (command === undefined) {
        program.help({ error: true })
        return
      }
      if (!isComponentId(locus, command)) {
        program.error(`未知命令：${command}`, { exitCode: 1 })
        return
      }
      const result = await call('GET', `locus://components/${pathParam(command)}`) as ComponentView
      emit(program, result, componentText(result))
    })

  const version = program.command('version').description('读取 Locus 产品版本')
  version.action(() => {
    emit(version, locus.info, locus.info.version)
  })

  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    const verb = program.command(`${method} <uri...>`)
      .description(`按 URL 直接调用 operation（${method.toUpperCase()}）`)
      .option('-d, --data <json>', 'JSON Body')
      .option('-f, --file <path>', '从文件或 - 读取 Body')
      .option('--content-type <type>', 'Body 媒体类型')
    verb.action(async (uris: string[]) => {
      const upper = method.toUpperCase() as LocusMethod
      if (upper !== 'GET' && uris.length > 1) {
        verb.error('只有 GET 支持多个 URI', { exitCode: 1 })
      }
      const parsed = readBodyOptions(verb)
      if (parsed === undefined) return
      if (upper === 'GET' && parsed.body !== undefined) {
        verb.error('GET 不接受 Body', { exitCode: 1 })
      }
      const requests = uris.map((uri) => ({
        method: upper,
        uri,
        ...(parsed.body === undefined ? {} : { body: parsed.body }),
        ...(parsed.contentType === undefined ? {} : { contentType: parsed.contentType }),
      }))
      const trusted = await trustedTtyInput(locus, ui, upper, uris, parsed.body)
      const results = await withApi((api) => (upper === 'GET'
        ? api.invokeAll(requests as readonly (typeof requests[number] & { readonly method: 'GET' })[])
        : Promise.all(requests.map((request) => api.invoke(request, trusted)))))
      const failed = results.some((result) => !result.ok)
      if (jsonEnabled(verb)) {
        emitJson(verb, results.length === 1 ? results[0] : results)
      } else {
        for (const result of results) {
          if (result.ok) {
            writeOut(verb, `${typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)}\n`)
          } else {
            process.stderr.write(`Locus 调用失败 [${result.error.code}]：${result.error.message}\n`)
          }
        }
      }
      if (failed) process.exitCode = results.length > 1 ? 3 : exitCodeFor(results.find((result) => !result.ok)!.error.code)
    })
  }

  const init = program.command('init').description('通过可信 TTY 隐藏输入初始化 Root；不读取参数或环境中的密码')
  init.action(async () => {
    const { password, confirmation } = await readNewRootPassword(ui)
    await withApi(async (api) => {
      const result = await api.invoke(
        { method: 'POST', uri: 'locus://security/actions/init' },
        { password, confirmation },
      )
      unwrap(result)
    })
    emit(init, { initialized: true }, 'Root 与默认 User 已初始化。')
  })

  const security = program.command('security').description('Root 身份、认证状态与本机管理')
  const securityStatus = security.command('status').description('读取安全元数据；不认证、不访问凭据保管器')
  securityStatus.action(async () => {
    const result = await call('GET', 'locus://security') as { initialized: boolean; profile: string }
    emit(securityStatus, result, `Root：${result.initialized ? '已初始化' : '未初始化'}\nProfile：${result.profile}`)
  })
  const reset = security.command('reset-root')
    .description('本机管理接管：TTY 明确确认后替换 Root 密码，撤销旧授权；没有 --yes 绕过')
  reset.action(async () => {
    if (!await ui.confirmLocalTakeover(RESET_WARNING)) {
      reset.error('已取消本机管理接管', { exitCode: 2 })
    }
    const { password, confirmation } = await readNewRootPassword(ui)
    await call('POST', 'locus://security/actions/reset-root', undefined, {
      password,
      confirmation,
      confirm: 'RESET ROOT',
    })
    emit(reset, { reset: true }, 'Root 已重置，旧授权已撤销；Workspace 与资源凭据未删除。')
  })
  const change = security.command('change-root-password')
    .description('隐藏输入新密码，使用旧 Root 密码为本次变更单独授权')
  change.action(async () => {
    const { password, confirmation } = await readNewRootPassword(ui)
    await call('POST', 'locus://security/actions/change-root-password', undefined, { password, confirmation })
    emit(change, { changed: true }, 'Root 密码已变更，旧授权已撤销。')
  })
  const provider = security.command('provider').description('查询 Provider 装配与后端声明')
  provider.action(async () => {
    const result = await call('GET', 'locus://security/provider') as { id: string; backend: string; state: string }
    emit(provider, result, `Provider：${result.id}\n后端：${result.backend}\n状态：${result.state}`)
  })

  const operation = security.command('operation').description('operation 级认证等级与 Root 覆盖')
  const operationList = operation.command('list').description('列出组件 operation、声明等级、覆盖与最终来源')
  operationList.action(async () => {
    const result = await call('GET', 'locus://security/operations') as Array<{ componentId: string; operation: string; effectiveAuthLevel: string; defaultAuthLevel: string; source: string }>
    emit(operationList, result, result.map((item) => (
      `${item.componentId}:${item.operation}  ${item.effectiveAuthLevel}  default=${item.defaultAuthLevel}  source=${item.source}`
    )).join('\n') || '没有可配置 operation。')
  })
  const operationSet = operation.command('set <operation> <level>')
    .description('Root 覆盖 operation 的认证等级；operation 形如 postgres:pg.database.register')
  operationSet.action(async (reference: string, level: string) => {
    const parsed = parseQualifiedOperation(reference, operationSet)
    if (level !== 'user' && level !== 'root') {
      operationSet.error('level 必须是 user 或 root', { exitCode: 1 })
      return
    }
    const result = await call(
      'PUT',
      `locus://security/operations/${pathParam(parsed.component)}/${pathParam(parsed.operation)}`,
      { level },
    ) as { effectiveAuthLevel: string; source: string }
    emit(operationSet, result, `已设置 ${reference} 为 ${result.effectiveAuthLevel}（source=${result.source}）。`)
  })
  const operationReset = operation.command('reset <operation>').description('Root 清除 operation 覆盖')
  operationReset.action(async (reference: string) => {
    const parsed = parseQualifiedOperation(reference, operationReset)
    const result = await call(
      'DELETE',
      `locus://security/operations/${pathParam(parsed.component)}/${pathParam(parsed.operation)}`,
    ) as { effectiveAuthLevel: string; source: string }
    emit(operationReset, result, `已恢复 ${reference} 为 ${result.effectiveAuthLevel}（source=${result.source}）。`)
  })

  const credential = program.command('credential').description('Root 诊断与清理；普通使用请走组件 operation')
  const providerStatus = credential.command('provider-status')
    .description('查询 Provider 装配与后端声明，不读取秘密')
  providerStatus.action(async () => {
    const result = await call('GET', 'locus://security/provider')
    emit(providerStatus, result, JSON.stringify(result))
  })
  const credentialList = credential.command('list').description('只列举当前 Profile 的凭据元数据与公开字段')
  credentialList.action(async () => {
    const result = await call('GET', 'locus://credentials') as { credentials: Array<{ reference: string; providerId: string; fields: Record<string, string> }> }
    emit(
      credentialList,
      result.credentials,
      result.credentials.map((item) => `${item.reference}  ${item.providerId}  ${Object.keys(item.fields).join(',') || '-'}`).join('\n') || '没有凭据。',
    )
  })
  const bindings = credential.command('bindings').description('列举 component + slot + resourceKey 绑定')
  bindings.action(async () => {
    const result = await call('GET', 'locus://credentials') as { bindings: Array<{ componentId: string; slot: string; resourceKey: string; reference: string }> }
    emit(
      bindings,
      result.bindings,
      result.bindings.map((item) => `${item.componentId}  ${item.slot}  ${item.resourceKey}  -> ${item.reference}`).join('\n') || '没有绑定。',
    )
  })
  const credentialStatus = credential.command('status <ref>').description('检查凭据元数据与 Provider 条目；不输出秘密')
  credentialStatus.action(async (reference: string) => {
    const result = await call('POST', 'locus://credentials/actions/status', { reference }) as {
      metadata: { reference: string }
      present: boolean
    }
    emit(credentialStatus, result, `${result.metadata.reference}  ${result.present ? '存在' : '缺失'}`)
  })
  const credentialRemove = credential.command('remove <ref>').description('Root 授权删除指定凭据与其全部绑定')
  credentialRemove.action(async (reference: string) => {
    const result = await call('GET', 'locus://credentials') as {
      bindings: Array<{ componentId: string; slot: string; resourceKey: string; reference: string }>
    }
    const found = result.bindings.filter((item) => item.reference === reference)
    if (found.length === 0) {
      credentialRemove.error(`找不到凭据绑定：${reference}`, { exitCode: 2 })
      return
    }
    const first = found[0]!
    await call('DELETE', `locus://credentials/${pathParam(first.componentId)}/${pathParam(first.slot)}/${pathParam(first.resourceKey)}`)
    emit(credentialRemove, { reference, removed: true }, `已删除凭据 ${reference} 及其绑定。`)
  })
  const cleanup = credential.command('cleanup')
    .description('Root 检查未登记元数据的孤立条目；--yes 才删除')
    .option('--yes', '确认删除孤立条目')
  cleanup.action(async () => {
    const apply = cleanup.opts<{ yes?: boolean }>().yes === true
    const result = await call('POST', 'locus://credentials/actions/cleanup', { apply }) as {
      service: string; orphans: readonly string[]; removed: number; remaining: number
    }
    const detail = result.orphans.length === 0
      ? `service ${result.service} 没有孤立条目。`
      : `${apply ? '已删除' : '发现'} ${result.orphans.length} 个孤立条目：${result.orphans.join(', ')}；剩余 ${result.remaining}。`
    emit(cleanup, result, detail)
  })

  const workspace = program.command('workspace').description('持久工作语境与显式关系，不依赖目录')
  const create = workspace.command('create <name>').description('创建具有新 UUID 的 Workspace，可无目录')
  create.action(async (name: string) => {
    const result = await call('POST', 'locus://workspaces', { name }) as Workspace
    emit(create, result, workspaceText(result))
  })
  const list = workspace.command('list').description('列举长期 Workspace')
  list.action(async () => {
    const result = await call('GET', 'locus://workspaces') as Workspace[]
    emit(list, result, result.map((item) => `${item.id}  ${item.name}  [${item.mounts.length} 挂载]`).join('\n') || '没有 Workspace。')
  })
  const show = workspace.command('show <workspace>').alias('open').description('按 Identity 或唯一名称查看挂载与关系')
  show.action(async (reference: string) => {
    const result = await call('GET', `locus://workspaces/${pathParam(reference)}`) as Workspace
    emit(show, result, workspaceText(result))
  })
  const rename = workspace.command('rename <workspace> <name>').description('改名而不改变 Identity')
  rename.action(async (reference: string, name: string) => {
    const result = await call('PATCH', `locus://workspaces/${pathParam(reference)}`, { name }) as Workspace
    emit(rename, result, workspaceText(result))
  })
  const remove = workspace.command('remove <workspace>')
    .description('删除 Workspace 及其挂载与关系，不删除外部目录')
    .requiredOption('--yes', '确认删除；不等待交互输入')
  remove.action(async (reference: string) => {
    const result = await call('DELETE', `locus://workspaces/${pathParam(reference)}`)
    emit(remove, result, `已删除 Workspace ${reference}；外部目录未删除。`)
  })
  const link = workspace.command('link <workspace> <namespace> <reference>')
    .description('显式保存外部引用；关联 Workspace 时 namespace 为 locus.workspace')
    .addOption(new Option('--kind <kind>', '长期关系种类').choices(['member', 'association']).default('association'))
    .option('--source <detail>', '确认来源说明', 'CLI 显式输入')
  link.action(async (workspaceReference: string, namespace: string, reference: string) => {
    const source = link.opts<{ kind: WorkspaceRelation['kind']; source: string }>()
    const result = await call('POST', `locus://workspaces/${pathParam(workspaceReference)}/relations`, {
      kind: source.kind,
      namespace,
      id: reference,
      source: { kind: 'manual', detail: source.source },
    }) as WorkspaceRelation
    emit(link, result, relationText(result))
  })
  const unlink = workspace.command('unlink <workspace> <relation-id>')
    .description('仅解除这条长期关系，不删除外部资源或被引用 Workspace')
    .requiredOption('--yes', '确认移除关系；不等待交互输入')
  unlink.action(async (reference: string, relationId: string) => {
    const result = await call('DELETE', `locus://workspaces/${pathParam(reference)}/relations/${pathParam(relationId)}`)
    emit(unlink, result, `已解除关系 ${relationId}；外部资源未删除。`)
  })
  const mount = workspace.command('mount <workspace> <path>')
    .description('挂载本机绝对目录；默认名称取目录名')
    .option('--name <name>', '挂载名称，用于 shell 环境变量')
  mount.action(async (reference: string, path: string) => {
    const name = mount.opts<{ name?: string }>().name
    const result = await call('POST', `locus://workspaces/${pathParam(reference)}/mounts`, {
      path,
      ...(name === undefined ? {} : { name }),
    }) as Workspace['mounts'][number]
    emit(mount, result, mountText(result))
  })
  const mounts = workspace.command('mounts <workspace>').description('列举 Workspace 的本机挂载')
  mounts.action(async (reference: string) => {
    const result = await call('GET', `locus://workspaces/${pathParam(reference)}/mounts`) as Workspace['mounts']
    emit(mounts, result, result.map(mountText).join('\n') || '没有挂载。')
  })
  const unmount = workspace.command('unmount <workspace> <mount>')
    .description('取消挂载，不删除外部目录')
    .requiredOption('--yes', '确认取消挂载；不等待交互输入')
  unmount.action(async (reference: string, mountReference: string) => {
    const result = await call('DELETE', `locus://workspaces/${pathParam(reference)}/mounts/${pathParam(mountReference)}`)
    emit(unmount, result, `已取消挂载 ${mountReference}；外部目录未删除。`)
  })

  const template = program.command('template').description('本机项目模板：复制文件夹并记录来源')
  template.action(async () => {
    const result = await call('GET', 'locus://components/template') as ComponentView
    emit(template, result, componentText(result))
  })
  const templateList = template.command('list').description('列出内置模板')
  templateList.action(async () => {
    const result = await call('GET', 'template://templates') as Array<{ id: string; version?: string; name: string; description?: string }>
    emit(
      templateList,
      result,
      result.map((item) => `${item.id}  ${item.version ?? '-'}  ${item.name}${item.description ? `  ${item.description}` : ''}`).join('\n') || '没有内置模板。',
    )
  })
  const templateCreate = template.command('create <template> <destination>')
    .description('复制模板到新目录；目标必须不存在')
    .option('--dry-run', '只计算文件、目录与 digest，不写目标')
  templateCreate.action(async (templateReference: string, destination: string) => {
    const result = await call(
      'POST',
      `template://templates/${pathParam(templateReference)}/instances`,
      { destination: resolve(destination), dryRun: templateCreate.opts<{ dryRun?: boolean }>().dryRun === true },
    ) as {
      dryRun: boolean; destination: string; template: { id: string; version?: string }; files: readonly unknown[];
      directories: readonly unknown[]; digest: string; metadataPath?: string
    }
    emit(templateCreate, result, [
      result.dryRun ? `将创建：${result.destination}` : `已创建：${result.destination}`,
      `模板：${result.template.id}${result.template.version === undefined ? '' : `@${result.template.version}`}`,
      `文件：${result.files.length}  目录：${result.directories.length}`,
      `Digest：${result.digest}`,
      ...(result.dryRun || result.metadataPath === undefined ? [] : [`实例记录：${result.metadataPath}`]),
    ].join('\n'))
  })

  const pg = program.command('pg').description('PostgreSQL 组件 operation：登记凭据与查询')
  const pgRegister = pg.command('register <resource>')
    .description('登记 PostgreSQL 目标并写入 database-auth；密码隐藏输入')
    .requiredOption('--host <host>', 'PostgreSQL 主机')
    .requiredOption('--database <database>', '数据库名')
    .option('--port <port>', 'PostgreSQL 端口')
    .requiredOption('--username <name>', 'PostgreSQL 登录名')
  pgRegister.action(async (resource: string) => {
    const opts = pgRegister.opts<{ host: string; database: string; port?: string; username: string }>()
    const password = await ui.readSecret('PostgreSQL 密码（隐藏输入）：')
    const result = await call(
      'PUT',
      `pg://databases/${pathParam(resource)}`,
      {
        host: opts.host,
        database: opts.database,
        ...(opts.port === undefined ? {} : { port: opts.port }),
        username: opts.username,
      },
      { password },
    ) as { reference: string }
    emit(pgRegister, { resource, host: opts.host, database: opts.database, registered: true, reference: result.reference }, `已登记 PostgreSQL ${resource}；目标 ${opts.host}/${opts.database}；凭据 ${result.reference}。`)
  })
  const pgList = pg.command('list <resource>')
    .description('使用 database-auth 绑定连接并查询 PostgreSQL')
    .option('--sql <sql>', '查询语句', 'select 1')
  pgList.action(async (resource: string) => {
    const result = await call('POST', `pg://databases/${pathParam(resource)}/queries`, {
      sql: pgList.opts<{ sql: string }>().sql,
    })
    emit(pgList, result, JSON.stringify(result))
  })

  const targets = program.command('remote-targets')
    .alias('rt')
    .description('远程目标：声明式登记 SSH 目标，经统一 operation 探测与执行')
  targets.action(async () => {
    const result = await call('GET', 'locus://components/remote-targets') as ComponentView
    emit(targets, result, componentText(result))
  })
  async function targetSecret(method: 'private-key' | 'password', file: string | undefined): Promise<Readonly<Record<string, string>>> {
    const pkg = await import('@locus/remote-targets')
    if (method === 'password') {
      if (file !== undefined) throw new Error('密码认证不能使用 --file')
      return { password: await ui.readSecret('SSH 密码（隐藏输入）：') }
    }
    if (file === undefined) throw new Error('私钥认证必须提供 --file')
    const privateKey = await pkg.readCredentialFile(resolve(file))
    await pkg.assertUnencryptedPrivateKey(privateKey)
    return { privateKey }
  }
  const targetAdd = targets.command('add <id>')
    .description('登记目标并在 Root 批准后写入配置与对应凭据字段')
    .option('--spec <path>', '配置文件；- 表示从 stdin 读取')
    .option('--file <path>', '私钥文件；私钥认证必须提供')
    .option('--credential-file <path>', '私钥文件（与 --file 等价）')
    .option('--dry-run', '只校验并输出，不写配置或凭证')
  targetAdd.action(async (id: string) => {
    const opts = targetAdd.opts<{ spec?: string; file?: string; credentialFile?: string; dryRun?: boolean }>()
    const file = opts.credentialFile ?? opts.file
    if (opts.credentialFile !== undefined && opts.file !== undefined) {
      targetAdd.error('--file 与 --credential-file 只能提供一个', { exitCode: 1 })
    }
    if (opts.spec === undefined) throw new Error('缺少 --spec；用 --spec <file> 或 --spec - 从 stdin 读取')
    const text = opts.spec === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(opts.spec), 'utf8')
    const pkg = await import('@locus/remote-targets')
    const preview = pkg.parseAddSpecText(text, id)
    const method = preview.identity.auth.method
    if (method !== 'private-key' && method !== 'password') {
      targetAdd.error('新目标必须使用 method: private-key|password', { exitCode: 1 })
      return
    }
    if (opts.dryRun === true) {
      emit(targetAdd, preview, `将登记目标 ${preview.id}\n${remoteTargetLine(preview)}`)
      return
    }
    const secret = await targetSecret(method, file)
    const result = await call('PUT', `rt://targets/${pathParam(id)}`, { spec: text }, secret)
    emit(targetAdd, result, `已登记目标 ${id}（配置与凭证）\n${remoteTargetLine(result as typeof preview)}`)
  })
  const targetList = targets.command('list').description('列举已登记目标')
  targetList.action(async () => {
    const result = await call('GET', 'rt://targets') as Array<Parameters<typeof remoteTargetLine>[0]>
    emit(targetList, result, result.map(remoteTargetLine).join('\n') || '没有远程目标。')
  })
  const targetShow = targets.command('show <target>').description('按 id、唯一前缀或标签查看目标与最近探测')
  targetShow.action(async (reference: string) => {
    const result = await call('GET', `rt://targets/${pathParam(reference)}`)
    emit(targetShow, result, JSON.stringify(result, null, 2))
  })
  const targetUpdate = targets.command('update-credential <target>')
    .alias('register')
    .description('Root 授权更新目标已绑定的私钥或密码字段；不改目标配置')
    .addOption(new Option('--method <method>', '认证方式').choices(['private-key', 'password']).makeOptionMandatory())
    .option('--file <path>', '私钥文件；私钥认证必须提供，密码认证不使用')
    .option('--credential-file <path>', '私钥文件（与 --file 等价）')
  targetUpdate.action(async (reference: string) => {
    const opts = targetUpdate.opts<{ method: 'private-key' | 'password'; file?: string; credentialFile?: string }>()
    const file = opts.credentialFile ?? opts.file
    if (opts.credentialFile !== undefined && opts.file !== undefined) {
      targetUpdate.error('--file 与 --credential-file 只能提供一个', { exitCode: 1 })
    }
    const shown = await call('GET', `rt://targets/${pathParam(reference)}`) as { id: string; identity: { auth: { method: string } } }
    if (shown.identity.auth.method !== opts.method) {
      targetUpdate.error('目标认证方式与 --method 不一致', { exitCode: 1 })
    }
    const secret = await targetSecret(opts.method, file)
    const result = await call(
      'POST',
      `rt://targets/${pathParam(shown.id)}/actions/credential`,
      { method: opts.method },
      secret,
    )
    emit(targetUpdate, result, `已更新目标 ${shown.id} 的 ${opts.method} 字段；目标配置未改写。`)
  })
  const targetMigrate = targets.command('migrate <target>')
    .description('显式导入旧凭据文件到 Core，回读验证后切换；不删除原文件')
    .addOption(new Option('--method <method>', '旧凭据类型').choices(['private-key', 'password']).makeOptionMandatory())
    .option('--file <path>', '旧凭据文件；缺省按目标配置推导')
    .requiredOption('--yes', '确认写入 Core 并改写目标配置')
  targetMigrate.action(async (reference: string) => {
    const method = targetMigrate.opts<{ method: 'private-key' | 'password'; file?: string }>().method
    const pkg = await import('@locus/remote-targets')
    const service = pkg.createRemoteTargetsService({ root: join(locus.dataDirectory, 'remote-targets') })
    let secret = ''
    try {
      const legacy = method === 'private-key' && targetMigrate.opts<{ file?: string }>().file !== undefined
        ? { method: 'key' as const, path: resolve(targetMigrate.opts<{ file: string }>().file) }
        : service.credentialMigration(reference)
      if ((legacy.method === 'key') !== (method === 'private-key')) {
        targetMigrate.error('--method 与旧认证方式不一致', { exitCode: 1 })
      }
      secret = await pkg.readCredentialFile(legacy.path)
      if (method === 'private-key') await pkg.assertUnencryptedPrivateKey(secret)
      const result = await call(
        'POST',
        `rt://targets/${pathParam(reference)}/actions/migrate`,
        { method },
        method === 'private-key' ? { privateKey: secret } : { password: secret },
      )
      emit(targetMigrate, result, `已迁移目标 ${reference} 到 Core 凭据绑定；原文件保留：${legacy.path}`)
    } finally {
      secret = ''
      service.dispose()
    }
  })
  const targetRemove = targets.command('remove <target>')
    .description('移除目标定义，不删除目标自身')
    .requiredOption('--yes', '确认移除；不等待交互输入')
  targetRemove.action(async (reference: string) => {
    const result = await call('DELETE', `rt://targets/${pathParam(reference)}`)
    emit(targetRemove, result, `已移除目标 ${reference}。`)
  })
  const targetProbe = targets.command('probe <target>').description('只读连接并执行 hostname，记录可达性')
  targetProbe.action(async (reference: string) => {
    const result = await call('GET', `rt://targets/${pathParam(reference)}/system`) as { ok: boolean; detail: string }
    emit(targetProbe, result, result.ok ? `探测成功：${result.detail}` : `探测失败：${result.detail}`)
    if (!result.ok) process.exitCode = 1
  })
  const targetServices = targets.command('services <target>').description('列举 cmd 目标服务')
  targetServices.action(async (reference: string) => {
    const result = await call('GET', `rt://targets/${pathParam(reference)}/services`) as Array<{ name: string; status: string }>
    emit(targetServices, result, result.map((service) => `${service.name}  ${service.status}`).join('\n') || '没有服务。')
  })
  const targetRestart = targets.command('restart <target> <service>').description('重启 cmd 目标服务')
  targetRestart.action(async (reference: string, service: string) => {
    const result = await call('POST', `rt://targets/${pathParam(reference)}/services/${pathParam(service)}/actions/restart`)
    emit(targetRestart, result, JSON.stringify(result))
  })
  const targetExec = targets.command('exec <target> [command...]')
    .description('经统一 operation 执行远端命令，退出码透传')
  targetExec.action(async (reference: string, command: string[] = []) => {
    const result = await call('POST', `rt://targets/${pathParam(reference)}/jobs`, { command }) as {
      exitCode: number; stdout: string; stderr: string
    }
    if (jsonEnabled(targetExec)) {
      emitJson(targetExec, result)
    } else {
      if (result.stdout.length > 0) writeOut(targetExec, result.stdout)
      if (result.stderr.length > 0) process.stderr.write(result.stderr)
    }
    if (result.exitCode !== 0) process.exitCode = result.exitCode
  })
  const targetShell = targets.command('shell <target>').description('打开目标交互式 Shell；继承当前终端')
  targetShell.action(async (reference: string) => {
    const result = await call('POST', `rt://targets/${pathParam(reference)}/jobs`, { interactive: true }) as { exitCode: number }
    if (result.exitCode !== 0) process.exitCode = result.exitCode
  })

  const component = program.command('component').description('组件定义、状态与生命周期')
  const componentList = component.command('list').description('列出包组件与动态组件')
  componentList.action(async () => {
    const result = await call('GET', 'locus://components') as {
      components: ComponentView[]
      problems: Array<{ id: string; source: string; path: string; error: string }>
    }
    emit(
      componentList,
      result,
      [...result.components.map(componentLine), ...result.problems.map((problem) => `! ${problem.id}  ${problem.source}  ${problem.path}  ${problem.error}`)].join('\n') || '没有组件。',
    )
  })
  const componentShow = component.command('show <id>').description('查看定义、状态与说明')
  componentShow.action(async (id: string) => {
    const result = await call('GET', `locus://components/${pathParam(id)}`) as ComponentView
    emit(componentShow, result, componentText(result))
  })
  const componentAdd = component.command('add <source>')
    .description('登记动态组件：YAML 文件、包含 component.yaml 的文件夹或 -')
  componentAdd.action(async (source: string) => {
    const result = await call(
      'POST',
      'locus://components',
      source === '-' ? { text: readFileSync(0, 'utf8') } : { path: resolve(source) },
    ) as ComponentView
    emit(componentAdd, result, `已登记组件 ${result.id}\n${componentText(result)}`)
  })
  const componentUpgrade = component.command('upgrade <id>').description('按包代码刷新定义字段，保留 config')
  componentUpgrade.action(async (id: string) => {
    const result = await call('POST', `locus://components/${pathParam(id)}/actions/upgrade`) as ComponentView
    emit(componentUpgrade, result, `已升级组件 ${result.id}\n${componentText(result)}`)
  })
  const componentRemove = component.command('remove <id>')
    .description('删除动态组件定义与状态，不触碰外部软件')
    .requiredOption('--yes', '确认删除；不等待交互输入')
  componentRemove.action(async (id: string) => {
    const result = await call('DELETE', `locus://components/${pathParam(id)}`)
    emit(componentRemove, result, `已删除组件 ${id}；外部软件未变更。`)
  })
  const componentProbe = component.command('probe [id]')
    .description('执行声明的探针并记录外部状态；--all 探查所有 external 组件')
    .option('--all', '探查所有 external 组件')
  componentProbe.action(async (id?: string) => {
    if (componentProbe.opts<{ all?: boolean }>().all === true) {
      if (id !== undefined) componentProbe.error('--all 不能与组件 id 同时使用', { exitCode: 1 })
      const result = await call('POST', 'locus://components/actions/probe') as {
        probed: ComponentView[]; skipped: Array<{ id: string; reason: string }>
      }
      emit(
        componentProbe,
        result,
        [...result.probed.map((view) => `${view.id}  ${view.external?.state ?? '不适用'}`), ...result.skipped.map((item) => `${item.id}  跳过  ${item.reason}`)].join('\n') || '没有可探查的组件。',
      )
      if (result.skipped.length > 0 || result.probed.some((view) => view.external?.state !== 'healthy')) process.exitCode = 1
      return
    }
    if (id === undefined) {
      componentProbe.error('缺少组件 id 或 --all', { exitCode: 1 })
      return
    }
    const result = await call('POST', `locus://components/${pathParam(id)}/actions/probe`) as ComponentView
    emit(componentProbe, result, `${result.id}  ${result.external?.state ?? '不适用'}`)
    if (result.external?.state !== 'healthy') process.exitCode = 1
  })
  const componentDeploy = component.command('deploy <id>')
    .description('执行声明的部署入口并记录结果')
    .requiredOption('--yes', '确认执行部署；不等待交互输入')
  componentDeploy.action(async (id: string) => {
    const result = await call('POST', `locus://components/${pathParam(id)}/actions/deploy`) as ComponentView
    emit(componentDeploy, result, `${result.id}  ${result.deploy.state}  ${result.deploy.detail}`)
    if (result.deploy.state !== 'deployed') process.exitCode = 1
  })

  const events = program.command('events').description('查询请求与领域事件')
  const eventsList = events.command('list').description('按 type 或 subject 查询最近事件')
    .option('--type <type>', '事件类型')
    .option('--subject <subject>', '事件 subject')
    .option('--limit <n>', '最多返回条数', '100')
  eventsList.action(async () => {
    const opts = eventsList.opts<{ type?: string; subject?: string; limit: string }>()
    const query = new URLSearchParams()
    if (opts.type !== undefined) query.set('type', opts.type)
    if (opts.subject !== undefined) query.set('subject', opts.subject)
    query.set('limit', opts.limit)
    const result = await call('GET', `locus://events?${query.toString()}`) as Array<{ time: string; type: string; subject?: string }>
    emit(eventsList, result, result.map((event) => `${event.time}  ${event.type}  ${event.subject ?? '-'}`).join('\n') || '没有事件。')
  })

  const shell = program.command('shell <workspace>')
    .description('在 Workspace 上下文中启动用户 shell；注入 locus、挂载与 LOCUS_* 环境')
    .option('--shell <path>', '指定 shell 可执行文件')
    .option('--command <command>', '执行一条命令后退出，不进入交互模式')
    .option('--print-env', '只输出解析后的 shell 上下文 JSON，不启动 shell')
  shell.action((reference: string) => {
    const target = resolveWorkspace(locus, reference)
    const opts = shell.opts<{
      shell?: string | undefined
      command?: string | undefined
      printEnv?: boolean | undefined
    }>()
    const exitCode = runWorkspaceShell(locus, target, opts)
    if (exitCode !== 0) process.exitCode = exitCode
  })

  return program
}
