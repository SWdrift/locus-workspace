import type { Command } from 'commander'
import type { Workspace } from '@locus/core/workspaces'
import { outputOptions, writeErr, writeOut } from '../output/output.ts'
import { runWorkspaceShell } from '../shell.ts'
import type { WorkspaceShellOptions } from '../shell.ts'
import { pathParam } from './shared.ts'
import type { CallOperation } from './shared.ts'

export function registerShellCommand(program: Command, call: CallOperation): void {
  const shell = program
    .command('shell <workspace>')
    .description('在 Workspace 上下文中启动用户 shell；注入 locus、挂载与 LOCUS_* 环境')
    .option('--shell <path>', '指定 shell 可执行文件')
    .option('--command <command>', '执行一条命令后退出，不进入交互模式')
    .option('--print-env', '只输出解析后的 shell 上下文 JSON，不启动 shell')
  shell.action(async (reference: string) => {
    const workspace = (await call('GET', `locus://workspaces/${pathParam(reference)}`)) as Workspace
    const exitCode = runWorkspaceShell(
      workspace,
      {
        ...shell.opts<WorkspaceShellOptions>(),
        pretty: outputOptions(shell).pretty,
      },
      {
        writeOut: text => {
          writeOut(shell, text)
        },
        writeErr: text => {
          writeErr(shell, text)
        },
      },
    )
    if (exitCode !== 0) process.exitCode = exitCode
  })
}
