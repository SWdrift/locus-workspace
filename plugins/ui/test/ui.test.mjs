import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createWorkspaceApplication } from '../../../packages/application/lib/index.js'
import { createLocusCore } from '../../../packages/core/lib/index.js'
import { createFilesystemService } from '../../../plugins/filesystem/lib/index.js'
import { createLocusUiServer } from '../lib/server.js'

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-ui-'))
  const data = join(root, 'data')
  const files = join(root, 'files')
  mkdirSync(files)
  writeFileSync(join(files, 'note.txt'), 'UI 文件内容\n')
  const core = createLocusCore({ dataDirectory: data })
  const filesystem = createFilesystemService(core)
  const server = createLocusUiServer(() => createWorkspaceApplication({ locus: core, filesystem }))
  const info = await server.start({ port: 0 })
  t.after(async () => {
    await server.stop()
    await filesystem.dispose()
    await core.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  const token = await pageToken(info.url)
  const call = async (path, options = {}) => {
    const headers = { 'x-locus-ui-token': token }
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    const response = await fetch(`${info.url}${path}`, {
      method: options.method ?? 'GET',
      headers: { ...headers, ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    const body = await response.json().catch(() => undefined)
    return { status: response.status, body }
  }
  return { info, files, call, token }
}

async function pageToken(url) {
  const html = await (await fetch(url)).text()
  const match = /name="locus-ui-token" content="([^"]+)"/.exec(html)
  assert.ok(match, '页面应内嵌本地 UI 令牌')
  return match[1]
}

test('静态页面注入令牌并拒绝缺少令牌或跨源请求', async (t) => {
  const f = await fixture(t)
  const html = await (await fetch(f.info.url)).text()
  assert.match(html, /<title>Locus Workspace<\/title>/)
  assert.equal(html.includes('__LOCUS_UI_TOKEN__'), false)
  const script = /<script[^>]+src="([^"]+)"/.exec(html)?.[1]
  assert.ok(script, '构建页面应引用入口脚本')
  const asset = await fetch(new URL(script, f.info.url))
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get('content-type'), /javascript/)

  const unauthorized = await fetch(`${f.info.url}/api/health`)
  assert.equal(unauthorized.status, 403)
  const crossOrigin = await fetch(`${f.info.url}/api/health`, {
    headers: { 'x-locus-ui-token': f.token, origin: 'http://evil.example' },
  })
  assert.equal(crossOrigin.status, 403)
})

test('UI 与 CLI 共用应用用例完成 Workspace、位置、浏览与确认', async (t) => {
  const f = await fixture(t)
  const health = await f.call('/api/health')
  assert.equal(health.status, 200)
  assert.equal(health.body.filesystemAvailable, true)

  const created = await f.call('/api/workspaces', { method: 'POST', body: { name: 'UI 工作空间' } })
  assert.equal(created.status, 201)
  const workspace = created.body.workspace

  const list = await f.call('/api/workspaces')
  assert.equal(list.body.workspaces.length, 1)
  const detail = await f.call(`/api/workspaces/${workspace.id}`)
  assert.equal(detail.body.workspace.name, 'UI 工作空间')
  assert.deepEqual(detail.body.locations, [])

  const registered = await f.call(`/api/workspaces/${workspace.id}/locations`, {
    method: 'POST',
    body: { path: f.files },
  })
  assert.equal(registered.status, 201)
  const location = registered.body.location
  const discovered = await f.call(`/api/workspaces/${workspace.id}/locations/${location.id}/discover`)
  assert.equal(discovered.body.discovery.entries[0].kind, 'file')
  const read = await f.call(`/api/workspaces/${workspace.id}/locations/${location.id}/read?relative=note.txt`)
  assert.equal(read.body.read.text, 'UI 文件内容\n')

  const confirmed = await f.call(`/api/workspaces/${workspace.id}/locations/${location.id}/confirm`, {
    method: 'POST',
    body: { kind: 'member', relative: 'note.txt' },
  })
  assert.equal(confirmed.status, 201)
  assert.equal(confirmed.body.relation.kind, 'member')
  const afterConfirm = await f.call(`/api/workspaces/${workspace.id}`)
  assert.equal(afterConfirm.body.workspace.relations.length, 1)

  const removed = await f.call(
    `/api/workspaces/${workspace.id}/relations/${confirmed.body.relation.id}`,
    { method: 'DELETE' },
  )
  assert.equal(removed.status, 200)
  const unregistered = await f.call(`/api/workspaces/${workspace.id}/locations/${location.id}`, { method: 'DELETE' })
  assert.equal(unregistered.status, 200)
  assert.deepEqual((await f.call(`/api/workspaces/${workspace.id}/locations`)).body.locations, [])
})

test('业务错误返回可读消息且不破坏 Workspace', async (t) => {
  const f = await fixture(t)
  const created = await f.call('/api/workspaces', { method: 'POST', body: { name: '错误' } })
  const workspace = created.body.workspace
  const missing = await f.call(`/api/workspaces/${workspace.id}/locations`, {
    method: 'POST',
    body: { path: '' },
  })
  assert.equal(missing.status, 400)
  assert.ok(missing.body.error.message.length > 0)
  assert.equal((await f.call(`/api/workspaces/${workspace.id}`)).body.workspace.id, workspace.id)
})
