import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LocusCore, Mount, Workspace } from '@locus/core'

export interface WorkspaceShellOptions {
  readonly shell?: string | undefined
  readonly printEnv?: boolean | undefined
  readonly command?: string | undefined
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
  writeFileSync(
    join(directory, 'locus.cmd'),
    `@echo off\r\n${quoteCmd(node)} ${quoteCmd(cli)} %*\r\n`,
    'utf8',
  )
}

function shellInvocation(
  requested: string | undefined,
  command: string | undefined,
): { shell: string; args: readonly string[] } {
  const shell = requested ?? (
    process.platform === 'win32'
      ? process.env.SHELL ?? 'powershell.exe'
      : process.env.SHELL ?? '/bin/sh'
  )
  const name = basename(shell).toLowerCase().replace(/\.exe$/, '')
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

function createShellContext(
  locus: LocusCore,
  workspace: Workspace,
  options: WorkspaceShellOptions,
): WorkspaceShellContext {
  const mounts = locus.mounts.list(workspace.id)
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
      mounts.map((mount) => ({ id: mount.id, name: mount.name, path: mount.path })),
    )

    const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
    environment[pathKey] = environment[pathKey]
      ? `${binDirectory}${delimiter}${environment[pathKey]}`
      : binDirectory

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

/** 在 Workspace 上下文中启动用户 shell；返回值用于 CLI 退出码。 */
export function runWorkspaceShell(
  locus: LocusCore,
  workspace: Workspace,
  options: WorkspaceShellOptions,
): number {
  const context = createShellContext(locus, workspace, options)
  try {
    if (options.printEnv === true) {
      process.stdout.write(`${JSON.stringify({
        shell: context.shell,
        args: context.args,
        cwd: context.cwd,
        environment: context.environment,
        mounts: context.mounts,
        missing: context.missing,
      })}\n`)
      return 0
    }

    if (options.command === undefined) {
      const lines = [
        `Locus shell：${workspace.name} (${workspace.id})`,
        ...(context.mounts.length
          ? context.mounts.map((mount) => `  挂载 ${mount.name}  ${mount.path}`)
          : ['  没有挂载，使用用户主目录']),
        ...(context.missing.length ? [`  缺失：${context.missing.join(', ')}`] : []),
        'locus 已加入 PATH；exit 退出。',
      ]
      process.stderr.write(`${lines.join('\n')}\n`)
    }

    const result = spawnSync(context.shell, [...context.args], {
      cwd: context.cwd,
      env: context.environment,
      stdio: 'inherit',
    })
    if (result.error) {
      throw new Error(`无法启动 shell ${context.shell}：${result.error.message}`)
    }
    return result.status ?? 1
  } finally {
    context.cleanup()
  }
}
