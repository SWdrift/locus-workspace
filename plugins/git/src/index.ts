import { execFile, type ExecFileException } from 'node:child_process'
import { hostname } from 'node:os'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { CapabilityDescriptor, FilesystemService, GitObservation, GitService, LocusService } from '@locus/contracts'

/** 稳定的 Cordis 插件名。 */
export const name = 'locus-git'

/** Git 直接消费 Filesystem 的局部协议，不另建位置或成员模型。 */
export const inject = ['locus', 'locusFilesystem']

/** 提供方声明不代表 Git 已安装或仓库当前可达。 */
export const capability: CapabilityDescriptor = Object.freeze({
  id: 'locus.git',
  provider: '@locus/git',
  tags: Object.freeze(['development']),
})

interface GitResult {
  readonly stdout: string
  readonly stderr: string
  readonly error: ExecFileException | null
}

function execute(args: readonly string[]): Promise<GitResult> {
  const { promise, resolve: resolveResult } = Promise.withResolvers<GitResult>()
  execFile('git', ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  }, (error, stdout, stderr) => resolveResult({ stdout, stderr, error }))
  return promise
}

function failure(result: GitResult): { state: 'unavailable' | 'error'; error: string } {
  const error = result.error!
  if (error.code === 'ENOENT') {
    return { state: 'unavailable', error: '当前环境未找到 Git 可执行文件 (ENOENT)' }
  }
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return { state: 'error', error: 'Git 查询输出超过 1 MiB 上限' }
  }
  if (error.killed) return { state: 'error', error: 'Git 查询超过 10 秒时限，已终止' }
  // 原生 stderr 可能含配置中的凭据；诊断只保留故障类别，不回显原始输出。
  if (result.stderr.includes('dubious ownership')) {
    return { state: 'error', error: 'Git 拒绝访问仓库：dubious ownership' }
  }
  if (/permission denied|access is denied/i.test(result.stderr)) {
    return { state: 'error', error: 'Git 拒绝访问仓库：原生权限不足' }
  }
  return { state: 'error', error: `Git 查询失败 (${error.code ?? error.signal ?? 'UNKNOWN'})` }
}

function notRepository(result: GitResult): boolean {
  return result.error?.code === 128 &&
    /^fatal: not a git repository \(or any (?:of the parent directories|parent up to mount point [^\r\n]+)\)/.test(result.stderr)
}

function redactRemote(url: string): string {
  // 不猜测秘密参数名，默认移除 URL userinfo 并隐藏全部 query/hash。
  return url
    .replace(/^([a-z][a-z\d+.-]*:\/\/)[^/?#]*@/i, '$1')
    .replace(/([?#])[\s\S]*$/, '$1[REDACTED]')
}

function remoteUrls(output: string): { name: string; url: string }[] {
  const remotes: { name: string; url: string }[] = []
  let start = 0
  while (start < output.length) {
    const end = output.indexOf('\0', start)
    const separator = output.indexOf('\n', start)
    remotes.push({
      name: output.slice(start + 'remote.'.length, separator - '.url'.length),
      url: redactRemote(output.slice(separator + 1, end)),
    })
    start = end + 1
  }
  return remotes
}

/** 创建不持久化观察的 Git 用例；已接收的操作随 dispose 完成后再释放。 */
export function createGitService(
  locus: LocusService,
  filesystem: FilesystemService,
): GitService & { dispose(): Promise<void> } {
  const localHostname = hostname()
  const pending = new Set<Promise<unknown>>()
  let disposed = false
  let disposal: Promise<void> | undefined

  async function run<T>(action: () => Promise<T>): Promise<T> {
    if (disposed) throw new Error('Git 服务已释放')
    const operation = action()
    pending.add(operation)
    try {
      return await operation
    } finally {
      pending.delete(operation)
    }
  }

  return {
    capability,
    availability() {
      return run(async () => {
        const result = await execute(['--version'])
        return result.error ? { available: false, error: failure(result).error } : { available: true }
      })
    },
    inspect(workspaceId, locationId, relativePath) {
      return run(async () => {
        const workspace = locus.workspaces.get(workspaceId)
        if (!workspace.capabilities.some(value => value.id === capability.id && value.provider === capability.provider)) {
          throw new Error(`Workspace ${workspace.name} (${workspaceId}) 尚未启用能力 ${capability.id}；请先为该 Workspace 配置提供方 ${capability.provider}。`)
        }
        // 未配置或无效位置等用例前置条件由 Filesystem 原样拒绝，不合成观察。
        const source = await filesystem.inspect(workspaceId, locationId, relativePath)
        const observed = (result: Omit<GitObservation, 'workspaceId' | 'locationId' | 'filesystem' | 'observedAt'>): GitObservation => ({
          workspaceId,
          locationId,
          filesystem: source,
          observedAt: new Date().toISOString(),
          ...result,
        })
        if (source.state !== 'accessible') {
          return observed({ state: 'unavailable', error: source.error ?? `Filesystem 位置当前为 ${source.state}` })
        }
        if (source.kind !== 'file' && source.kind !== 'directory') {
          return observed({ state: 'unavailable', error: 'Git 只观察普通文件或目录，不跟随符号链接或其他文件类型' })
        }
        const directory = source.kind === 'file' ? dirname(source.path) : source.path
        const rootResult = await execute(['-C', directory, 'rev-parse', '--show-toplevel'])
        if (rootResult.error) {
          return observed(notRepository(rootResult) ? { state: 'not-repository' } : failure(rootResult))
        }
        const root = resolve(rootResult.stdout.replace(/\r?\n$/, ''))
        const [status, configuration] = await Promise.all([
          execute(['-C', root, 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal', '--no-renames', '--no-ahead-behind']),
          execute(['-C', root, 'config', '--null', '--get-regexp', '^remote\\..*\\.url$']),
        ])
        if (status.error) return observed(failure(status))
        // git config 的退出码 1 明确表示没有匹配的 Remote URL，不是查询故障。
        if (configuration.error && configuration.error.code !== 1) return observed(failure(configuration))
        const oid = /(?:^|\0)# branch\.oid ([^\0]*)\0/.exec(status.stdout)?.[1]
        const head = /(?:^|\0)# branch\.head ([^\0]*)\0/.exec(status.stdout)?.[1]
        if (oid === undefined || head === undefined) {
          return observed({ state: 'error', error: 'Git 状态输出缺少分支或提交信息' })
        }
        return observed({
          state: 'repository',
          root,
          reference: { namespace: `locus.git:${localHostname}`, id: pathToFileURL(root).href },
          branch: head === '(detached)' ? null : head,
          commit: oid === '(initial)' ? null : oid,
          dirty: /(?:^|\0)[12u?!] /.test(status.stdout),
          remotes: remoteUrls(configuration.stdout),
        })
      })
    },
    dispose() {
      if (!disposal) {
        disposed = true
        disposal = Promise.allSettled(pending).then(() => {})
      }
      return disposal
    },
  }
}

/** 在当前 DSH fiber 提供领域服务；卸载不会修改原生仓库或 Workspace。 */
export function apply(ctx: Context): void {
  const service = createGitService(ctx.get('locus') as LocusService, ctx.get('locusFilesystem') as FilesystemService)
  ctx.provide('locusGit', service)
  ctx.effect(() => () => service.dispose())
}
