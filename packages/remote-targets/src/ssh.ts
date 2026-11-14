import { execa } from 'execa'
import { resolve, sep } from 'node:path'
import {
  RemoteTargetsFailure,
  type CommandRunner,
  type RemoteTarget,
  type RunOptions,
} from './types.ts'

export interface SshInvocation {
  readonly command: string
  readonly args: readonly string[]
}

/** 把相对凭据路径限制在目标根目录内，阻止 ../ 或绝对路径逃逸。 */
export function resolveUnderRoot(root: string, relative: string): string {
  const base = resolve(root)
  const candidate = resolve(base, relative)
  if (candidate !== base && !candidate.startsWith(base + sep)) {
    throw new RemoteTargetsFailure('invalid-spec', `路径超出目标根目录：${relative}`)
  }
  return candidate
}

export function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** cmd.exe 只做最小转义：包含空白或元字符时整体加双引号。 */
export function quoteCmd(value: string): string {
  if (value.length === 0) return '""'
  if (!/[\s"&|<>^()]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

export function joinRemoteCommand(command: readonly string[], shell: 'posix' | 'cmd'): string {
  return command.map((value) => (shell === 'posix' ? quotePosix(value) : quoteCmd(value))).join(' ')
}

/** 构造传输客户端调用；密钥走 OpenSSH，密码走 Plink 并强制主机指纹。 */
export function buildSshInvocation(
  target: RemoteTarget,
  root: string,
  command: readonly string[],
): SshInvocation {
  const { connectivity, identity } = target
  const credentialRoot = identity.auth.root ?? root
  const remoteCommand = command.length === 0
    ? undefined
    : joinRemoteCommand(command, connectivity.remoteShell)

  if (identity.auth.method === 'password') {
    const fingerprint = connectivity.trust?.fingerprint
    if (fingerprint === undefined) {
      throw new RemoteTargetsFailure(
        'invalid-spec',
        'password 认证必须提供 connectivity.trust.fingerprint（Plink 主机密钥）',
      )
    }
    const args = [
      '-ssh',
      '-batch',
      '-P',
      String(connectivity.port),
      '-l',
      identity.login,
      '-pwfile',
      resolveUnderRoot(credentialRoot, identity.auth.path),
      '-hostkey',
      fingerprint,
      connectivity.host,
    ]
    if (remoteCommand !== undefined) args.push(remoteCommand)
    return { command: connectivity.client ?? 'plink', args }
  }

  const knownHosts = resolveUnderRoot(
    credentialRoot,
    connectivity.trust?.knownHosts ?? `credentials/${target.id}/known_hosts`,
  )
  const strict = connectivity.trust?.knownHosts === undefined ? 'accept-new' : 'yes'
  const args = [
    '-p',
    String(connectivity.port),
    '-l',
    identity.login,
    '-i',
    resolveUnderRoot(credentialRoot, identity.auth.path),
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'BatchMode=yes',
    '-o',
    `UserKnownHostsFile=${knownHosts}`,
    '-o',
    `StrictHostKeyChecking=${strict}`,
    connectivity.host,
  ]
  if (remoteCommand !== undefined) args.push(remoteCommand)
  return { command: connectivity.client ?? 'ssh', args }
}

/** 真实子进程执行器；测试通过服务注入假实现。 */
export function createProcessRunner(): CommandRunner {
  return {
    async run(command, args, options) {
      try {
        const result = await execa(command, [...args], {
          reject: false,
          stdin: 'ignore',
          stripFinalNewline: false,
          windowsHide: true,
          ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
        })
        const stderr = result.stderr ?? ''
        return {
          exitCode: result.exitCode ?? (result.timedOut ? 124 : 1),
          stdout: result.stdout ?? '',
          stderr: result.timedOut
            ? `${stderr}${stderr.length === 0 ? '' : '\n'}命令超时`
            : stderr,
        }
      } catch (error) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
        }
      }
    },
    async interactive(command, args, options: RunOptions | undefined) {
      try {
        const result = await execa(command, [...args], {
          stdio: 'inherit',
          reject: false,
          windowsHide: true,
          ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
        })
        return result.exitCode ?? 1
      } catch {
        return 1
      }
    },
  }
}
