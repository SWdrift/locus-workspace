import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import type { AppExit, AppReady } from '@deepseek-ai/dsh-cmdline'
import type { FilesystemService, GitService, LocusService, SessionService } from '@locus/contracts'
import { createCommands } from './commands.ts'
import { runShell } from './shell.ts'

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
        ctx.get('locusSession') as SessionService | undefined,
      )
      parseCmdline(ctx, commands.program)
      if (commands.shell()) {
        const create = () => {
          const locus = ctx.get('locus') as LocusService
          const filesystem = ctx.get('locusFilesystem') as FilesystemService | undefined
          const git = ctx.get('locusGit') as GitService | undefined
          const session = ctx.get('locusSession') as SessionService | undefined
          return {
            commands: createCommands(locus, filesystem, git, session),
            current: () => ctx.get('locus') === locus
              && ctx.get('locusFilesystem') === filesystem
              && ctx.get('locusGit') === git
              && ctx.get('locusSession') === session,
          }
        }
        void runShell(create, exit, (dispose) => {
          ctx.effect(() => dispose)
        }).catch((error: unknown) => {
          process.stderr.write(`Locus shell 启动失败：${error instanceof Error ? error.message : String(error)}\n`)
          exit(2)
        })
        return
      }
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
