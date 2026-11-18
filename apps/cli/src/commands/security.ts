import type { Command } from 'commander'
import { readNewRootPassword, RESET_WARNING } from '../host/terminal.ts'
import type { CliSecurityUI } from '../host/terminal.ts'
import { emit } from '../output/output.ts'
import { pathParam } from './shared.ts'
import type { CallOperation } from './shared.ts'

interface SecurityCommandsContext {
  readonly call: CallOperation
  readonly ui: CliSecurityUI
}

export function registerSecurityCommands(program: Command, { call, ui }: SecurityCommandsContext): void {
  const init = program.command('init').description('通过可信 TTY 隐藏输入初始化 Root；不读取参数或环境中的密码')
  init.action(async () => {
    const { password, confirmation } = await readNewRootPassword(ui)
    await call('POST', 'locus://security/actions/init', undefined, { password, confirmation })
    emit(init, { initialized: true }, 'Root 与默认 User 已初始化。')
  })

  const security = program.command('security').description('Root 身份、认证状态与本机管理')
  const status = security.command('status').description('读取安全元数据；不认证、不访问凭据保管器')
  status.action(async () => {
    const result = (await call('GET', 'locus://security')) as { initialized: boolean; profile: string }
    emit(status, result, `Root：${result.initialized ? '已初始化' : '未初始化'}\nProfile：${result.profile}`)
  })
  const reset = security
    .command('reset-root')
    .description('本机管理接管：TTY 明确确认后替换 Root 密码，撤销旧授权；没有 --yes 绕过')
  reset.action(async () => {
    if (!(await ui.confirmLocalTakeover(RESET_WARNING))) {
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
  const change = security
    .command('change-root-password')
    .description('隐藏输入新密码，使用旧 Root 密码为本次变更单独授权')
  change.action(async () => {
    const { password, confirmation } = await readNewRootPassword(ui)
    await call('POST', 'locus://security/actions/change-root-password', undefined, { password, confirmation })
    emit(change, { changed: true }, 'Root 密码已变更，旧授权已撤销。')
  })
  const provider = security.command('provider').description('查询 Provider 装配与后端声明')
  provider.action(async () => {
    const result = (await call('GET', 'locus://security/provider')) as { id: string; backend: string; state: string }
    emit(provider, result, `Provider：${result.id}\n后端：${result.backend}\n状态：${result.state}`)
  })

  const operation = security.command('operation').description('operation 级认证等级与 Root 覆盖')
  const list = operation.command('list').description('列出组件 operation、声明等级、覆盖与最终来源')
  list.action(async () => {
    const result = (await call('GET', 'locus://security/operations')) as Array<{
      componentId: string
      operation: string
      effectiveAuthLevel: string
      defaultAuthLevel: string
      source: string
    }>
    emit(
      list,
      result,
      result
        .map(
          item =>
            `${item.componentId}:${item.operation}  ${item.effectiveAuthLevel}  default=${item.defaultAuthLevel}  source=${item.source}`,
        )
        .join('\n') || '没有可配置 operation。',
    )
  })
  const set = operation
    .command('set <operation> <level>')
    .description('Root 覆盖 operation 的认证等级；operation 形如 postgres:pg.database.register')
  set.action(async (reference: string, level: string) => {
    const parsed = parseQualifiedOperation(reference, set)
    if (level !== 'user' && level !== 'root') {
      set.error('level 必须是 user 或 root', { exitCode: 1 })
      return
    }
    const result = (await call(
      'PUT',
      `locus://security/operations/${pathParam(parsed.component)}/${pathParam(parsed.operation)}`,
      { level },
    )) as { effectiveAuthLevel: string; source: string }
    emit(set, result, `已设置 ${reference} 为 ${result.effectiveAuthLevel}（source=${result.source}）。`)
  })
  const resetOperation = operation.command('reset <operation>').description('Root 清除 operation 覆盖')
  resetOperation.action(async (reference: string) => {
    const parsed = parseQualifiedOperation(reference, resetOperation)
    const result = (await call(
      'DELETE',
      `locus://security/operations/${pathParam(parsed.component)}/${pathParam(parsed.operation)}`,
    )) as { effectiveAuthLevel: string; source: string }
    emit(resetOperation, result, `已恢复 ${reference} 为 ${result.effectiveAuthLevel}（source=${result.source}）。`)
  })
}

function parseQualifiedOperation(value: string, command: Command): { component: string; operation: string } {
  const index = value.indexOf(':')
  if (index <= 0 || index === value.length - 1 || value.indexOf(':', index + 1) !== -1) {
    command.error('operation 必须是 component:operation', { exitCode: 1 })
  }
  return { component: value.slice(0, index), operation: value.slice(index + 1) }
}
