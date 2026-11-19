import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Mount, Workspace } from '@locus/core/workspaces'
import { i18n } from './i18n.ts'
import { jsonText, processOutput } from './output/output.ts'
import type { OutputStreams } from './output/output.ts'

export interface WorkspaceShellOptions {
  readonly shell?: string | undefined
  readonly printEnv?: boolean | undefined
  readonly command?: string | undefined
  readonly pretty?: boolean | undefined
}

interface WorkspaceShellContext {
  readonly shell: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly environment: Record<string, string>
  readonly mounts: readonly Mount[]
  readonly missing: readonly string[]
  readonly cleanup: () => void
}

/** 只消费已经通过授权路由读取的 Workspace，不再访问 Core 服务。 */
export function runWorkspaceShell(
  workspace: Workspace,
  options: WorkspaceShellOptions,
  output: OutputStreams = processOutput,
): number {
  const context = createShellContext(workspace, options)
  try {
    if (options.printEnv === true) {
      output.writeOut(
        jsonText(
          {
            shell: context.shell,
            args: context.args,
            cwd: context.cwd,
            environment: context.environment,
            mounts: context.mounts,
            missing: context.missing,
          },
          options.pretty === true,
        ),
      )
      return 0
    }

    if (options.command === undefined) {
      const lines = [
        i18n.t('shell.banner', { name: workspace.name, id: workspace.id }),
        ...(context.mounts.length
          ? context.mounts.map(mount => `  ${i18n.t('shell.mount', { name: mount.name, path: mount.path })}`)
          : [`  ${i18n.t('shell.no-mounts')}`]),
        ...(context.missing.length ? [`  ${i18n.t('shell.missing', { paths: context.missing.join(', ') })}`] : []),
        i18n.t('shell.ready'),
      ]
      output.writeErr(`${lines.join('\n')}\n`)
    }

    const result = spawnSync(context.shell, [...context.args], {
      cwd: context.cwd,
      env: context.environment,
      stdio: 'inherit',
    })
    if (result.error) {
      throw new Error(i18n.t('shell.spawn-failed', { shell: context.shell, detail: result.error.message }))
    }
    return result.status ?? 1
  } finally {
    context.cleanup()
  }
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function quoteCmd(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/** 临时 bin 让 shell 内直接使用 locus，不依赖全局安装。 */
function writeLaunchers(directory: string, cli: string): void {
  const node = process.execPath
  const posix = join(directory, 'locus')
  writeFileSync(posix, `#!/bin/sh\nexec ${quotePosix(node)} ${quotePosix(cli)} "$@"\n`, 'utf8')
  if (process.platform !== 'win32') chmodSync(posix, 0o755)
  writeFileSync(join(directory, 'locus.cmd'), `@echo off\r\n${quoteCmd(node)} ${quoteCmd(cli)} %*\r\n`, 'utf8')
}

function shellInvocation(
  requested: string | undefined,
  command: string | undefined,
): { shell: string; args: readonly string[] } {
  const shell =
    requested ??
    (process.platform === 'win32' ? (process.env.SHELL ?? 'powershell.exe') : (process.env.SHELL ?? '/bin/sh'))
  const name = basename(shell)
    .toLowerCase()
    .replace(/\.exe$/, '')
  const powershell = name === 'powershell' || name === 'pwsh'
  const cmd = name === 'cmd'
  if (command !== undefined) {
    if (powershell) return { shell, args: ['-NoProfile', '-Command', command] }
    if (cmd) return { shell, args: ['/D', '/S', '/C', command] }
    return { shell, args: ['-c', command] }
  }
  if (powershell) return { shell, args: ['-NoExit'] }
  if (cmd) return { shell, args: ['/K'] }
  return { shell, args: ['-i'] }
}

function createShellContext(workspace: Workspace, options: WorkspaceShellOptions): WorkspaceShellContext {
  const mounts = workspace.mounts
  let primary: Mount | undefined
  const missing: string[] = []
  for (const mount of mounts) {
    try {
      if (statSync(mount.path).isDirectory()) {
        primary ??= mount
      } else {
        missing.push(mount.path)
      }
    } catch {
      missing.push(mount.path)
    }
  }
  const cwd = primary?.path ?? homedir()
  const tempRoot = mkdtempSync(join(tmpdir(), 'locus-shell-'))
  try {
    const binDirectory = join(tempRoot, 'bin')
    mkdirSync(binDirectory)
    const cli = fileURLToPath(new URL('./index.js', import.meta.url))
    writeLaunchers(binDirectory, cli)

    const environment = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    )
    environment.LOCUS_CLI = cli
    environment.LOCUS_WORKSPACE_ID = workspace.id
    environment.LOCUS_WORKSPACE_NAME = workspace.name
    environment.LOCUS_WORKSPACE_ROOT = cwd
    environment.LOCUS_MOUNTS = JSON.stringify(
      mounts.map(mount => ({ id: mount.id, name: mount.name, path: mount.path })),
    )

    const pathKey = Object.keys(environment).find(key => key.toLowerCase() === 'path') ?? 'PATH'
    environment[pathKey] = environment[pathKey] ? `${binDirectory}${delimiter}${environment[pathKey]}` : binDirectory

    const used = new Set<string>()
    for (const mount of mounts) {
      const base = `LOCUS_MOUNT_${mount.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
      let key = base
      let suffix = 2
      while (used.has(key) || environment[key] !== undefined) {
        key = `${base}_${suffix++}`
      }
      used.add(key)
      environment[key] = mount.path
    }

    const invocation = shellInvocation(options.shell, options.command)
    return {
      shell: invocation.shell,
      args: invocation.args,
      cwd,
      environment,
      mounts,
      missing,
      cleanup: () => rmSync(tempRoot, { recursive: true, force: true }),
    }
  } catch (error) {
    rmSync(tempRoot, { recursive: true, force: true })
    throw error
  }
}
