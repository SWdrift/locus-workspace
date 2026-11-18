import { createCommandRunner } from './runner.ts'
import { resolve, sep } from 'node:path'
import { RemoteTargetsFailure } from './types.ts'
import type { CommandRunner, RemoteTarget } from './types.ts'

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
  return command.map(value => (shell === 'posix' ? quotePosix(value) : quoteCmd(value))).join(' ')
}

/** 构造传输客户端调用；密钥走 OpenSSH，密码走 Plink 并强制主机指纹。 */
export function buildSshInvocation(
  target: RemoteTarget,
  root: string,
  command: readonly string[],
  credentialPath: string,
): SshInvocation {
  const { connectivity, identity } = target
  const remoteCommand = command.length === 0 ? undefined : joinRemoteCommand(command, connectivity.remoteShell)

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
      credentialPath,
      '-hostkey',
      fingerprint,
      connectivity.host,
    ]
    if (remoteCommand !== undefined) args.push(remoteCommand)
    return { command: connectivity.client ?? 'plink', args }
  }

  const knownHosts = resolveUnderRoot(root, connectivity.trust?.knownHosts ?? `trust/${target.id}/known_hosts`)
  const strict = connectivity.trust?.knownHosts === undefined ? 'accept-new' : 'yes'
  const args = [
    '-p',
    String(connectivity.port),
    '-l',
    identity.login,
    '-i',
    credentialPath,
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'IdentityAgent=none',
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
  return createCommandRunner()
}
