import type { Command } from 'commander'
import type { ApiRouter } from '@locus/core/invocation'
import { readNewRootPassword, RESET_WARNING } from '../host/terminal.ts'
import type { CliSecurityUI } from '../host/terminal.ts'
import { emit } from '../output/output.ts'
import type { CallOperation } from './shared.ts'

interface SecurityCommandsContext {
  readonly call: CallOperation
  readonly ui: CliSecurityUI
  readonly router: ApiRouter
}

export function registerSecurityCommands(program: Command, { call, ui, router }: SecurityCommandsContext): void {
  const init = program.command('init').description('通过可信 TTY 隐藏输入初始化 Root；不读取参数或环境中的密码')
  init.action(async () => {
    const { password, confirmation } = await readNewRootPassword(ui)
    await call('POST', router.build('locus.security.initialize', {}), undefined, { password, confirmation })
    emit(init, { initialized: true }, 'Root 与默认 User 已初始化。')
  })

  const security = program.command('security').description('本机 Root 管理接管')
  const reset = security
    .command('reset-root')
    .description('本机管理接管：TTY 明确确认后替换 Root 密码，撤销旧授权；没有 --yes 绕过')
  reset.action(async () => {
    if (!(await ui.confirmLocalTakeover(RESET_WARNING))) {
      reset.error('已取消本机管理接管', { exitCode: 2 })
    }
    const { password, confirmation } = await readNewRootPassword(ui)
    await call('POST', router.build('locus.security.reset-root', {}), undefined, {
      password,
      confirmation,
      confirm: 'RESET ROOT',
    })
    emit(reset, { reset: true }, 'Root 已重置，旧授权已撤销；Workspace 与资源凭据未删除。')
  })
}
