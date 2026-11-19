import type { Command } from 'commander'
import type { ApiRouter } from '@locus/core/invocation'
import type { Workspace } from '@locus/core/workspaces'
import { i18n } from '../i18n.ts'
import { outputOptions, writeErr, writeOut } from '../output/output.ts'
import { runWorkspaceShell } from '../shell.ts'
import type { WorkspaceShellOptions } from '../shell.ts'
import type { CallOperation } from './shared.ts'

interface ShellCommandContext {
  readonly call: CallOperation
  readonly router: ApiRouter
}

export function registerShellCommand(program: Command, { call, router }: ShellCommandContext): void {
  const shell = program
    .command('shell <workspace>')
    .description(i18n.t('command.shell.description'))
    .option('--shell <path>', i18n.t('option.shell'))
    .option('--command <command>', i18n.t('option.command'))
    .option('--print-env', i18n.t('option.print-env'))
  shell.action(async (reference: string) => {
    const workspace = (await call('GET', router.build('locus.workspaces.get', { id: reference }))) as Workspace
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
