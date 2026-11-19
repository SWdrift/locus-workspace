import { CommanderError } from 'commander'
import { ComponentFailure } from '@locus/core/components'
import { DomainFailure } from '@locus/core/invocation'
import type { InvocationErrorCode, InvocationResult } from '@locus/core/invocation'
import { SecurityFailure } from '@locus/core/security'
import { i18n } from '../i18n.ts'
import { jsonText, processOutput, resolveOutputOptions } from './output.ts'
import type { OutputFlags, OutputOptions, OutputStreams } from './output.ts'

/** 命令行自身拒绝的输入使用协议码表的参数类，调用方只面对一张码表。 */
export const USAGE_ERROR_CODE: InvocationErrorCode = 'invalid-argument'

/** 未分类异常沿用协议内部故障码，避免 CLI 另立码表。 */
export const UNEXPECTED_ERROR_CODE: InvocationErrorCode = 'internal'

interface FailureText {
  readonly code: string
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>>
}

/** Commander 自带 `error: ` 前缀，统一行格式不保留它。 */
function commandMessage(text: string): string {
  return text.trimEnd().replace(/^error:\s*/, '')
}

/** 用法拒绝与调用失败共用行格式，并保持先于 Commander usage 输出的位置。 */
export function usageErrorText(text: string): string {
  return `${i18n.t('diagnostic.usage', { code: USAGE_ERROR_CODE, text: commandMessage(text) })}\n`
}

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
  const output = resolveOutputOptions(flags)
  if (error instanceof CommanderError) {
    writeFailureJson(streams, output, { code: USAGE_ERROR_CODE, message: commandMessage(error.message) })
    return error.exitCode
  }
  if (error instanceof CliFailure) {
    writeFailureJson(streams, output, {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    })
    streams.writeErr(invocationErrorText(error))
    return exitCodeFor(error.code)
  }
  if (error instanceof SecurityFailure || error instanceof DomainFailure || error instanceof ComponentFailure) {
    const reason = 'reason' in error && typeof error.reason === 'string' ? error.reason : undefined
    writeFailureJson(streams, output, {
      code: error.code,
      message: error.message,
      ...(reason === undefined ? {} : { details: { reason } }),
    })
    const category =
      error instanceof SecurityFailure
        ? i18n.t('diagnostic.category.security')
        : error instanceof DomainFailure
          ? i18n.t('diagnostic.category.domain')
          : i18n.t('diagnostic.category.component')
    const suffix = reason === undefined ? '' : i18n.t('diagnostic.reason', { reason })
    streams.writeErr(
      `${i18n.t('diagnostic.category-line', {
        category,
        code: error.code,
        message: error.message,
        suffix,
      })}\n`,
    )
    return 2
  }
  const message = error instanceof Error ? error.message : String(error)
  writeFailureJson(streams, output, { code: UNEXPECTED_ERROR_CODE, message })
  streams.writeErr(`${i18n.t('diagnostic.unexpected', { code: UNEXPECTED_ERROR_CODE, message })}\n`)
  return 2
}

/** JSON 诊断与调用信封的错误对象同形：code、message 与可选 details。 */
function writeFailureJson(streams: OutputStreams, output: OutputOptions, value: FailureText): void {
  if (output.json) streams.writeOut(jsonText(value, output.pretty))
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

export function invocationErrorText(error: {
  readonly code: string
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>> | undefined
}): string {
  const stack = error.details?.stack
  const frames = Array.isArray(stack) ? stack.filter((line): line is string => typeof line === 'string') : []
  return i18n.t('diagnostic.invocation', {
    code: error.code,
    message: error.message,
    frames: frames.map(line => `${line}\n`).join(''),
  })
}
