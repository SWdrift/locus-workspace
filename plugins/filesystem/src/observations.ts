import { constants } from 'node:fs'
import type { Dir, Stats } from 'node:fs'
import { access, lstat, open, opendir } from 'node:fs/promises'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { pathToFileURL } from 'node:url'
import type {
  FilesystemDiscovery,
  FilesystemObservation,
  FilesystemRead,
  ResourceReference,
} from '@locus/contracts'
import type { StoredLocation } from './locations.ts'

interface Target {
  readonly path: string
  readonly reference: ResourceReference
  readonly anchor: string
  readonly parts: readonly string[]
  readonly local: boolean
}

interface Probe {
  readonly observation: FilesystemObservation
  readonly stats?: Stats
}

function errorDetails(error: unknown): { state: FilesystemObservation['state']; message: string } {
  const value = error instanceof Error && 'code' in error ? error.code : undefined
  const code = typeof value === 'string' && /^[A-Z][A-Z0-9_]*$/.test(value) ? value : 'UNKNOWN'
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return { state: 'missing', message: `路径不存在或中间路径不是目录 (${code})` }
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return { state: 'denied', message: `原生文件系统拒绝访问 (${code})` }
  }
  if (['ENODEV', 'ENXIO', 'ENETDOWN', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTCONN', 'ESTALE'].includes(code)) {
    return { state: 'unavailable', message: `设备或连接当前不可用 (${code})` }
  }
  return { state: 'error', message: `原生文件系统操作失败 (${code})` }
}

function nativeError(action: string, error: unknown): Error {
  return new Error(`${action}失败：${errorDetails(error).message}`)
}

function observe(
  target: Target,
  state: FilesystemObservation['state'],
  kind: FilesystemObservation['kind'],
  error?: string,
): FilesystemObservation {
  return {
    path: target.path,
    reference: target.reference,
    state,
    kind,
    observedAt: new Date().toISOString(),
    ...(error === undefined ? {} : { error }),
  }
}

function kindOf(stats: Stats): FilesystemObservation['kind'] {
  if (stats.isSymbolicLink()) return 'symlink'
  if (stats.isFile()) return 'file'
  if (stats.isDirectory()) return 'directory'
  return 'other'
}

