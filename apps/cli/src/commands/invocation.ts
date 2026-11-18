import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Command } from 'commander'
import { LOCUS_METHODS } from '@locus/core/invocation'
import type {
  ApiRouter,
  InputField,
  InvocationFailureResult,
  InvocationRequest,
  InvocationResult,
  LocusMethod,
} from '@locus/core/invocation'
import { SecurityFailure } from '@locus/core/security'
import { readTrustedFieldFile } from '../host/input-file.ts'
import type { CliSecurityUI } from '../host/terminal.ts'
import { exitCodeFor, invocationErrorText } from '../output/errors.ts'
import { emitJson, outputOptions, writeErr, writeOut } from '../output/output.ts'
import type { WithCliApi } from './shared.ts'

interface InvocationCommandsContext {
  readonly router: ApiRouter
  readonly ui: CliSecurityUI
  readonly withApi: WithCliApi
}

interface InvocationOptions {
  readonly data?: string
  readonly file?: string
  readonly contentType?: string
  readonly fieldFile?: readonly string[]
  readonly prompt?: readonly string[]
}

interface InvocationBody {
  readonly body: unknown
  readonly contentType: string | undefined
}

type InputFields = Readonly<Record<string, InputField>>
type TrustedInput = Readonly<Record<string, string>>
type GetRequest = InvocationRequest & { readonly method: 'GET' }
type InvokeUris = (method: LocusMethod, uris: readonly string[], command: Command) => Promise<void>

/** 裸 URI 与五种方法共用参数、可信输入、结果信封和退出码。 */
export function registerInvocationCommands(program: Command, context: InvocationCommandsContext): InvokeUris {
  addInvocationOptions(program)
  const invokeUris: InvokeUris = async (method, uris, command) => {
    if (method !== 'GET' && uris.length > 1) {
      command.error('只有 GET 支持多个 URI', { exitCode: 1 })
    }
    const { body, contentType } = readBodyOptions(command)
    if (method === 'GET' && body !== undefined) {
      command.error('GET 不接受 Body', { exitCode: 1 })
    }
    const requests: readonly InvocationRequest[] = uris.map(uri => ({
      method,
      uri,
      ...(body === undefined ? {} : { body }),
      ...(contentType === undefined ? {} : { contentType }),
    }))
    const trustedInputs = await collectTrustedInputs(context, command, method, uris, body)
    const results = await context.withApi(async api => {
      if (method === 'GET' && trustedInputs.every(input => input === undefined)) {
        return api.invokeAll(requests as readonly GetRequest[])
      }
      const results: InvocationResult[] = []
      for (let index = 0; index < requests.length; index++) {
        results.push(await api.invoke(requests[index]!, trustedInputs[index]))
      }
      return results
    })
    if (outputOptions(command).json) {
      emitJson(command, results.length === 1 ? results[0] : results)
    } else {
      for (const result of results) {
        if (result.ok) {
          writeOut(command, `${typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)}\n`)
        } else {
          writeErr(command, invocationErrorText(result.error))
        }
      }
    }
    const failed = results.find((result): result is InvocationFailureResult => !result.ok)
    if (failed !== undefined) process.exitCode = results.length > 1 ? 3 : exitCodeFor(failed.error.code)
  }
  for (const method of LOCUS_METHODS) {
    const verb = addInvocationOptions(
      program.command(`${method.toLowerCase()} <uri...>`).description(`按 URL 直接调用 operation（${method}）`),
    )
    verb.action((uris: string[]) => invokeUris(method, uris, verb))
  }
  return invokeUris
}

function addInvocationOptions(command: Command): Command {
  return command
    .option('-d, --data <json>', 'JSON Body')
    .option('-f, --file <path>', '从文件或 - 读取 Body')
    .option('--content-type <type>', 'Body 媒体类型')
    .option('--field-file <field=path>', '从 UTF-8 普通文件读取声明允许 file 的 tty 字段；可重复', collectValues)
    .option('--prompt <field>', '显式采集一个可选 tty 字段；可重复', collectValues)
}

function collectValues(value: string, previous: string[] = []): string[] {
  return [...previous, value]
}

