import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { ComponentRunner } from './components/runner.ts'
import { createComponentService } from './components/service.ts'
import type { ComponentSpec } from './components/spec.ts'
import { createWorkspaceStore } from './workspaces.ts'
import { createSecurityRuntime } from './security/service.ts'
import { createSqliteSecurityStore } from './security/sqlite-store.ts'
import { createKeyringCredentialProvider } from './security/keyring-provider.ts'
import type { SecurityOptions } from './security/types.ts'
import { LOCUS_VERSION } from './version.generated.ts'
import type { LocusCore, LocusInfo } from './types.ts'

export { LOCUS_VERSION } from './version.generated.ts'
export { ComponentFailure, defineComponent, parseComponent } from './components/spec.ts'
export { CapabilityFailure, SecurityFailure } from './security/errors.ts'
export { isCredentialRef, parseCredentialRef } from './security/policy.ts'
export { createMemoryCredentialProvider, createMemorySecurityStore } from './security/provider.ts'
export { createSqliteSecurityStore } from './security/sqlite-store.ts'
export { createKeyringCredentialProvider } from './security/keyring-provider.ts'
export type { AccessDeniedReason, SecurityFailureCode } from './security/errors.ts'
export type {
  CapabilityAuthority,
  CapabilityContext,
  CapabilityLevelRecord,
  ClearCapabilityLevelInput,
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
  SecurityResource,
  SecurityService,
  SecuritySession,
  SecuritySource,
  SecurityStatus,
  SecurityStore,
  SecurityStoreTransaction,
  SetCapabilityLevelInput,
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
  CapabilityAccess,
  CapabilityAuthLevel,
  CapabilityHandler,
  CapabilitySecret,
  ComponentCapability,
  ComponentCapabilityDefinition,
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
  readonly components?: readonly ComponentSpec[]
  /** 组件探针与部署命令执行器；测试注入假实现。 */
  readonly componentRunner?: ComponentRunner
  /** 默认使用惰性 SQLite Store；Provider 由组合根显式注入，构造不执行 IO。 */
  readonly security?: SecurityOptions
}

/** 创建 Locus core；首次需要持久化数据时才打开自有数据库。 */
export function createLocusCore(options?: CreateLocusCoreOptions): LocusCore {
  const dataDirectory = resolveDataDirectory(options?.dataDirectory)
  const info: LocusInfo = Object.freeze({ version: LOCUS_VERSION })
  const store = createWorkspaceStore(dataDirectory)
  const components = createComponentService({
    dataDirectory,
    ...(options?.components === undefined ? {} : { definitions: options.components }),
    ...(options?.componentRunner === undefined ? {} : { runner: options.componentRunner }),
  })
  const security = createSecurityRuntime({
    ...options?.security,
    store: options?.security?.store ?? createSqliteSecurityStore(dataDirectory, options?.security?.profile),
    provider: options?.security?.provider ?? createKeyringCredentialProvider(),
  }, options?.components)

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
      return components
    },
    get security() {
      store.assertActive()
      return security.service
    },
    async dispose() {
      try {
        store.dispose()
      } finally {
        try {
          components.dispose()
        } finally {
          await security.dispose()
        }
      }
    },
  }
}
