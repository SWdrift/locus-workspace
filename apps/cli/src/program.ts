import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import type { LocusCore } from '@locus/core'
import type { ComponentView } from '@locus/core/components'
import type { ComponentStateView } from '@locus/core/invocation'
import type { SecurityGrantScope, SecurityHost } from '@locus/core/security'
import { configureGlobalOptions } from './global-options.ts'
import { registerInvocationCommands } from './commands/invocation.ts'
import { registerWorkspaceCommands } from './commands/workspace.ts'
import { registerComponentCommands } from './commands/component.ts'
import { registerSecurityCommands } from './commands/security.ts'
import { registerCredentialCommands } from './commands/credential.ts'
import { registerTemplateCommands } from './commands/template.ts'
import { registerPostgresCommands } from './commands/postgres.ts'
import { registerRemoteTargetCommands } from './commands/remote-targets.ts'
import { registerEventCommands } from './commands/events.ts'
import { registerShellCommand } from './commands/shell.ts'
import { pathParam } from './commands/shared.ts'
import type { CallOperation, WithCliApi } from './commands/shared.ts'
import { createCliApi } from './host/api.ts'
import { createTerminalSecurityUI } from './host/terminal.ts'
import type { CliSecurityUI } from './host/terminal.ts'
import { unwrap } from './output/errors.ts'
import { componentText } from './output/format.ts'
import { emit } from './output/output.ts'

export interface CreateProgramOptions {
  readonly host?: SecurityHost
  readonly ui?: CliSecurityUI
  readonly profile?: 'production' | 'development'
  readonly grantScope?: SecurityGrantScope
  readonly isPackageComponentId?: (id: string) => boolean
}

/** 这里只创建命令树；命令模块仅接收自身需要的调用端口。 */
export function createProgram(locus: LocusCore, options: CreateProgramOptions = {}): Command {
  const ui = options.ui ?? createTerminalSecurityUI()
  const program = configureGlobalOptions(
    new Command()
      .name('locus')
      .exitOverride()
      .description('Locus 本地工作空间：资源 URL 与 operation。')
      .usage('[options] <get|post|put|patch|delete> <uri...> | [command]')
      .showHelpAfterError(),
    {
      profile: options.profile ?? 'production',
      grantScope: options.grantScope ?? 'operation',
    },
  )
  const withApi = createApiScope(locus, program, options, ui)
  const call: CallOperation = (method, uri, body, trustedInput) =>
    withApi(async api =>
      unwrap(
        await api.invoke(
          {
            method,
            uri,
            ...(body === undefined ? {} : { body, contentType: 'application/json' }),
          },
          trustedInput,
        ),
      ),
    )

  program.argument('[command]').action(async (command?: string) => {
    if (command === undefined) {
      program.help({ error: true })
      return
    }
    const packageComponent =
      options.isPackageComponentId?.(command) ?? locus.router.operations.some(entry => entry.namespace === command)
    if (!isComponentId(locus.dataDirectory, command, packageComponent)) {
      program.error(`未知命令：${command}`, { exitCode: 1 })
      return
    }
    const result = (await call('GET', `locus://components/${pathParam(command)}`)) as ComponentView
    emit(program, result, componentText(result))
  })

  const version = program.command('version').description('读取 Locus 产品版本')
  version.action(() => {
    emit(version, locus.info, locus.info.version)
  })

  registerInvocationCommands(program, { router: locus.router, ui, withApi })
  registerSecurityCommands(program, { call, ui })
  registerCredentialCommands(program, call)
  registerWorkspaceCommands(program, call)
  registerTemplateCommands(program, call)
  registerPostgresCommands(program, { call, ui })
  registerRemoteTargetCommands(program, { call, ui })
  registerComponentCommands(program, call)
  registerEventCommands(program, call)
  registerShellCommand(program, call)
  return program
}

function createApiScope(
  locus: LocusCore,
  program: Command,
  options: CreateProgramOptions,
  ui: CliSecurityUI,
): WithCliApi {
  const components: ComponentStateView = {
    get(id) {
      const found = locus.components.list().components.find(component => component.id === id)
      return found === undefined ? undefined : { id: found.id, kind: found.kind, state: found.external?.state ?? null }
    },
  }
  return async action => {
    if (options.host === undefined) throw new Error('缺少可信 Security Host')
    const api = createCliApi({
      host: options.host,
      router: locus.router,
      events: locus.events,
      dataDirectory: locus.dataDirectory,
      components,
      ui,
      grantScope: program.opts<{ grantScope: SecurityGrantScope }>().grantScope,
    })
    try {
      return await action(api)
    } finally {
      api.dispose()
    }
  }
}

/** 只检查组件标识与定义位置，未知命令不会触发服务的惰性建库。 */
function isComponentId(dataDirectory: string, id: string, packageComponent: boolean): boolean {
  if (packageComponent) return true
  const root = join(dataDirectory, 'components')
  return existsSync(join(root, `${id}.yaml`)) || existsSync(join(root, id, 'component.yaml'))
}
