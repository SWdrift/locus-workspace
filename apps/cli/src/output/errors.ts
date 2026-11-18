import { CommanderError } from 'commander'
import { ComponentFailure } from '@locus/core/components'
import { DomainFailure } from '@locus/core/invocation'
import type { InvocationErrorCode, InvocationResult } from '@locus/core/invocation'
import { SecurityFailure } from '@locus/core/security'
import { jsonText, processOutput, resolveOutputOptions } from './output.ts'
import type { OutputFlags, OutputStreams } from './output.ts'

/** 命名命令抛出可分类失败；URL 动词保留完整调用信封。 */
export class CliFailure extends Error {
  readonly code: InvocationErrorCode
  readonly details: Readonly<Record<string, unknown>> | undefined

  constructor(result: InvocationResult & { readonly ok: false }) {
    super(result.error.message)
    this.name = 'CliFailure'
    this.code = result.error.code
    this.details = result.error.details
  }
}

/** 顶层异常只在这里转换输出与退出码，Commander 已输出的诊断不重复打印。 */
export function reportError(error: unknown, flags: OutputFlags, streams: OutputStreams = processOutput): number {
  if (error instanceof CommanderError) return error.exitCode
  const output = resolveOutputOptions(flags)
  if (error instanceof CliFailure) {
    if (output.json) {
      streams.writeOut(
        jsonText(
          {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
          },
          output.pretty,
        ),
      )
    }
    streams.writeErr(invocationErrorText(error))
    return exitCodeFor(error.code)
  }
  if (error instanceof SecurityFailure || error instanceof DomainFailure || error instanceof ComponentFailure) {
    const reason = 'reason' in error && typeof error.reason === 'string' ? error.reason : undefined
    if (output.json) {
      streams.writeOut(
        jsonText(
          {
            code: error.code,
            ...(reason === undefined ? {} : { reason }),
          },
          output.pretty,
        ),
      )
    }
    const label =
      error instanceof SecurityFailure ? '安全操作' : error instanceof DomainFailure ? '组件 operation' : '组件操作'
    streams.writeErr(
      `Locus ${label}失败 [${error.code}]：${error.message}${reason === undefined ? '' : `（${reason}）`}\n`,
    )
    return 2
  }
  streams.writeErr(`Locus 操作失败：${error instanceof Error ? error.message : String(error)}\n`)
  return 2
}

export function exitCodeFor(code: InvocationErrorCode): number {
  if (
    code === 'invalid-argument' ||
    code === 'invalid-body' ||
    code === 'invalid-uri' ||
    code === 'unsupported-method' ||
    code === 'unsupported-scheme' ||
    code === 'unsupported-media-type'
  )
    return 1
  return 2
}

export function unwrap(result: InvocationResult): unknown {
  if (!result.ok) throw new CliFailure(result as InvocationResult & { readonly ok: false })
  return result.data
}

export function invocationErrorText(error: { readonly code: string; readonly message: string }): string {
  return `Locus 调用失败 [${error.code}]：${error.message}\n`
}
