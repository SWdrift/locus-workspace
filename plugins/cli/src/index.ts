import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import type { AppExit, AppReady } from '@deepseek-ai/dsh-cmdline'
import type { FilesystemService, GitService, LocusService } from '@locus/contracts'
import { createCommands } from './commands.ts'

/** 稳定的 Cordis 插件名。 */
export const name = 'locus-cli'

/** 能力服务是可选依赖；未加载时 Workspace 仍可操作。 */
export const inject = ['locus', 'cmdlineArgs', 'appExit', 'appReady']

/** 等整棵 profile 完成启动后再选择可用服务，避免装配顺序决定能力可见性。 */
export function apply(ctx: Context): void {
  const exit = ctx.get('appExit') as AppExit
  const ready = ctx.get('appReady') as AppReady
  let active = true
  ctx.effect(() => {
    const cancel = ready.onReady(() => {
      const commands = createCommands(
        ctx.get('locus') as LocusService,
        ctx.get('locusFilesystem') as FilesystemService | undefined,
        ctx.get('locusGit') as GitService | undefined,
      )
      parseCmdline(ctx, commands.program)
      const result = commands.execute()
      if (!result) return
      void result.then((output) => {
        if (!active) return
        process.stdout.write(commands.json() ? `${JSON.stringify(output.value)}\n` : `${output.text}\n`)
        exit(output.exitCode ?? 0)
      }).catch((error: unknown) => {
        if (!active) return
        process.stderr.write(`Locus 操作失败：${error instanceof Error ? error.message : String(error)}\n`)
        exit(2)
      })
    })
    return () => {
      active = false
      cancel()
    }
  })
}
