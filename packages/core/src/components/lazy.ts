import { createRequire } from 'node:module'
import type { ComponentServiceOptions, ComponentsService } from './service.ts'

type ServiceModule = {
  readonly createComponentService: (options: ComponentServiceOptions) => ComponentsService
}

/**
 * 组件子系统只在访问 `locus.components` 时加载；Workspace 与安全命令不承担
 * 组件定义、探针执行器与 YAML 的模块解析成本。同步加载保持 Core 公开属性契约。
 */
export function createLazyComponentService(options: ComponentServiceOptions): {
  readonly service: ComponentsService
  dispose(): void
} {
  let service: ComponentsService | undefined
  return {
    get service() {
      if (service === undefined) {
        const require = createRequire(import.meta.url)
        const module = require('./service.js') as ServiceModule
        service = module.createComponentService(options)
      }
      return service
    },
    dispose() {
      service?.dispose()
    },
  }
}
