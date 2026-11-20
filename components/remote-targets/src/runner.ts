import { execa } from 'execa'
import { i18n } from './i18n.ts'
import type { CommandRunner, RunOptions, RunResult } from './types.ts'

/** 系统客户端由 execa 执行，不经 shell，不把秘密放入参数或环境。 */
export function createCommandRunner(): CommandRunner {
  async function execute(
    command: string,
    args: readonly string[],
    interactive: boolean,
    options?: RunOptions,
  ): Promise<RunResult> {
    if (options?.signal?.aborted) return { exitCode: 130, stdout: '', stderr: i18n.t('runner.cancelled') }
    const result = await execa(command, [...args], {
      reject: false,
      stripFinalNewline: false,
      windowsHide: true,
      ...(interactive ? { stdio: 'inherit' as const } : { stdin: 'ignore' as const }),
      ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      ...(options?.signal === undefined ? {} : { cancelSignal: options.signal }),
    })
    if (interactive)
      return {
        exitCode: result.isCanceled ? 130 : result.timedOut ? 124 : (result.exitCode ?? 1),
        stdout: '',
        stderr: '',
      }
    const stderr = result.stderr ?? ''
    const spawnFailed = result.exitCode === undefined && result.signal === undefined
    const diagnostic = result.isCanceled
      ? i18n.t('runner.cancelled')
      : result.timedOut
        ? i18n.t('runner.timeout')
        : spawnFailed
          ? i18n.t('runner.spawn-failed')
          : ''
    return {
      exitCode: result.isCanceled ? 130 : result.timedOut ? 124 : (result.exitCode ?? 1),
      stdout: result.stdout ?? '',
      stderr: diagnostic.length === 0 ? stderr : `${stderr}${stderr.length === 0 ? '' : '\n'}${diagnostic}`,
    }
  }
  return {
    run: (command, args, options) => execute(command, args, false, options),
    interactive: async (command, args, options) => (await execute(command, args, true, options)).exitCode,
  }
}
