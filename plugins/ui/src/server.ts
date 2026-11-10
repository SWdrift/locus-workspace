import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWorkspaceOverview, type WorkspaceOverviewServices } from '@locus/application'
import type { OperationCatalogService, OperationDefinition } from '@locus/contracts'

export interface LocusUiServices extends WorkspaceOverviewServices {
  readonly operations: OperationCatalogService
}

export interface LocusUiServerOptions {
  readonly port?: number
  readonly host?: string
  readonly webRoot?: string
}

export interface LocusUiServerInfo {
  readonly url: string
  readonly host: string
  readonly port: number
}

export interface LocusUiServer {
  start(options?: { readonly port?: number }): Promise<LocusUiServerInfo>
  stop(): Promise<void>
  url(): string | undefined
}

const DEFAULT_PORT = 4310
const DEFAULT_HOST = '127.0.0.1'
const MAX_BODY_BYTES = 64 * 1024
const MAX_PORT = 65535

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

function defaultWebRoot(): string {
  return fileURLToPath(new URL('../web/dist/', import.meta.url))
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function json(res: ServerResponse, status: number, value: unknown, extraHeaders: Record<string, string> = {}): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...extraHeaders,
  })
  res.end(body)
}

function failure(res: ServerResponse, status: number, code: string, message: string): void {
  json(res, status, { error: { code, message } })
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('请求体超过 64 KiB 上限。')
    chunks.push(buffer)
  }
  if (size === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new Error('请求体不是有效 JSON。')
  }
}

function publicDefinition(definition: OperationDefinition): OperationDefinition {
  return definition
}

/**
 * 当前 DSH 宿主的应用传输适配层：只提供 loopback HTTP、静态 UI 与 JSON API。
 * 不执行领域 I/O，不复制组合逻辑；每次请求读取当前服务实例。
 */
