import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WorkspaceApplication } from '@locus/application'

export interface LocusUiServerInfo {
  readonly url: string
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
  '.svg': 'image/svg+xml',
}

function defaultPublicRoot(): string {
  return fileURLToPath(new URL('../web/dist/', import.meta.url))
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

function failure(res: ServerResponse, status: number, code: string, message: string): void {
  json(res, status, { error: { code, message } })
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('请求体超过 64 KiB 上限。')
    chunks.push(buffer)
  }
  if (size === 0) return {}
  let value: unknown
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('请求体不是有效 JSON。')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('请求体必须是 JSON 对象。')
  }
  return value as Record<string, unknown>
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string') throw new Error(`${key} 必须是字符串。`)
  return value
}

function optionalStringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${key} 必须是字符串。`)
  return value
}

function queryInteger(url: URL, name: string, min: number, max: number): number | undefined {
  const raw = url.searchParams.get(name)
  if (raw === null) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min}–${max} 的整数。`)
  }
  return value
}

function relationKind(value: unknown): 'member' | 'association' {
  if (value !== 'member' && value !== 'association') throw new Error('kind 必须是 member 或 association。')
  return value
}

/** 当前 DSH 宿主的应用传输适配层：只提供 loopback HTTP、静态 UI 与 JSON API。 */
export function createLocusUiServer(
  getApplication: () => WorkspaceApplication,
  options: { readonly port?: number; readonly publicRoot?: string } = {},
): LocusUiServer {
  const host = DEFAULT_HOST
  if (!isLoopback(host)) throw new Error(`UI 只允许绑定 loopback，拒绝 ${host}。`)
  const publicRoot = resolve(options.publicRoot ?? defaultPublicRoot())
  const token = randomBytes(24).toString('base64url')
  let running: { readonly server: Server; readonly info: LocusUiServerInfo } | undefined

  function allowedOrigin(origin: string): boolean {
    return running !== undefined
      && (origin === running.info.url
        || origin === `http://localhost:${running.info.port}`
        || origin === `http://127.0.0.1:${running.info.port}`)
  }

  function authorized(req: IncomingMessage): boolean {
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
    const target = resolve(publicRoot, relative)
    if (target !== publicRoot && !target.startsWith(`${publicRoot}${sep}`)) {
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
    let payload = body
    if (extension === '.html') {
      payload = Buffer.from(body.toString('utf8').replaceAll('__LOCUS_UI_TOKEN__', token))
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
    res.setHeader('content-type', CONTENT_TYPES[extension] ?? 'application/octet-stream')
    res.setHeader('content-length', String(payload.length))
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy', 'no-referrer')
    res.setHeader('x-frame-options', 'DENY')
    if (req.method === 'HEAD') res.end()
    else res.end(payload)
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
    const app = getApplication()
    let segments: string[]
    try {
      segments = pathname.split('/').filter((part) => part.length > 0).map((part) => decodeURIComponent(part))
    } catch {
      failure(res, 400, 'bad-path', '路径编码无效。')
      return
    }

    if (segments[1] === 'health' && segments.length === 2 && req.method === 'GET') {
      json(res, 200, {
        ok: true,
        version: app.info.version,
        filesystemAvailable: app.filesystemAvailable,
      })
      return
    }

    if (segments[1] !== 'workspaces') {
      failure(res, 404, 'not-found', 'API 路径不存在。')
      return
    }

    if (segments.length === 2) {
      if (req.method === 'GET') {
        json(res, 200, { workspaces: app.listWorkspaces() })
        return
      }
      if (req.method === 'POST') {
        const body = await readBody(req)
        json(res, 201, { workspace: app.createWorkspace(stringField(body, 'name')) })
        return
      }
    }

    const workspaceId = segments[2]
    if (workspaceId === undefined) {
      failure(res, 404, 'not-found', 'API 路径不存在。')
      return
    }

    if (segments.length === 3 && req.method === 'GET') {
      const workspace = app.getWorkspace(workspaceId)
      json(res, 200, {
        workspace,
        filesystemAvailable: app.filesystemAvailable,
        locations: app.filesystemAvailable ? app.listLocations(workspaceId) : [],
      })
      return
    }

    if (segments.length === 4 && segments[3] === 'rename' && req.method === 'POST') {
      const body = await readBody(req)
      json(res, 200, { workspace: app.renameWorkspace(workspaceId, stringField(body, 'name')) })
      return
    }

    if (segments.length === 4 && segments[3] === 'relations' && req.method === 'POST') {
      const body = await readBody(req)
      const relation = app.link(
        workspaceId,
        relationKind(body.kind),
        { namespace: stringField(body, 'namespace'), id: stringField(body, 'id') },
        { kind: 'manual', detail: optionalStringField(body, 'detail') ?? 'UI 显式输入' },
      )
      json(res, 201, { relation })
      return
    }

    if (segments.length === 5 && segments[3] === 'relations' && req.method === 'DELETE') {
      const relationId = segments[4]!
      app.unlink(workspaceId, relationId)
      json(res, 200, { removedRelationId: relationId })
      return
    }

    if (segments.length === 4 && segments[3] === 'locations') {
      if (req.method === 'GET') {
        json(res, 200, { locations: app.listLocations(workspaceId) })
        return
      }
      if (req.method === 'POST') {
        const body = await readBody(req)
        json(res, 201, { location: app.registerLocation(workspaceId, stringField(body, 'path')) })
        return
      }
    }

    const locationId = segments[4]
    if (segments.length === 5 && segments[3] === 'locations' && locationId !== undefined) {
      if (req.method === 'DELETE') {
        app.unregisterLocation(workspaceId, locationId)
        json(res, 200, { removedLocationId: locationId })
        return
      }
    }

    if (segments.length === 6 && segments[3] === 'locations' && locationId !== undefined) {
      const action = segments[5]
      const relativePath = url.searchParams.get('relative') ?? undefined
      if (action === 'discover' && req.method === 'GET') {
        const limit = queryInteger(url, 'limit', 1, 1000)
        const discovery = await app.discoverLocation(workspaceId, locationId, relativePath, limit)
        json(res, 200, { discovery })
        return
      }
      if (action === 'read' && req.method === 'GET') {
        const maxBytes = queryInteger(url, 'maxBytes', 1, 1_048_576)
        json(res, 200, { read: await app.readLocation(workspaceId, locationId, relativePath, maxBytes) })
        return
      }
      if (action === 'confirm' && req.method === 'POST') {
        const body = await readBody(req)
        const relation = await app.confirmResource(
          workspaceId,
          locationId,
          body.kind === undefined ? 'member' : relationKind(body.kind),
          optionalStringField(body, 'relative'),
        )
        json(res, 201, { relation })
        return
      }
    }

    failure(res, 404, 'not-found', 'API 路径不存在。')
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${host}`)
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') {
        failure(res, 405, 'method-not-allowed', '只支持 GET、POST 与 DELETE。')
        return
      }
      try {
        await handleApi(url.pathname, req, res, url)
      } catch (error) {
        failure(res, 400, 'operation-failed', messageOf(error))
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
      if (!res.headersSent) failure(res, 500, 'internal-error', '本地应用接口执行失败。')
      else res.end()
      process.stderr.write(`[locus-ui] ${messageOf(error)}\n`)
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
      const info: LocusUiServerInfo = { url: `http://${host}:${address.port}`, port: address.port }
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
