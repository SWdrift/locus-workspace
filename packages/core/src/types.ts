import type { ComponentsService } from './components/types.ts'
import type { EventBus } from './events/types.ts'
import type { ApiRouter } from './invocation/types.ts'
import type { SecurityService } from './security/types.ts'
import type { MountService, WorkspaceService } from './workspaces/types.ts'

/** Locus 运行时的公开身份信息。 */
export interface LocusInfo {
  /** 面向客户端与诊断的产品版本。 */
  readonly version: string
}

/** 本地 Core 句柄；释放后捕获的服务不可继续调用。 */
export interface LocusCore {
  readonly info: LocusInfo
  /** Core 自有 SQLite 与后续领域数据的根目录。 */
  readonly dataDirectory: string
  readonly workspaces: WorkspaceService
  readonly mounts: MountService
  readonly components: ComponentsService
  readonly security: SecurityService
  readonly router: ApiRouter
  readonly events: EventBus
  dispose(): Promise<void>
}
