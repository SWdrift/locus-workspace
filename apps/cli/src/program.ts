import { Command } from 'commander'
import type { LocusCore } from '@locus/core'
import type { ComponentStateView } from '@locus/core/invocation'
import type { SecurityGrantScope, SecurityHost } from '@locus/core/security'
import { configureGlobalOptions } from './global-options.ts'
import { registerInvocationCommands } from './commands/invocation.ts'
import { registerHelpCommand } from './commands/help.ts'
import { registerSecurityCommands } from './commands/security.ts'
import { registerShellCommand } from './commands/shell.ts'
import type { CallOperation, WithCliApi } from './commands/shared.ts'
import { createCliApi } from './host/api.ts'
import { createTerminalSecurityUI } from './host/terminal.ts'
import type { CliSecurityUI } from './host/terminal.ts'
import { unwrap, usageErrorText } from './output/errors.ts'
import { emit } from './output/output.ts'

export interface CreateProgramOptions {
  readonly host?: SecurityHost
  readonly ui?: CliSecurityUI
  readonly profile?: 'production' | 'development'
  readonly grantScope?: SecurityGrantScope
  readonly debug?: boolean
}

/** 命令树只保留 URL 调用与确需本机交互的入口，不访问领域服务。 */
export function createProgram(locus: LocusCore, options: CreateProgramOptions = {}): Command {
  const ui = options.ui ?? createTerminalSecurityUI()
  const program = configureGlobalOptions(
    new Command()
      .name('locus')
      .exitOverride()
      .configureOutput({ outputError: (text, write) => write(usageErrorText(text)) })
      .description('Locus 本地工作空间：资源 URL 与 operation。')
      .usage('[options] [get|post|put|patch|delete] <uri...> | [command]')
      .addHelpCommand(false)
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

  const invokeUris = registerInvocationCommands(program, { router: locus.router, ui, withApi })
  program.argument('[uri...]').action(async (uris: string[] = []) => {
    if (uris.length === 0) {
      program.outputHelp()
      return
    }
    for (const uri of uris) {
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) {
        program.error(`未知命令：${uri}`, { exitCode: 1 })
      }
    }
    await invokeUris('GET', uris, program)
  })

  const version = program.command('version').description('读取 Locus 产品版本')
  version.action(() => {
    emit(version, locus.info, locus.info.version)
  })

  registerHelpCommand(program, locus.router)
  registerSecurityCommands(program, { call, ui, router: locus.router })
  registerShellCommand(program, { call, router: locus.router })
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
      debug: options.debug === true,
    })
    try {
      return await action(api)
    } finally {
      api.dispose()
    }
  }
}
