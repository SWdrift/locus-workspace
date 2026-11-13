import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, isAbsolute, relative, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createWorkspaceApplication, type WorkspaceApplication } from '@locus/application'
import type { FilesystemFailure, FilesystemService, LocusService } from '@locus/contracts'

/** 稳定的 Cordis 插件名。 */
export const name = 'locus-dsh-surface'

/** Host API 只在同时具备 Core、Filesystem 与 Web 服务器时装载。 */
export const inject = ['locus', 'locusFilesystem', 'webServer']

interface WebRouteLike {
  readonly kind: 'prefix'
  readonly path: string
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

interface WebServerLike {
  register(route: WebRouteLike): () => void
  tapIndex(transform: (html: string) => string): () => void
}

interface PickerCapability {
  readonly kind: string
  readonly pick?: (signal: AbortSignal) => Promise<string | null>
}

interface DirectoryPickerLike {
  capability(): PickerCapability
}

export interface SurfaceOptions {
  readonly token: string
  readonly directoryPicker?: DirectoryPickerLike
  readonly getDirectoryPicker?: () => DirectoryPickerLike | undefined
}

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const maxBodyBytes = 64 * 1024
/** DSH workspace references are stored as Locus association relations. */
const dshWorkspaceNamespace = 'dsh.workspace'

function respond(res: ServerResponse, status: number, value: unknown): void {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

function failureStatus(error: unknown): number {
  const code = (error as Partial<FilesystemFailure>).code
  if (code === 'not-found') return 404
  if (code === 'invalid' || code === 'outside-location') return 400
  if (code === 'denied' || code === 'unavailable') return 403
  return 500
}

function stringField(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new RequestError(400, `需要非空字符串字段 ${field}`)
  }
  return value
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk)
    if (size > maxBodyBytes) throw new RequestError(413, '请求体过大')
    chunks.push(Buffer.from(chunk))
  }
  if (size === 0) return {}
  let value: unknown
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new RequestError(400, 'JSON 请求体无效')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequestError(400, 'JSON 请求体必须是对象')
  }
  return value as Record<string, unknown>
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  return origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`
}

function listAssociations(application: WorkspaceApplication): Array<{
  dshWorkspaceId: string
  locusWorkspaceId: string
  relationId: string
}> {
  const associations: Array<{ dshWorkspaceId: string; locusWorkspaceId: string; relationId: string }> = []
  for (const workspace of application.listWorkspaces()) {
    for (const relation of workspace.relations) {
      if (relation.kind === 'association' && relation.target.namespace === dshWorkspaceNamespace) {
        associations.push({
          dshWorkspaceId: relation.target.id,
          locusWorkspaceId: workspace.id,
          relationId: relation.id,
        })
      }
    }
  }
  return associations
}

function pickerOf(options: SurfaceOptions): DirectoryPickerLike | undefined {
  try {
    return options.getDirectoryPicker === undefined ? options.directoryPicker : options.getDirectoryPicker()
  } catch {
    return undefined
  }
}

function workspaceExists(application: WorkspaceApplication, workspaceId: string): void {
  try {
    application.getWorkspace(workspaceId)
  } catch {
    throw new RequestError(404, 'Workspace 不存在')
  }
}

/** 把进程级令牌注入页面 head；browser 只在同源页面内读得到它。 */
export function injectToken(html: string, token: string): string {
  const meta = `<meta name="locus-api-token" content="${token}">`
  return html.includes('</head>') ? html.replace('</head>', `${meta}</head>`) : `${html}${meta}`
}

/**
 * 投影已登记位置；写操作限于 Workspace 创建/改名、位置登记与取消，
 * 以及用户显式建立的 DSH 工作区关联。文件内容仍不可写。
 */
export function createSurfaceHandler(
  application: WorkspaceApplication,
  options: SurfaceOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const remote = req.socket.remoteAddress ?? ''
    if (!loopback.has(remote)) {
      respond(res, 403, { error: '只接受本机请求' })
      return
    }
    if (!sameOrigin(req)) {
      respond(res, 403, { error: '只接受同源请求' })
      return
    }
    if (req.headers['x-locus-api-token'] !== options.token) {
      respond(res, 401, { error: '缺少或无效的 Locus API 令牌' })
      return
    }

    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (req.method === 'GET') {
        if (url.pathname === '/locus/api/capabilities') {
          let directoryPicker: string | null = null
          try {
            const picker = pickerOf(options)
            directoryPicker = picker === undefined ? null : picker.capability().kind
          } catch {
            directoryPicker = null
          }
          respond(res, 200, {
            apiVersion: 1,
            directoryPicker,
            workspaceManagement: true,
          })
          return
        }
        if (url.pathname === '/locus/api/associations') {
          respond(res, 200, { associations: listAssociations(application) })
          return
        }
        if (url.pathname === '/locus/api/locations') {
          respond(res, 200, {
            workspaces: application.listWorkspaces().map(workspace => ({
              id: workspace.id,
              name: workspace.name,
              createdAt: workspace.createdAt,
              relationCount: workspace.relations.length,
              locations: application.listLocations(workspace.id),
            })),
          })
          return
        }
        if (url.pathname === '/locus/api/list') {
          const workspaceId = url.searchParams.get('workspaceId') ?? ''
          const locationId = url.searchParams.get('locationId') ?? ''
          const relativePath = url.searchParams.get('relativePath') ?? ''
          if (workspaceId === '' || locationId === '') {
            respond(res, 400, { error: '需要 workspaceId 与 locationId' })
            return
          }
          workspaceExists(application, workspaceId)
          const location = application.listLocations(workspaceId).find(item => item.id === locationId)
          if (location === undefined) {
            respond(res, 404, { error: '位置不存在' })
            return
          }
          const discovery = await application.discoverLocation(workspaceId, locationId, relativePath)
          const entries = discovery.entries
            .map((entry) => {
              const child = relative(location.path, entry.path)
              return {
                name: basename(entry.path),
                relativePath: child.split(sep).join('/'),
                state: entry.state,
                kind: entry.kind,
              }
            })
            .filter(entry => entry.relativePath !== '' && entry.relativePath !== '..' && !entry.relativePath.startsWith('../'))
          respond(res, 200, {
            root: {
              state: discovery.root.state,
              kind: discovery.root.kind,
              relativePath,
              ...(discovery.root.error === undefined ? {} : { error: discovery.root.error }),
            },
            entries,
            truncated: discovery.truncated,
          })
          return
        }
        if (url.pathname === '/locus/api/read') {
          const workspaceId = url.searchParams.get('workspaceId') ?? ''
          const locationId = url.searchParams.get('locationId') ?? ''
          const relativePath = url.searchParams.get('relativePath') ?? ''
          if (workspaceId === '' || locationId === '') {
            respond(res, 400, { error: '需要 workspaceId 与 locationId' })
            return
          }
          workspaceExists(application, workspaceId)
          const location = application.listLocations(workspaceId).find(item => item.id === locationId)
          if (location === undefined) {
            respond(res, 404, { error: '位置不存在' })
            return
          }
          const read = await application.readLocation(workspaceId, locationId, relativePath, 256 * 1024)
          respond(res, 200, {
            text: read.text,
            truncated: read.truncated,
            resource: {
              path: read.resource.path,
              kind: read.resource.kind,
              state: read.resource.state,
              ...(read.resource.error === undefined ? {} : { error: read.resource.error }),
            },
          })
          return
        }
        respond(res, 404, { error: '路径不存在' })
        return
      }

      if (req.method === 'POST') {
        const contentType = String(req.headers['content-type'] ?? '')
        if (!contentType.startsWith('application/json')) {
          respond(res, 415, { error: '只接受 application/json 请求体' })
          return
        }
        const body = await readJson(req)
        if (url.pathname === '/locus/api/workspaces') {
          const name = stringField(body, 'name').trim()
          if (name === '') throw new RequestError(400, 'Workspace 名称不能为空')
          const workspace = application.createWorkspace(name)
          respond(res, 201, {
            workspace: {
              id: workspace.id,
              name: workspace.name,
              createdAt: workspace.createdAt,
              relationCount: 0,
              locations: [],
            },
          })
          return
        }
        if (url.pathname === '/locus/api/workspaces/rename') {
          const workspaceId = stringField(body, 'workspaceId')
          const name = stringField(body, 'name').trim()
          if (name === '') throw new RequestError(400, 'Workspace 名称不能为空')
          workspaceExists(application, workspaceId)
          const workspace = application.renameWorkspace(workspaceId, name)
          respond(res, 200, {
            workspace: {
              id: workspace.id,
              name: workspace.name,
              createdAt: workspace.createdAt,
              relationCount: workspace.relations.length,
              locations: application.listLocations(workspace.id),
            },
          })
          return
        }
        if (url.pathname === '/locus/api/locations') {
          const workspaceId = stringField(body, 'workspaceId')
          const path = stringField(body, 'path')
          workspaceExists(application, workspaceId)
          if (!isAbsolute(path)) throw new RequestError(400, 'path 必须是绝对路径')
          const location = application.registerLocation(workspaceId, path)
          respond(res, 201, { location })
          return
        }
        if (url.pathname === '/locus/api/associations') {
          const dshWorkspaceId = stringField(body, 'dshWorkspaceId')
          const locusWorkspaceId = stringField(body, 'locusWorkspaceId')
          const associated = body.associated
          if (typeof associated !== 'boolean') throw new RequestError(400, '需要布尔字段 associated')
          workspaceExists(application, locusWorkspaceId)
          if (associated) {
            const dshWorkspacePath = body.dshWorkspacePath
            if (dshWorkspacePath !== undefined && typeof dshWorkspacePath !== 'string') {
              throw new RequestError(400, 'dshWorkspacePath 必须是字符串')
            }
            if (dshWorkspacePath !== undefined && !isAbsolute(dshWorkspacePath)) {
              throw new RequestError(400, 'dshWorkspacePath 必须是绝对路径')
            }
            for (const existing of listAssociations(application)) {
              if (existing.dshWorkspaceId === dshWorkspaceId) {
                application.unlink(existing.locusWorkspaceId, existing.relationId)
              }
            }
            const relation = application.link(
              locusWorkspaceId,
              'association',
              { namespace: dshWorkspaceNamespace, id: dshWorkspaceId },
              { kind: 'manual', detail: 'DSH 工作区关联' },
            )
            const location = dshWorkspacePath === undefined || dshWorkspacePath.trim() === ''
              ? undefined
              : application.registerLocation(locusWorkspaceId, dshWorkspacePath)
            respond(res, 201, {
              association: { dshWorkspaceId, locusWorkspaceId, relationId: relation.id },
              ...(location === undefined ? {} : { location }),
            })
            return
          }
          let removed = false
          for (const existing of listAssociations(application)) {
            if (existing.dshWorkspaceId === dshWorkspaceId && existing.locusWorkspaceId === locusWorkspaceId) {
              application.unlink(locusWorkspaceId, existing.relationId)
              removed = true
            }
          }
          if (!removed) {
            respond(res, 404, { error: '关联不存在' })
            return
          }
          respond(res, 200, { removed: true })
          return
        }
        if (url.pathname === '/locus/api/locations/remove') {
          const workspaceId = stringField(body, 'workspaceId')
          const locationId = stringField(body, 'locationId')
          workspaceExists(application, workspaceId)
          const existing = application.listLocations(workspaceId).find(item => item.id === locationId)
          if (existing === undefined) {
            respond(res, 404, { error: '位置不存在' })
            return
          }
          application.unregisterLocation(workspaceId, locationId)
          respond(res, 200, { removed: true })
          return
        }
        if (url.pathname === '/locus/api/pick-directory') {
          const picker = pickerOf(options)
          if (picker === undefined) throw new RequestError(501, '当前 Host 没有 Directory Picker')
          const capability = picker.capability()
          if (capability.kind !== 'native' || capability.pick === undefined) {
            respond(res, 200, { kind: capability.kind, path: null })
            return
          }
          const controller = new AbortController()
          res.on('close', () => {
            if (!res.writableEnded) controller.abort()
          })
          const path = await capability.pick(controller.signal)
          respond(res, 200, { kind: 'native', path })
          return
        }
        respond(res, 404, { error: '路径不存在' })
        return
      }

      res.writeHead(405, { allow: 'GET, POST' })
      res.end()
    } catch (error) {
      if (error instanceof RequestError) {
        respond(res, error.status, { error: error.message })
        return
      }
      respond(res, failureStatus(error), {
        code: (error as Partial<FilesystemFailure>).code ?? 'io',
        error: error instanceof Error ? error.message : '操作失败',
      })
    }
  }
}

/** 注册 Host API 与页面令牌；browser 半边随同一包的 `dsh.client` 元数据由 DSH 提供。 */
export function apply(ctx: Context): void {
  const locus = ctx.get('locus') as LocusService
  const filesystem = ctx.get('locusFilesystem') as FilesystemService
  const webServer = ctx.get('webServer') as WebServerLike
  const token = randomUUID()
  const handler = createSurfaceHandler(createWorkspaceApplication({ locus, filesystem }), {
    token,
    getDirectoryPicker: () => {
      try {
        return ctx.get('directoryPicker') as DirectoryPickerLike | undefined
      } catch {
        return undefined
      }
    },
  })
  ctx.effect(
    () => webServer.register({ kind: 'prefix', path: '/locus/api', handler }),
    'locus-dsh-surface: host api',
  )
  ctx.effect(
    () => webServer.tapIndex(html => injectToken(html, token)),
    'locus-dsh-surface: api token',
  )
}