function boundedInteger(value: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label}必须是 1 到 ${maximum} 之间的整数`)
  }
  return value
}

/** 所有观察都来自本次原生 I/O，登记范围内的链接只观察而不遍历。 */
export class FilesystemObserver {
  constructor(private readonly hostname: string) {}

  private target(stored: StoredLocation, relativePath: string): Target {
    const location = stored.location
    if (stored.hostname !== this.hostname) {
      return { path: location.path, reference: location.reference, anchor: '', parts: [], local: false }
    }
    if (!isAbsolute(location.path)) throw new Error('保存的本机 Filesystem 位置不是绝对路径，拒绝重新绑定')
    if (relativePath.includes('\0') || isAbsolute(relativePath)) {
      throw new Error('relativePath 必须是登记范围内的相对路径，不能包含空字符或绝对路径')
    }
    const path = resolve(location.path, relativePath)
    const child = relative(location.path, path)
    if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
      throw new Error('relativePath 不能越过登记位置的范围')
    }
    const anchor = parse(path).root
    const fromAnchor = relative(anchor, path)
    return {
      path,
      reference: child === '' ? location.reference : {
        namespace: location.reference.namespace,
        id: pathToFileURL(path).href,
      },
      anchor,
      parts: fromAnchor === '' ? [] : fromAnchor.split(sep),
      local: true,
    }
  }

  private async probe(target: Target): Promise<Probe> {
    if (!target.local) {
      return {
        observation: observe(target, 'unavailable', 'unknown', '位置属于其他主机，不会自动绑定到本机同名路径'),
      }
    }
    // 从绝对路径根检查中间段，避免把“登记在链接下面”当作绕过链接限制的入口。
    let path = target.anchor
    let kind: FilesystemObservation['kind'] = 'unknown'
    try {
      for (let index = 0; index <= target.parts.length; index++) {
        const stats = await lstat(path)
        if (index === target.parts.length) {
          kind = kindOf(stats)
          if (kind === 'file') {
            // Windows 的 access(R_OK) 不检查完整 ACL；实际打开才能识别读取拒绝。
            const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
            await handle.close()
          } else if (kind === 'directory') {
            const directory = await opendir(path)
            await directory.close()
          } else if (kind !== 'symlink') {
            await access(path, constants.R_OK)
          }
          return { observation: observe(target, 'accessible', kind), stats }
        }
        if (stats.isSymbolicLink()) {
          return {
            observation: observe(target, 'unavailable', 'unknown', '不允许穿过登记范围中的符号链接或 junction'),
          }
        }
        if (!stats.isDirectory()) {
          return {
            observation: observe(target, 'missing', 'unknown', '中间路径不是目录 (ENOTDIR)'),
          }
        }
        path = join(path, target.parts[index]!)
      }
    } catch (error) {
      const details = errorDetails(error)
      return { observation: observe(target, details.state, kind, details.message) }
    }
    throw new Error('无法解析 Filesystem 观察路径')
  }

  async inspect(stored: StoredLocation, relativePath = ''): Promise<FilesystemObservation> {
    return (await this.probe(this.target(stored, relativePath))).observation
  }

  async discover(stored: StoredLocation, relativePath = '', requestedLimit = 200): Promise<FilesystemDiscovery> {
    const limit = boundedInteger(requestedLimit, 1000, 'limit')
    const target = this.target(stored, relativePath)
    const root = (await this.probe(target)).observation
    if (root.state !== 'accessible' || root.kind !== 'directory') {
      return { root, entries: [], truncated: false }
    }

    let directory: Dir | undefined
    try {
      directory = await opendir(target.path, { bufferSize: Math.min(limit + 1, 32) })
      const entries: FilesystemObservation[] = []
      while (entries.length < limit) {
        const entry = await directory.read()
        if (!entry) break
        const child = this.target(stored, relative(stored.location.path, join(target.path, entry.name)))
        entries.push((await this.probe(child)).observation)
      }
      // 多读一个目录项判定截断；不把“恰好达到 limit”冒充还有更多。
      const truncated = entries.length === limit && await directory.read() !== null
      // 只排序已选择的有界前缀；目录项选择仍沿用原生枚举顺序，不承诺快照。
      entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
      return { root, entries, truncated }
    } catch (error) {
      const details = errorDetails(error)
      return { root: observe(target, details.state, root.kind, details.message), entries: [], truncated: false }
    } finally {
      if (directory) {
        await directory.close().catch(error => { throw nativeError('关闭目录', error) })
      }
    }
  }

  async read(stored: StoredLocation, relativePath = '', requestedMaxBytes = 65536): Promise<FilesystemRead> {
    const maxBytes = boundedInteger(requestedMaxBytes, 1024 * 1024, 'maxBytes')
    const target = this.target(stored, relativePath)
    const { observation: resource, stats: before } = await this.probe(target)
    if (resource.state !== 'accessible') {
      throw new Error(`无法读取文件：${resource.error ?? resource.state}`)
    }
    if (resource.kind !== 'file' || !before) {
      throw new Error(`只能读取普通文件，当前类型为 ${resource.kind}；不跟随符号链接或 junction`)
    }

    const handle = await open(
      target.path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    ).catch(error => { throw nativeError('打开文件', error) })
    try {
      const current = await handle.stat().catch(error => { throw nativeError('检查已打开文件', error) })
      if (!current.isFile() || current.dev !== before.dev || current.ino !== before.ino) {
        throw new Error('读取前资源已变化，请重新观察；只允许读取同一普通文件')
      }
      const buffer = Buffer.allocUnsafe(maxBytes + 1)
      let size = 0
      while (size < buffer.length) {
        const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null)
          .catch(error => { throw nativeError('读取文件', error) })
        if (bytesRead === 0) break
        size += bytesRead
      }
      const truncated = size > maxBytes
      const bytes = buffer.subarray(0, Math.min(size, maxBytes))
      const decoder = new StringDecoder('utf8')
      // 截断时保留完整 UTF-8 前缀，不为被字节边界切开的字符制造替换符。
      const text = truncated ? decoder.write(bytes) : decoder.end(bytes)
      return { resource: { ...resource, observedAt: new Date().toISOString() }, text, truncated }
    } finally {
      await handle.close().catch(error => { throw nativeError('关闭文件', error) })
    }
  }
}
