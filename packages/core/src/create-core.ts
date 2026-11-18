import { createLazyComponentService } from './components/lazy.ts'
import { ComponentFailure } from './components/errors.ts'
import type { ComponentRunner, DefinedComponent } from './components/types.ts'
import { resolveDataDirectory } from './data-directory.ts'
import { createCoreEventStore } from './events/sqlite-store.ts'
import { createEventBus } from './events/bus.ts'
import { createApiRouter } from './invocation/router.ts'
import { createLocusComponent } from './operations.ts'
import { createWorkspaceStore } from './workspaces/service.ts'
import { createSecurityRuntime } from './security/runtime.ts'
import { createSqliteSecurityStore } from './security/stores/sqlite.ts'
import { createKeyringCredentialProvider } from './security/providers/keyring.ts'
import type { SecurityHost, SecurityOptions } from './security/types.ts'
import { LOCUS_VERSION } from './version.generated.ts'
import type { LocusCore, LocusInfo } from './types.ts'

export interface CreateLocusCoreOptions {
  readonly dataDirectory?: string
  /** 由包定义、经 `defineComponent()` 校验的组件；首次访问组件服务时物化。 */
  readonly components?: readonly DefinedComponent[]
  /** 组件探针与部署命令执行器；测试注入假实现。 */
  readonly componentRunner?: ComponentRunner
  /** 默认使用惰性 SQLite Store；Provider 由组合根显式注入，构造不执行 IO。 */
  readonly security?: SecurityOptions
}

/** 创建 Locus core；首次需要持久化数据时才打开自有数据库。 */
export function createLocusCore(options?: CreateLocusCoreOptions): LocusCore {
  const dataDirectory = resolveDataDirectory(options?.dataDirectory, options?.security?.profile)
  const info: LocusInfo = Object.freeze({ version: LOCUS_VERSION })
  const definitions = options?.components ?? []
  for (const definition of definitions) {
    if (definition.component.id === 'locus') {
      throw new ComponentFailure('invalid-definition', 'locus 是 Core 自有领域，不能作为包组件注册')
    }
  }
  const store = createWorkspaceStore(dataDirectory)
  const components = createLazyComponentService({
    dataDirectory,
    ...(definitions.length === 0 ? {} : { definitions: definitions.map(definition => definition.component) }),
    ...(options?.componentRunner === undefined ? {} : { runner: options.componentRunner }),
  })
  const eventStore = createCoreEventStore(dataDirectory)
  const events = createEventBus(eventStore)
  let host: SecurityHost | undefined
  let router: LocusCore['router'] | undefined
  const locus = createLocusComponent({
    info,
    workspaces: store.workspaces,
    mounts: store.mounts,
    components: () => components.service,
    security: () => security.service,
    host: () => {
      if (host === undefined) throw new Error('Security Host 尚未装配')
      return host
    },
    events,
    operations: () => {
      if (router === undefined) throw new Error('ApiRouter 尚未装配')
      return router.operations
    },
  })
  const security = createSecurityRuntime(
    {
      ...options?.security,
      store: options?.security?.store ?? createSqliteSecurityStore(dataDirectory, options?.security?.profile),
      provider: options?.security?.provider ?? createKeyringCredentialProvider(),
    },
    [...definitions.map(definition => definition.component), locus.component],
  )
  host = security.host
  router = createRouter(definitions, locus)
  const api = router

  return {
    get info() {
      store.assertActive()
      return info
    },
    get dataDirectory() {
      store.assertActive()
      return dataDirectory
    },
    get workspaces() {
      store.assertActive()
      return store.workspaces
    },
    get mounts() {
      store.assertActive()
      return store.mounts
    },
    get components() {
      store.assertActive()
      return components.service
    },
    get security() {
      store.assertActive()
      return security.service
    },
    get router() {
      store.assertActive()
      return api
    },
    get events() {
      store.assertActive()
      return events
    },
    async dispose() {
      try {
        store.dispose()
      } finally {
        try {
          components.dispose()
        } finally {
          try {
            await security.dispose()
          } finally {
            try {
              events.dispose()
            } finally {
              eventStore.dispose?.()
            }
          }
        }
      }
    },
  }
}

/** 组合根显式注册全部组件 operation；注册冲突在启动时失败。 */
function createRouter(definitions: readonly DefinedComponent[], locus: DefinedComponent): LocusCore['router'] {
  const router = createApiRouter()
  for (const definition of [...definitions, locus]) {
    for (const operation of definition.operations) {
      router.register(definition.component.id, operation)
    }
  }
  return router
}
