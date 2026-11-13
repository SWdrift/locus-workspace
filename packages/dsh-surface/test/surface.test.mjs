import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createWorkspaceApplication } from '../../application/lib/index.js'
import { createLocusCore } from '../../core/lib/index.js'
import { createFilesystemService } from '../../../plugins/filesystem/lib/index.js'
import { createSurfaceHandler, injectToken } from '../lib/index.js'

const token = 'surface-test-token'

async function fixture(t, picker) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'locus-surface-')))
  const native = join(root, 'native')
  const added = join(root, 'added')
  const other = join(root, 'other')
  await mkdir(join(native, 'folder'), { recursive: true })
  await mkdir(added)
  await mkdir(other)
  await writeFile(join(native, 'alpha.txt'), 'alpha')
  await writeFile(join(native, 'folder', 'nested.txt'), 'nested')
  const core = createLocusCore({ dataDirectory: join(root, 'data') })
  const filesystem = createFilesystemService(core)
  const application = createWorkspaceApplication({ locus: core, filesystem })
  const server = createServer(createSurfaceHandler(application, { token, directoryPicker: picker }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await filesystem.dispose()
    await core.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${port}`
  function get(path, headers) {
    return fetch(base + path, { headers: { 'x-locus-api-token': token, ...headers } })
  }
  function post(path, body, headers) {
    return fetch(base + path, {
      method: 'POST',
      headers: { 'x-locus-api-token': token, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  }
  return { root, native, added, other, application, base, get, post }
}

function workspace(f, name = '原生表面') {
  return f.application.createWorkspace(name)
}

test('Host API 投影 Workspace、位置与逐层条目', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const location = f.application.registerLocation(value.id, f.native)

  const listed = await (await f.get('/locus/api/locations')).json()
  assert.equal(listed.workspaces.length, 1)
  assert.equal(listed.workspaces[0].id, value.id)
  assert.equal(listed.workspaces[0].locations[0].id, location.id)
  assert.equal(listed.workspaces[0].locations[0].path, f.native)
  assert.equal(listed.workspaces[0].relationCount, 0)
  assert.equal(typeof listed.workspaces[0].createdAt, 'string')

  const root = await (await f.get(`/locus/api/list?workspaceId=${value.id}&locationId=${location.id}`)).json()
  assert.equal(root.root.state, 'accessible')
  assert.deepEqual(root.entries.map(entry => entry.relativePath), ['alpha.txt', 'folder'])
  assert.deepEqual(root.entries.map(entry => entry.kind), ['file', 'directory'])

  const folder = await (await f.get(`/locus/api/list?workspaceId=${value.id}&locationId=${location.id}&relativePath=folder`)).json()
  assert.deepEqual(folder.entries.map(entry => [entry.relativePath, entry.name, entry.kind]), [
    ['folder/nested.txt', 'nested.txt', 'file'],
  ])
  assert.equal(folder.truncated, false)

  const read = await (await f.get(`/locus/api/read?workspaceId=${value.id}&locationId=${location.id}&relativePath=alpha.txt`)).json()
  assert.equal(read.text, 'alpha')
  assert.equal(read.truncated, false)
  assert.equal(read.resource.kind, 'file')
})

test('Host API 拒绝缺令牌、跨源、越界、跨 Workspace、非 JSON 与非 GET/POST', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const location = f.application.registerLocation(value.id, f.native)
  const other = workspace(f, '另一个')
  const otherLocation = f.application.registerLocation(other.id, join(f.root, 'other'))

  const anonymous = await fetch(`${f.base}/locus/api/locations`)
  assert.equal(anonymous.status, 401)

  const wrongToken = await fetch(`${f.base}/locus/api/locations`, {
    headers: { 'x-locus-api-token': 'wrong' },
  })
  assert.equal(wrongToken.status, 401)

  const crossOrigin = await f.get('/locus/api/locations', { origin: 'http://evil.example' })
  assert.equal(crossOrigin.status, 403)

  const escaped = await f.get(`/locus/api/list?workspaceId=${value.id}&locationId=${location.id}&relativePath=..%2F..%2Foutside`)
  assert.equal(escaped.status, 400)
  assert.equal((await escaped.json()).code, 'outside-location')

  const missing = await f.get(`/locus/api/list?workspaceId=${value.id}&locationId=missing`)
  assert.equal(missing.status, 404)

  const incomplete = await f.get(`/locus/api/list?workspaceId=${value.id}`)
  assert.equal(incomplete.status, 400)

  const crossed = await f.get(`/locus/api/list?workspaceId=${value.id}&locationId=${otherLocation.id}`)
  assert.equal(crossed.status, 404)

  const notJson = await fetch(`${f.base}/locus/api/locations`, {
    method: 'POST',
    headers: { 'x-locus-api-token': token, 'content-type': 'text/plain' },
    body: '{}',
  })
  assert.equal(notJson.status, 415)

  const put = await f.get('/locus/api/locations', {})
  assert.equal(put.status, 200)
  const wrongMethod = await fetch(`${f.base}/locus/api/locations`, {
    method: 'PUT',
    headers: { 'x-locus-api-token': token },
  })
  assert.equal(wrongMethod.status, 405)
})

test('位置登记与取消通过 Host API 操作，路径不存在的目录仍可登记', async t => {
  const f = await fixture(t)
  const value = workspace(f)

  const created = await f.post('/locus/api/locations', { workspaceId: value.id, path: f.added })
  assert.equal(created.status, 201)
  const location = (await created.json()).location
  assert.equal(location.path, f.added)

  const duplicate = await (await f.post('/locus/api/locations', { workspaceId: value.id, path: f.added })).json()
  assert.equal(duplicate.location.id, location.id)

  const relative = await f.post('/locus/api/locations', { workspaceId: value.id, path: './relative' })
  assert.equal(relative.status, 400)

  const unknown = await f.post('/locus/api/locations', { workspaceId: 'missing', path: f.other })
  assert.equal(unknown.status, 404)

  const listed = await (await f.get('/locus/api/locations')).json()
  assert.equal(listed.workspaces[0].locations.length, 1)

  const removed = await f.post('/locus/api/locations/remove', { workspaceId: value.id, locationId: location.id })
  assert.equal(removed.status, 200)
  assert.deepEqual(await removed.json(), { removed: true })
  assert.equal((await (await f.get('/locus/api/locations')).json()).workspaces[0].locations.length, 0)
  assert.equal((await stat(f.added)).isDirectory(), true)

  const again = await f.post('/locus/api/locations/remove', { workspaceId: value.id, locationId: location.id })
  assert.equal(again.status, 404)

  const missingPath = join(f.root, 'not-created')
  const missingLocation = await f.post('/locus/api/locations', { workspaceId: value.id, path: missingPath })
  assert.equal(missingLocation.status, 201)
  assert.equal((await missingLocation.json()).location.path, missingPath)
  const removeMissing = await f.post('/locus/api/locations/remove', {
    workspaceId: value.id,
    locationId: (await (await f.get('/locus/api/locations')).json()).workspaces[0].locations[0].id,
  })
  assert.equal(removeMissing.status, 200)
})

test('DSH 工作区与 Locus 工作区通过 Core association 关联', async t => {
  const f = await fixture(t)
  const first = workspace(f, '第一')
  const second = workspace(f, '第二')
  const dsh = 'dsh-workspace-a'

  const created = await f.post('/locus/api/associations', {
    dshWorkspaceId: dsh,
    locusWorkspaceId: first.id,
    dshWorkspacePath: f.native,
    associated: true,
  })
  assert.equal(created.status, 201)
  const createdBody = await created.json()
  assert.equal(createdBody.association.locusWorkspaceId, first.id)
  assert.equal(createdBody.location.path, f.native)
  assert.equal(f.application.getWorkspace(first.id).relations.length, 1)
  assert.equal(f.application.listLocations(first.id).length, 1)

  const listed = await (await f.get('/locus/api/associations')).json()
  assert.deepEqual(listed.associations.map(item => [item.dshWorkspaceId, item.locusWorkspaceId]), [[dsh, first.id]])

  const moved = await f.post('/locus/api/associations', {
    dshWorkspaceId: dsh,
    locusWorkspaceId: second.id,
    dshWorkspacePath: f.added,
    associated: true,
  })
  assert.equal(moved.status, 201)
  assert.equal(f.application.getWorkspace(first.id).relations.length, 0)
  assert.equal(f.application.getWorkspace(second.id).relations.length, 1)
  assert.equal(f.application.listLocations(second.id).length, 1)
  assert.equal(f.application.listLocations(first.id).length, 1)

  const invalidPath = await f.post('/locus/api/associations', {
    dshWorkspaceId: dsh,
    locusWorkspaceId: first.id,
    dshWorkspacePath: './relative',
    associated: true,
  })
  assert.equal(invalidPath.status, 400)

  const removed = await f.post('/locus/api/associations', {
    dshWorkspaceId: dsh,
    locusWorkspaceId: second.id,
    associated: false,
  })
  assert.equal(removed.status, 200)
  assert.deepEqual(await removed.json(), { removed: true })
  assert.deepEqual((await (await f.get('/locus/api/associations')).json()).associations, [])

  const missing = await f.post('/locus/api/associations', {
    dshWorkspaceId: dsh,
    locusWorkspaceId: second.id,
    associated: false,
  })
  assert.equal(missing.status, 404)
})

test('Locus Workspace 通过 Host API 创建与改名', async t => {
  const f = await fixture(t)

  const created = await f.post('/locus/api/workspaces', { name: '  新产品  ' })
  assert.equal(created.status, 201)
  const workspace = (await created.json()).workspace
  assert.equal(workspace.name, '新产品')
  assert.equal(workspace.relationCount, 0)
  assert.deepEqual(workspace.locations, [])

  const empty = await f.post('/locus/api/workspaces', { name: '   ' })
  assert.equal(empty.status, 400)

  const listed = await (await f.get('/locus/api/locations')).json()
  assert.equal(listed.workspaces.length, 1)
  assert.equal(listed.workspaces[0].name, '新产品')

  const renamed = await f.post('/locus/api/workspaces/rename', {
    workspaceId: workspace.id,
    name: '产品二号',
  })
  assert.equal(renamed.status, 200)
  assert.equal((await renamed.json()).workspace.name, '产品二号')
  assert.equal((await (await f.get('/locus/api/locations')).json()).workspaces[0].name, '产品二号')

  const missing = await f.post('/locus/api/workspaces/rename', {
    workspaceId: 'missing',
    name: '不存在',
  })
  assert.equal(missing.status, 404)
})

test('Directory Picker 能力与取消路径', async t => {
  const browse = await fixture(t, { capability: () => ({ kind: 'browse' }) })
  const browseCapabilities = await (await browse.get('/locus/api/capabilities')).json()
  assert.equal(browseCapabilities.directoryPicker, 'browse')
  assert.equal(browseCapabilities.workspaceManagement, true)
  const browsePick = await (await browse.post('/locus/api/pick-directory', {})).json()
  assert.deepEqual(browsePick, { kind: 'browse', path: null })

  const native = await fixture(t, { capability: () => ({ kind: 'native', pick: async () => nativePath }) })
  const nativePath = join(native.root, 'picked')
  const nativePick = await (await native.post('/locus/api/pick-directory', {})).json()
  assert.deepEqual(nativePick, { kind: 'native', path: nativePath })

  const none = await fixture(t)
  assert.equal((await (await none.get('/locus/api/capabilities')).json()).directoryPicker, null)
  assert.equal((await none.post('/locus/api/pick-directory', {})).status, 501)
})

test('页面令牌只注入 index head', () => {
  const html = '<html><head><title>x</title></head><body></body></html>'
  assert.match(injectToken(html, 'abc'), /<meta name="locus-api-token" content="abc"><\/head>/)
  assert.match(injectToken('<html></html>', 'abc'), /<meta name="locus-api-token" content="abc">/)
})
