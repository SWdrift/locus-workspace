import type { Command } from 'commander'
import type { ApiRouter } from '@locus/core/invocation'
import { readNewRootPassword, RESET_WARNING } from '../host/terminal.ts'
import type { CliSecurityUI } from '../host/terminal.ts'
import { i18n } from '../i18n.ts'
import { emit } from '../output/output.ts'
import type { CallOperation } from './shared.ts'

interface SecurityCommandsContext {
  readonly call: CallOperation
  readonly ui: CliSecurityUI
  readonly router: ApiRouter
}

export function registerSecurityCommands(program: Command, { call, ui, router }: SecurityCommandsContext): void {
  const init = program.command('init').description(i18n.t('command.init.description'))
  init.action(async () => {
    const { password, confirmation } = await readNewRootPassword(ui)
    await call('POST', router.build('locus.security.initialize', {}), undefined, { password, confirmation })
    emit(init, { initialized: true }, i18n.t('init.success'))
  })

  const security = program.command('security').description(i18n.t('command.security.description'))
  const reset = security.command('reset-root').description(i18n.t('command.reset-root.description'))
  reset.action(async () => {
    if (!(await ui.confirmLocalTakeover(RESET_WARNING))) {
      reset.error(i18n.t('reset.cancelled'), { exitCode: 2 })
    }
    const { password, confirmation } = await readNewRootPassword(ui)
    await call('POST', router.build('locus.security.reset-root', {}), undefined, {
      password,
      confirmation,
      confirm: 'RESET ROOT',
    })
    emit(reset, { reset: true }, i18n.t('reset.success'))
  })
}
