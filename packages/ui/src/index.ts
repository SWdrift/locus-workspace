import type { Context } from '@deepseek-ai/cordis'
import { createWorkspaceApplication } from '@locus/application'
import type { FilesystemService, LocusService } from '@locus/contracts'
import { createLocusUiServer } from './server.ts'

/** 稳定的 Cordis 插件名。 */
export const name = 'locus-ui'

/** 只要求 Core；Filesystem 按请求读取，插件缺省时 Workspace 仍可浏览。 */
export const inject = ['locus']

/** 本地 UI 传输适配器；不启动第二个业务运行时，也不自动监听。 */
export function apply(ctx: Context): void {
  const server = createLocusUiServer(() => createWorkspaceApplication({
    locus: ctx.get('locus') as LocusService,
    ...(ctx.get('locusFilesystem') === undefined
      ? {}
      : { filesystem: ctx.get('locusFilesystem') as FilesystemService }),
  }))
  ctx.provide('locusUi', server)
  ctx.effect(() => () => server.stop())
}