/** 输入来源只服从字段声明；可信值不进入普通 Body、环境或诊断。 */
async function collectTrustedInputs(
  context: InvocationCommandsContext,
  command: Command,
  method: LocusMethod,
  uris: readonly string[],
  body: unknown,
): Promise<readonly (TrustedInput | undefined)[]> {
  const options = command.optsWithGlobals<InvocationOptions>()
  const files = parseFieldFiles(command, options.fieldFile ?? [])
  const prompts = parsePromptFields(command, options.prompt ?? [])
  for (const name of prompts) {
    if (files.has(name)) command.error(`字段不能同时使用 --prompt 与 --field-file：${name}`, { exitCode: 1 })
  }
  const fieldsByUri: readonly (InputFields | undefined)[] = uris.map(uri => {
    try {
      return context.router.resolve(method, uri).operation.fields
    } catch {
      return undefined
    }
  })
  for (const fields of fieldsByUri) {
    for (const name of files.keys()) {
      if (fields?.[name]?.tty !== true || fields[name]!.file !== true) {
        command.error(`--field-file 只接受声明 tty: true 且 file: true 的字段：${name}`, { exitCode: 1 })
      }
      if (hasBodyField(body, name)) {
        command.error(`--field-file 不能与 Body 同时提供字段：${name}`, { exitCode: 1 })
      }
    }
    for (const name of prompts) {
      if (fields?.[name]?.tty !== true) {
        command.error(`--prompt 只接受已声明的 tty 字段：${name}`, { exitCode: 1 })
      }
    }
  }
  const fileValues: Record<string, string> = {}
  for (const [name, path] of files) {
    try {
      fileValues[name] = readTrustedFieldFile(path)
    } catch (error) {
      command.error(error instanceof Error ? error.message : '无法读取可信字段文件', { exitCode: 1 })
    }
  }
  const inputs: (TrustedInput | undefined)[] = []
  for (const fields of fieldsByUri) {
    const collected: Record<string, string> = { ...fileValues }
    for (const [name, field] of Object.entries(fields ?? {})) {
      if (field.tty !== true) continue
      if (files.has(name) || hasBodyField(body, name)) continue
      if (field.required === false && !prompts.has(name)) continue
      if (!context.ui.interactive) throw new SecurityFailure('authentication-unavailable')
      const label = field.description === undefined ? name : `${name}（${field.description}）`
      collected[name] = await context.ui.readSecret(`${label}（隐藏输入）：`)
    }
    inputs.push(Object.keys(collected).length === 0 ? undefined : collected)
  }
  return inputs
}

function parseFieldFiles(command: Command, values: readonly string[]): ReadonlyMap<string, string> {
  const files = new Map<string, string>()
  for (const value of values) {
    const separator = value.indexOf('=')
    if (separator <= 0 || separator === value.length - 1) {
      command.error('--field-file 必须为 field=path', { exitCode: 1 })
    }
    const name = value.slice(0, separator)
    if (files.has(name)) command.error(`--field-file 字段重复：${name}`, { exitCode: 1 })
    files.set(name, value.slice(separator + 1))
  }
  return files
}

function parsePromptFields(command: Command, values: readonly string[]): ReadonlySet<string> {
  const prompts = new Set<string>()
  for (const name of values) {
    if (name.length === 0 || prompts.has(name)) command.error(`--prompt 字段为空或重复：${name}`, { exitCode: 1 })
    prompts.add(name)
  }
  return prompts
}

function hasBodyField(body: unknown, name: string): boolean {
  return body !== null && typeof body === 'object' && !Array.isArray(body) && Object.hasOwn(body, name)
}

function readBodyOptions(command: Command): InvocationBody {
  const options = command.optsWithGlobals<InvocationOptions>()
  if (options.data !== undefined && options.file !== undefined) {
    command.error('--data 与 --file 不能同时使用', { exitCode: 1 })
  }
  const raw =
    options.data ??
    (options.file === undefined
      ? undefined
      : options.file === '-'
        ? readFileSync(0, 'utf8')
        : readFileSync(resolve(options.file), 'utf8'))
  if (raw === undefined) return { body: undefined, contentType: options.contentType }
  const type = (options.contentType ?? 'application/json').split(';', 1)[0]!.trim().toLowerCase()
  if (type !== 'application/json' && !type.endsWith('+json')) {
    command.error('只接受 application/json 或 +json', { exitCode: 1 })
  }
  try {
    return { body: JSON.parse(raw), contentType: options.contentType ?? 'application/json' }
  } catch {
    command.error('Body 不是合法 JSON', { exitCode: 1 })
  }
}