export function createLocusUiServer(
  getServices: () => LocusUiServices,
  options: LocusUiServerOptions = {},
): LocusUiServer {
  const host = options.host ?? DEFAULT_HOST
  if (!isLoopback(host)) throw new Error(`UI 只允许绑定 loopback，拒绝 ${host}。`)
  const webRoot = resolve(options.webRoot ?? defaultWebRoot())
  const token = randomBytes(24).toString('base64url')
  let running: { readonly server: Server; readonly info: LocusUiServerInfo } | undefined

  function allowedOrigin(origin: string): boolean {
    if (running === undefined) return false
    return origin === running.info.url
      || origin === `http://localhost:${running.info.port}`
      || origin === `http://127.0.0.1:${running.info.port}`
  }

  function authorized(req: IncomingMessage): boolean {
    if (req.headers['x-locus-ui'] !== '1') return false
    if (req.headers['x-locus-ui-token'] !== token) return false
    const origin = req.headers.origin
    return origin === undefined || allowedOrigin(origin)
  }

  async function serveStatic(pathname: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    let decoded: string
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      failure(res, 400, 'bad-path', '路径编码无效。')
      return
    }
    if (decoded.includes('\0')) {
      failure(res, 400, 'bad-path', '路径无效。')
      return
    }
    const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
    const target = resolve(webRoot, relative)
    if (target !== webRoot && !target.startsWith(`${webRoot}${sep}`)) {
      failure(res, 404, 'not-found', '资源不存在。')
      return
    }
    let body: Buffer
    try {
      body = await readFile(target)
    } catch {
      failure(res, 404, 'not-found', '资源不存在。')
      return
    }
    const extension = extname(target).toLowerCase()
    const contentType = CONTENT_TYPES[extension] ?? 'application/octet-stream'
    let text = body
    if (extension === '.html') {
      text = Buffer.from(body.toString('utf8').replaceAll('__LOCUS_UI_TOKEN__', token))
      res.setHeader('cache-control', 'no-store')
      res.setHeader('content-security-policy', [
        "default-src 'self'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
      ].join('; '))
    } else {
      res.setHeader('cache-control', 'no-cache')
    }
    res.setHeader('content-type', contentType)
    res.setHeader('content-length', String(text.length))
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy', 'no-referrer')
    res.setHeader('x-frame-options', 'DENY')
    if (req.method === 'HEAD') res.end()
    else res.end(text)
  }

  async function handleApi(
    pathname: string,
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    if (!authorized(req)) {
      failure(res, 403, 'forbidden', '请求缺少有效的本地 UI 令牌或来源不被允许。')
      return
    }
    const services = getServices()
    const segments = pathname.split('/').filter((part) => part.length > 0)
    if (segments[1] === 'health' && segments.length === 2 && req.method === 'GET') {
      json(res, 200, {
        ok: true,
        version: services.locus.info.version,
        generatedAt: new Date().toISOString(),
      })
      return
    }
    if (segments[1] === 'workspaces' && segments.length === 2 && req.method === 'GET') {
      json(res, 200, { workspaces: services.locus.workspaces.list() })
      return
    }
    if (segments[1] === 'workspaces' && segments.length === 4 && segments[3] === 'overview' && req.method === 'GET') {
      const workspaceId = decodeURIComponent(segments[2]!)
      const observe = url.searchParams.get('observe') === '1'
      const overview = await buildWorkspaceOverview(services, workspaceId, { observe })
      json(res, 200, { overview })
      return
    }
    if (segments[1] === 'operations' && segments.length === 2 && req.method === 'GET') {
      json(res, 200, { definitions: services.operations.list().map(publicDefinition) })
      return
    }
    if (segments[1] === 'operations' && segments.length === 4 && segments[3] === 'availability' && req.method === 'GET') {
      const operationId = decodeURIComponent(segments[2]!)
      const workspaceId = url.searchParams.get('workspaceId') ?? undefined
      const availability = await services.operations.availability(
        operationId,
        workspaceId === undefined ? {} : { workspaceId },
      )
      json(res, 200, { availability })
      return
    }
    if (segments[1] === 'operations' && segments.length === 4 && segments[3] === 'invoke' && req.method === 'POST') {
      if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
        failure(res, 415, 'unsupported-media-type', '调用必须使用 application/json。')
        return
      }
      const operationId = decodeURIComponent(segments[2]!)
      const definition = services.operations.get(operationId)
      if (definition === undefined) {
        failure(res, 404, 'definition-missing', `操作 ${operationId} 的定义未安装。`)
        return
      }
      let body: unknown
      try {
        body = await readBody(req)
      } catch (error) {
        failure(res, 400, 'invalid-request', messageOf(error))
        return
      }
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        failure(res, 400, 'invalid-request', '调用体必须是 JSON 对象。')
        return
      }
      const payload = body as { input?: unknown; workspaceId?: unknown; confirm?: unknown }
      if (definition.requiresConfirmation === true && payload.confirm !== true) {
        failure(res, 403, 'confirmation-required', '该操作需要明确的 confirm: true 确认。')
        return
      }
      if (payload.workspaceId !== undefined && typeof payload.workspaceId !== 'string') {
        failure(res, 400, 'invalid-request', 'workspaceId 必须是字符串。')
        return
      }
      const result = await services.operations.invoke(definition, payload.input, {
        ...(payload.workspaceId === undefined ? {} : { workspaceId: payload.workspaceId }),
      })
      json(res, 200, { result })
      return
    }
    failure(res, 404, 'not-found', 'API 路径不存在。')
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${host}`)
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'POST') {
        failure(res, 405, 'method-not-allowed', '只支持 GET 与 POST。')
        return
      }
      try {
        await handleApi(url.pathname, req, res, url)
      } catch (error) {
        process.stderr.write(`[locus-ui] ${messageOf(error)}\n`)
        failure(res, 500, 'internal-error', '本地应用接口执行失败。')
      }
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      failure(res, 405, 'method-not-allowed', '静态资源只支持 GET 与 HEAD。')
      return
    }
    await serveStatic(url.pathname, req, res)
  }

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      process.stderr.write(`[locus-ui] ${messageOf(error)}\n`)
      if (!res.headersSent) failure(res, 500, 'internal-error', '本地应用接口执行失败。')
      else res.end()
    })
  })

  function start(startOptions: { readonly port?: number } = {}): Promise<LocusUiServerInfo> {
    if (running !== undefined) return Promise.resolve(running.info)
    const port = startOptions.port ?? options.port ?? DEFAULT_PORT
    if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
      return Promise.reject(new Error(`端口必须是 0–${MAX_PORT} 的整数。`))
    }
    const { promise, resolve: resolveStart, reject: rejectStart } = Promise.withResolvers<LocusUiServerInfo>()
    const onError = (error: Error): void => {
      rejectStart(new Error(`Locus UI 无法监听 ${host}:${port}：${error.message}`))
    }
    server.once('error', onError)
    server.listen(port, host, () => {
      server.off('error', onError)
      const address = server.address()
      if (address === null || typeof address === 'string') {
        rejectStart(new Error('Locus UI 没有取得有效监听地址。'))
        return
      }
      const info: LocusUiServerInfo = {
        url: `http://${host}:${address.port}`,
        host,
        port: address.port,
      }
      running = { server, info }
      resolveStart(info)
    })
    return promise
  }

  async function stop(): Promise<void> {
    if (running === undefined) return
    const current = running
    running = undefined
    const { promise, resolve: resolveStop, reject: rejectStop } = Promise.withResolvers<void>()
    current.server.close((error) => error === undefined ? resolveStop() : rejectStop(error))
    current.server.closeAllConnections()
    await promise
  }

  return {
    start,
    stop,
    url: () => running?.info.url,
  }
}
