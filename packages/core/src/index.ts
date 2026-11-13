import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { createWorkspaceStore } from './workspaces.ts'
import type { LocusCore, LocusInfo } from './types.ts'

export type {
  LocusCore,
  LocusInfo,
  RelationSource,
  ResourceReference,
  Workspace,
  WorkspaceRelation,
  WorkspaceService,
} from './types.ts'

/** Locus 产品版本，也是唯一来源。 */
export const LOCUS_VERSION = '0.0.0'

/** 创建 Locus core；首次调用 Workspace 用例时才打开自有数据库。 */
export function createLocusCore(options?: { dataDirectory?: string }): LocusCore {
  const configuredDirectory =
    options?.dataDirectory !== undefined ? options.dataDirectory : process.env.LOCUS_HOME
  const directorySource = options?.dataDirectory !== undefined ? 'dataDirectory' : 'LOCUS_HOME'
  if (
    configuredDirectory !== undefined &&
    (typeof configuredDirectory !== 'string' ||
      configuredDirectory.trim().length === 0 ||
      !isAbsolute(configuredDirectory))
  ) {
    throw new Error(`${directorySource} 必须是非空绝对路径`)
  }
  const dataDirectory = resolve(configuredDirectory ?? join(homedir(), '.locus-workspace'))
  const info: LocusInfo = Object.freeze({ version: LOCUS_VERSION })
  const store = createWorkspaceStore(dataDirectory)

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
    async dispose() {
      store.dispose()
    },
  }
}
