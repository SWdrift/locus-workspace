import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Command } from 'commander'
import type { ApiRouter, InvocationFailureResult, InvocationRequest, LocusMethod } from '@locus/core/invocation'
import type { CliSecurityUI } from '../host/terminal.ts'
import { exitCodeFor, invocationErrorText } from '../output/errors.ts'
import { emitJson, outputOptions, writeErr, writeOut } from '../output/output.ts'
import type { WithCliApi } from './shared.ts'

interface InvocationCommandsContext {
  readonly router: ApiRouter
  readonly ui: CliSecurityUI
  readonly withApi: WithCliApi
}

export function registerInvocationCommands(program: Command, context: InvocationCommandsContext): void {
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    const verb = program
      .command(`${method} <uri...>`)
      .description(`按 URL 直接调用 operation（${method.toUpperCase()}）`)
      .option('-d, --data <json>', 'JSON Body')
      .option('-f, --file <path>', '从文件或 - 读取 Body')
      .option('--content-type <type>', 'Body 媒体类型')
    verb.action(async (uris: string[]) => {
      const upper = method.toUpperCase() as LocusMethod
      if (upper !== 'GET' && uris.length > 1) {
        verb.error('只有 GET 支持多个 URI', { exitCode: 1 })
      }
      const parsed = readBodyOptions(verb)
      if (parsed === undefined) return
      if (upper === 'GET' && parsed.body !== undefined) {
        verb.error('GET 不接受 Body', { exitCode: 1 })
      }
      const requests: readonly InvocationRequest[] = uris.map(uri => ({
        method: upper,
        uri,
        ...(parsed.body === undefined ? {} : { body: parsed.body }),
        ...(parsed.contentType === undefined ? {} : { contentType: parsed.contentType }),
      }))
      const trusted = await trustedTtyInput(context.router, context.ui, upper, uris, parsed.body)
      const results = await context.withApi(api =>
        upper === 'GET'
          ? api.invokeAll(requests as readonly (InvocationRequest & { readonly method: 'GET' })[])
          : Promise.all(requests.map(request => api.invoke(request, trusted))),
      )
      if (outputOptions(verb).json) {
        emitJson(verb, results.length === 1 ? results[0] : results)
      } else {
        for (const result of results) {
          if (result.ok) {
            writeOut(verb, `${typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)}\n`)
          } else {
            writeErr(verb, invocationErrorText(result.error))
          }
        }
      }
      const failed = results.find((result): result is InvocationFailureResult => !result.ok)
      if (failed !== undefined) process.exitCode = results.length > 1 ? 3 : exitCodeFor(failed.error.code)
    })
  }
}

/** URL 动词只在 Host 边界收集 tty 字段，不允许通过 Body 混入秘密。 */
async function trustedTtyInput(
  router: ApiRouter,
  ui: CliSecurityUI,
  method: LocusMethod,
  uris: readonly string[],
  body: unknown,
): Promise<Readonly<Record<string, string>> | undefined> {
  const collected: Record<string, string> = {}
  for (const uri of uris) {
    let fields
    try {
      fields = router.resolve(method, uri).operation.fields
    } catch {
      continue
    }
    for (const [name, field] of Object.entries(fields ?? {})) {
      if (field.tty !== true) continue
      if (body !== null && typeof body === 'object' && !Array.isArray(body) && Object.hasOwn(body, name)) continue
      if (!ui.interactive) continue
      collected[name] = await ui.readSecret(`${name}（隐藏输入）：`)
    }
  }
  return Object.keys(collected).length === 0 ? undefined : collected
}

function readBodyOptions(command: Command): { body: unknown; contentType: string | undefined } | undefined {
  const options = command.opts<{ data?: string; file?: string; contentType?: string }>()
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
