import type { Context } from '@deepseek-ai/cordis'
import type { LocusService } from '@locus/contracts'
import { createLocusCore } from '@locus/core'
import { createOperationCatalog } from '@locus/operations'

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
  const operations = createOperationCatalog({
    isCapabilitySelected(workspaceId, capability) {
      try {
        return service.workspaces.get(workspaceId).capabilities.some((entry) =>
          entry.id === capability.id && entry.provider === capability.provider)
      } catch {
        return false
      }
    },
  })

  ctx.provide('locus', service)
  ctx.provide('locusOperations', operations)
  ctx.effect(() => () => {
    operations.dispose()
    return core.dispose()
  })
}
