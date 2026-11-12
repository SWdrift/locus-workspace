import type { Context } from '@deepseek-ai/cordis'
import type { LocusService } from '@locus/contracts'
import { createLocusCore } from '@locus/core'

/** 稳定的 Cordis 插件名。 */
export const name = 'locus-host'

/**
 * 创建 Locus core，注册为 `locus` 服务，并随本插件的 fiber 释放 core。
 * 服务只暴露公开契约，不暴露 core 对象本身。
 */
export function apply(ctx: Context): void {
  const core = createLocusCore()
  const service: LocusService = {
    info: core.info,
    dataDirectory: core.dataDirectory,
    workspaces: core.workspaces,
  }

  ctx.provide('locus', service)
  ctx.effect(() => () => core.dispose())
}
