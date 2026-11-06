import type { Context } from '@deepseek-ai/cordis'
import type { LocusService } from '@locus/contracts'

/** 稳定的 Cordis 插件名。 */
export const name = 'locus-cli'

/** 命令执行前必须就绪的服务。 */
export const inject = ['locus', 'cmdlineArgs', 'appExit']

/**
 * Locus 命令行。`version` 打印 core 服务提供的版本后退出；
 * 其他调用按用法错误处理。
 */
export function apply(ctx: Context): void {
  const args = ctx.get('cmdlineArgs') as { get(): readonly string[] }
  const exit = ctx.get('appExit') as (code: number) => void
  const [command] = args.get()

  if (command !== 'version') {
    process.stderr.write('usage: dsh --profile locus version\n')
    exit(1)
    return
  }

  const locus = ctx.get('locus') as LocusService
  process.stdout.write(`${locus.info.version}\n`)
  exit(0)
}
