import { hostname } from 'node:os'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { FilesystemService, LocusService } from '@locus/contracts'
import { LocationStore } from './locations.ts'
import { FilesystemObserver } from './observations.ts'

/** 稳定的 Cordis 插件名。 */
export const name = 'locus-filesystem'

/** Filesystem 只依赖公开的 Locus 用例，不要求 Core 装配领域插件。 */
export const inject = ['locus']

/** 创建独立可调用的 Filesystem 用例，首次访问配置时才打开自身数据库。 */
export function createFilesystemService(locus: LocusService): FilesystemService & { dispose(): Promise<void> } {
  const localHostname = hostname()
  const store = new LocationStore(locus.dataDirectory)
  const observer = new FilesystemObserver(localHostname)
  const pending = new Set<Promise<unknown>>()
  let disposed = false
  let disposal: Promise<void> | undefined

  function assertActive(): void {
    if (disposed) throw new Error('Filesystem 服务已释放')
  }

  async function run<T>(action: () => Promise<T>): Promise<T> {
    assertActive()
    const operation = action()
    pending.add(operation)
    try {
      return await operation
    } finally {
      pending.delete(operation)
    }
  }

  return {
    register(workspaceId, path) {
      assertActive()
      locus.workspaces.get(workspaceId)
      if (path.length === 0 || path.includes('\0')) throw new Error('登记路径不能为空或包含空字符')
      return store.register(workspaceId, resolve(path), localHostname)
    },
    locations(workspaceId) {
      assertActive()
      locus.workspaces.get(workspaceId)
      return store.list(workspaceId)
    },
    unregister(workspaceId, locationId) {
      assertActive()
      locus.workspaces.get(workspaceId)
      store.remove(workspaceId, locationId)
    },
    inspect(workspaceId, locationId, relativePath) {
      return run(async () => {
        locus.workspaces.get(workspaceId)
        return observer.inspect(store.get(workspaceId, locationId), relativePath)
      })
    },
    discover(workspaceId, locationId, relativePath, limit) {
      return run(async () => {
        locus.workspaces.get(workspaceId)
        return observer.discover(store.get(workspaceId, locationId), relativePath, limit)
      })
    },
    read(workspaceId, locationId, relativePath, maxBytes) {
      return run(async () => {
        locus.workspaces.get(workspaceId)
        return observer.read(store.get(workspaceId, locationId), relativePath, maxBytes)
      })
    },
    dispose() {
      if (!disposal) {
        disposed = true
        disposal = (async () => {
          await Promise.allSettled(pending)
          store.close()
        })()
      }
      return disposal
    },
  }
}

/** 将领域用例提供给当前 fiber，卸载时只释放句柄，不删除登记或原生文件。 */
export function apply(ctx: Context): void {
  const service = createFilesystemService(ctx.get('locus') as LocusService)
  ctx.provide('locusFilesystem', service)
  ctx.effect(() => () => service.dispose())
}
