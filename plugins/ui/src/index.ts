import type { Context } from '@deepseek-ai/cordis'
import type {
  ConnectivityService,
  FilesystemService,
  GitService,
  GiteaService,
  LocusService,
  OperationCatalogService,
  RemoteMachineService,
  SessionService,
} from '@locus/contracts'
import { createLocusUiServer, type LocusUiServer } from './server.ts'

/** 稳定的 Cordis 插件名。 */
export const name = 'locus-ui'

/** 只要求 Core 与 Catalog；领域服务按请求读取，插件缺省时 Overview 仍可展示。 */
export const inject = ['locus', 'locusOperations']

export interface LocusUiService extends LocusUiServer {}

/** 本地 UI 传输适配器；不启动第二个业务运行时，也不自动监听。 */
export function apply(ctx: Context): void {
  const server = createLocusUiServer(() => {
    const filesystem = ctx.get('locusFilesystem') as FilesystemService | undefined
    const git = ctx.get('locusGit') as GitService | undefined
    const session = ctx.get('locusSession') as SessionService | undefined
    const remoteMachine = ctx.get('locusRemoteMachine') as RemoteMachineService | undefined
    const connectivity = ctx.get('locusConnectivity') as ConnectivityService | undefined
    const gitea = ctx.get('locusGitea') as GiteaService | undefined
    return {
      locus: ctx.get('locus') as LocusService,
      operations: ctx.get('locusOperations') as OperationCatalogService,
      ...(filesystem === undefined ? {} : { filesystem }),
      ...(git === undefined ? {} : { git }),
      ...(session === undefined ? {} : { session }),
      ...(remoteMachine === undefined ? {} : { remoteMachine }),
      ...(connectivity === undefined ? {} : { connectivity }),
      ...(gitea === undefined ? {} : { gitea }),
    }
  })
  ctx.provide('locusUi', server)
  ctx.effect(() => () => server.stop())
}
