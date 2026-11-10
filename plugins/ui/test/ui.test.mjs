import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { createLocusCore } from '../../../packages/core/lib/index.js'
import { createOperationCatalog } from '../../../packages/operations/lib/index.js'
import { createLocusUiServer } from '../lib/server.js'

const webRoot = resolve('plugins/ui/web/dist')

function fixture(t) {
  const data = mkdtempSync(join(tmpdir(), 'locus-ui-'))
  const core = createLocusCore({ dataDirectory: data })
  const catalog = createOperationCatalog()
  const definition = {
    id: 'test.echo',
    version: 1,
    description: '返回输入文本',
    input: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: { text: { type: 'string', minLength: 1 } },
    },
    output: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: { text: { type: 'string' } },
    },
    requiresConfirmation: true,
  }
  catalog.register(definition, () => ({
    operationId: definition.id,
    version: definition.version,
    availability: async () => ({ available: true }),
    async execute(input) {
      return { text: input.text }
    },
  }))
  const server = createLocusUiServer(() => ({ locus: core, operations: catalog }), { webRoot, port: 0 })
  t.after(async () => {
    await server.stop()
    await core.dispose()
    rmSync(data, { recursive: true, force: true })
  })
  return { core, server }
}

async function start(t) {
  const f = fixture(t)
  const info = await f.server.start()
  const page = await fetch(`${info.url}/`)
  const html = await page.text()
  const token = /name="locus-ui-token" content="([^"]+)"/.exec(html)?.[1]
  assert.ok(token)
  return { ...f, info, token, html }
}

function headers(token, extra = {}) {
  return { 'x-locus-ui': '1', 'x-locus-ui-token': token, ...extra }
}

test('UI 静态页与 loopback API 需要本地令牌', async (t) => {
  const f = await start(t)
  assert.match(f.html, /Locus Workspace/)
  assert.equal((await fetch(`${f.info.url}/api/health`)).status, 403)
  assert.equal((await fetch(`${f.info.url}/api/health`, { headers: headers('wrong') })).status, 403)
  const blocked = await fetch(`${f.info.url}/api/health`, {
    headers: headers(f.token, { origin: 'http://evil.example' }),
  })
  assert.equal(blocked.status, 403)
  const health = await fetch(`${f.info.url}/api/health`, { headers: headers(f.token) })
  assert.equal(health.status, 200)
  assert.equal((await health.json()).ok, true)
  assert.equal((await fetch(`${f.info.url}/api/health`, { headers: headers(f.token), method: 'PUT' })).status, 405)
})

test('Workspaces、Overview 与 Operation 调用走同一应用用例', async (t) => {
  const f = await start(t)
  const workspace = f.core.workspaces.create('UI Workspace')
  const relation = f.core.workspaces.link(workspace.id, 'association', {
    namespace: 'test.resource',
    id: 'resource-1',
  }, { kind: 'manual', detail: 'ui relation' })

  const list = await fetch(`${f.info.url}/api/workspaces`, { headers: headers(f.token) })
  const listed = await list.json()
  assert.equal(listed.workspaces[0].id, workspace.id)

  const overviewResponse = await fetch(
    `${f.info.url}/api/workspaces/${workspace.id}/overview?observe=0`,
    { headers: headers(f.token) },
  )
  assert.equal(overviewResponse.status, 200)
  const { overview } = await overviewResponse.json()
  assert.equal(overview.workspace.id, workspace.id)
  assert.equal(overview.otherRelations[0].relationId, relation.id)
  assert.equal(overview.mode, 'relations')

  const definitions = await (await fetch(`${f.info.url}/api/operations`, { headers: headers(f.token) })).json()
  assert.equal(definitions.definitions[0].requiresConfirmation, true)
  const availability = await (await fetch(
    `${f.info.url}/api/operations/test.echo/availability`,
    { headers: headers(f.token) },
  )).json()
  assert.equal(availability.availability.state, 'available')

  const withoutConfirm = await fetch(`${f.info.url}/api/operations/test.echo/invoke`, {
    method: 'POST',
    headers: headers(f.token, { 'content-type': 'application/json' }),
    body: JSON.stringify({ input: { text: 'hello' } }),
  })
  assert.equal(withoutConfirm.status, 403)
  assert.equal((await withoutConfirm.json()).error.code, 'confirmation-required')

  const invoked = await fetch(`${f.info.url}/api/operations/test.echo/invoke`, {
    method: 'POST',
    headers: headers(f.token, { 'content-type': 'application/json' }),
    body: JSON.stringify({ input: { text: 'hello' }, confirm: true }),
  })
  assert.equal(invoked.status, 200)
  const result = (await invoked.json()).result
  assert.equal(result.ok, true)
  assert.deepEqual(result.value, { text: 'hello' })

  const invalid = await fetch(`${f.info.url}/api/operations/test.echo/invoke`, {
    method: 'POST',
    headers: headers(f.token, { 'content-type': 'application/json' }),
    body: JSON.stringify({ input: {}, confirm: true }),
  })
  assert.equal(invalid.status, 200)
  assert.equal((await invalid.json()).result.error.code, 'invalid-input')
})

test('静态路径不能越出 web 根且不支持目录穿越', async (t) => {
  const f = await start(t)
  const response = await fetch(`${f.info.url}/%2e%2e/package.json`)
  assert.equal(response.status, 404)
})
