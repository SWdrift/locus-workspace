import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { resolve } from 'node:path'

const MAX_FIELD_FILE_BYTES = 1024 * 1024

/** 可信字段文件有界读取；路径可诊断，内容与解码错误不得进入异常文本。 */
export function readTrustedFieldFile(path: string): string {
  const absolute = resolve(path)
  let descriptor: number | undefined
  try {
    const before = lstatSync(absolute)
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_FIELD_FILE_BYTES) {
      throw new Error()
    }
    descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    const opened = fstatSync(descriptor)
    if (
      !opened.isFile() ||
      opened.size > MAX_FIELD_FILE_BYTES ||
      before.dev !== opened.dev ||
      before.ino !== opened.ino
    ) {
      throw new Error()
    }
    // 多读一字节识别读取期间的文件增长，缓冲区始终有界。
    const buffer = Buffer.allocUnsafe(opened.size + 1)
    let length = 0
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null)
      if (count === 0) break
      length += count
    }
    if (length === buffer.length) throw new Error()
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    throw new Error(
      `无法读取可信字段文件 ${absolute}：需要不超过 1 MiB 的 UTF-8 普通文件，拒绝符号链接${code === undefined ? '' : `（${code}）`}`,
    )
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}
