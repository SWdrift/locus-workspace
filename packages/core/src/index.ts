import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { createLazyComponentService } from './components/lazy.ts'
import type { ComponentRunner } from './components/runner.ts'
import type { ComponentSpec, DefinedComponent } from './components/spec.ts'
import { createCoreEventStore } from './events.ts'
import { createApiRouter, createEventBus } from './invocation.ts'
import { createLocusComponent } from './resources.ts'
import { createWorkspaceStore } from './workspaces.ts'
import { createSecurityRuntime } from './security/service.ts'
import { createSqliteSecurityStore } from './security/sqlite-store.ts'
import { createKeyringCredentialProvider } from './security/keyring-provider.ts'
import type { SecurityHost, SecurityOptions } from './security/types.ts'
import { LOCUS_VERSION } from './version.generated.ts'
import type { LocusCore, LocusInfo } from './types.ts'

export { LOCUS_VERSION } from './version.generated.ts'
export {
  createApiRouter, createDispatcher, createEventBus, defineCredential, defineOperation,
  InvocationFailure, LOCUS_METHODS, parseLocusUri,
} from './invocation.ts'
export type {
  ApiRouter, ComponentStateView, CredentialDefinition, Dispatcher, EventBus, EventFilter, EventListener, EventStore,
  InputField, InvocationErrorCode, InvocationFailureResult, InvocationRequest, InvocationResult,
  InvocationSuccess, InvocationUrl, LocusEvent, LocusMethod, OperationContext, OperationDefinition,
  OperationMetadata, OperationSchema,
} from './invocation.ts'
export { createCoreEventStore } from './events.ts'
export { CORE_SCHEMA_VERSION } from './database.ts'
export { ComponentFailure, defineComponent } from './components/spec.ts'
export { DomainFailure, SecurityFailure } from './security/errors.ts'
export { isCredentialRef, parseCredentialRef } from './security/policy.ts'
export { createMemoryCredentialProvider, createMemorySecurityStore } from './security/provider.ts'
export { createSqliteSecurityStore } from './security/sqlite-store.ts'
export { createKeyringCredentialProvider } from './security/keyring-provider.ts'
export type { AccessDeniedReason, SecurityFailureCode } from './security/errors.ts'
export type {
  ClearOperationLevelInput,
  ComponentSecurity,
  CredentialBinding,
  CredentialCleanupResult,
  CredentialMetadata,
  CredentialProvider,
  CredentialProviderKey,
  CredentialProviderStatus,
  CredentialRef,
  CredentialStatus,
  CredentialValues,
  HostSecurity,
  OperationAuthority,
  OperationCredentialPort,
  OperationLevelRecord,
  RootAuthenticationState,
  RootPasswordVerifier,
  SecurityChallenge,
  SecurityGrant,
  SecurityGrantScope,
  SecurityHost,
  SecurityInstallation,
  SecurityLevel,
  SecurityOptions,
  SecurityParameters,
  SecurityRequest,
  SecurityService,
  SecuritySession,
  SecuritySource,
  SecurityStatus,
  SecurityStore,
  SecurityStoreTransaction,
  SetOperationLevelInput,
  UnbindCredentialInput,
} from './security/types.ts'

export type {
  LocusCore,
  LocusInfo,
  Mount,
  MountService,
  RelationSource,
  ResourceReference,
  Workspace,
  WorkspaceRelation,
  WorkspaceService,
} from './types.ts'
export type {
  ComponentConfig,
  ComponentCredential,
  ComponentDefinition,
  ComponentDeploy,
  ComponentFailureCode,
  ComponentInfo,
  ComponentKind,
  ComponentProbe,
  ComponentSpec,
  CredentialField,
  DefinedComponent,
  DeployState,
  ExternalState,
} from './components/spec.ts'
export type {
  ComponentDeployView,
  ComponentExternalView,
  ComponentList,
  ComponentProblem,
  ComponentServiceOptions,
  ComponentView,
  ComponentsService,
} from './components/service.ts'
export type { ComponentCommandResult, ComponentRunner } from './components/runner.ts'

type ParseModule = {
  readonly parseComponent: (
    input: unknown,
    options?: { readonly allowContract?: boolean },
  ) => ComponentSpec
}

let parser: ParseModule | undefined

/** 解析组件定义文本；YAML 解析器只在首次调用时加载，Core 启动不承担其成本。 */
export function parseComponent(
  input: unknown,
  options: { readonly allowContract?: boolean } = {},
): ComponentSpec {
  if (parser === undefined) {
    const require = createRequire(import.meta.url)
    parser = require('./components/parse.js') as ParseModule
  }
  return parser.parseComponent(input, options)
}

/** 数据目录的文件夹名不能为空、不能是路径，也不能逃出基目录。 */
function assertFolderName(value: string): void {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value === '.' ||
    value === '..' ||
    /[\\/:\u0000]/.test(value)
  ) {
    throw new Error('LOCUS_FOLDER_NAME 必须是非空文件夹名')
  }
}

/**
 * 解析数据目录：显式 `dataDirectory` 完整决定位置；否则 `LOCUS_HOME` 为基目录，
 * `LOCUS_FOLDER_NAME` 为其下文件夹；两者都缺省时使用用户主目录下的 `.locus-workspace/`。
 * 相对 `LOCUS_HOME` 按进程 CWD 解析。
 */
function resolveDataDirectory(explicit: string | undefined): string {
  if (explicit !== undefined) {
    if (typeof explicit !== 'string' || explicit.trim().length === 0 || !isAbsolute(explicit)) {
      throw new Error('dataDirectory 必须是非空绝对路径')
    }
    return resolve(explicit)
  }

  const folderName = process.env.LOCUS_FOLDER_NAME
  if (folderName !== undefined) {
    assertFolderName(folderName)
  }

  const home = process.env.LOCUS_HOME
  if (home !== undefined && (typeof home !== 'string' || home.trim().length === 0)) {
    throw new Error('LOCUS_HOME 必须是非空路径')
  }

  const base = home === undefined ? homedir() : resolve(home)
  if (folderName !== undefined) {
    return join(base, folderName)
  }
  return home === undefined ? join(base, '.locus-workspace') : base
}

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
  const dataDirectory = resolveDataDirectory(options?.dataDirectory)
  const info: LocusInfo = Object.freeze({ version: LOCUS_VERSION })
  const definitions = options?.components ?? []
  const store = createWorkspaceStore(dataDirectory)
  const components = createLazyComponentService({
    dataDirectory,
    ...(definitions.length === 0 ? {} : { definitions: definitions.map((definition) => definition.component) }),
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
  const security = createSecurityRuntime({
    ...options?.security,
    store: options?.security?.store ?? createSqliteSecurityStore(dataDirectory, options?.security?.profile),
    provider: options?.security?.provider ?? createKeyringCredentialProvider(),
  }, [...definitions.map((definition) => definition.component), locus.component])
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
            eventStore.dispose?.()
          }
        }
      }
    },
  }
}

/** 组合根显式注册全部组件 operation；注册冲突在启动时失败。 */
function createRouter(
  definitions: readonly DefinedComponent[],
  locus: DefinedComponent,
): LocusCore['router'] {
  const router = createApiRouter()
  for (const definition of [...definitions, locus]) {
    for (const operation of definition.operations) {
      router.register(definition.component.id, operation)
    }
  }
  return router
}
