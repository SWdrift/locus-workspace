import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import * as pkg from '../lib/index.js'
import { component, operations } from '../lib/index.js'

function operation(id) {
  const found = operations.find((item) => item.id === id)
  assert.ok(found, `缺少 operation：${id}`)
  return found
}

const list = operation('rt.targets.list')
const get = operation('rt.target.get')
const remove = operation('rt.target.remove')
const register = operation('rt.target.register')

const TARGETS = `version: 1
targets:
  - id: win-x
    resource:
      kind: windows-device
    identity:
      login: Administrator
      auth:
        method: private-key
    connectivity:
      via: frp
      host: 127.0.0.1
      port: 6001
  - id: build-y
    resource:
      kind: windows-device
    identity:
      login: Administrator
      auth:
        method: private-key
    connectivity:
      host: 127.0.0.1
      port: 6002
`

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-rt-handler-'))
  const targetsRoot = join(root, 'remote-targets')
  mkdirSync(targetsRoot)
  writeFileSync(join(targetsRoot, 'targets.yaml'), TARGETS, 'utf8')
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const context = (pathParams = {}) => ({
    dataDirectory: root,
    url: { pathParams },
    components: { get: () => undefined },
    credential: {
      async read() { throw new Error('该 handler 不应读取凭据') },
      async write() { throw new Error('该 handler 不应写入凭据') },
    },
    emit() {},
  })
  return { root, context }
}

test('组件只导出 component 与 operations，路由元数据显式声明', () => {
  assert.equal('api' in pkg, false)
  assert.equal('capabilities' in pkg, false)
  assert.equal(component.id, 'remote-targets')
  assert.equal(component.kind, 'locus')

  assert.deepEqual(
    operations.map((item) => [item.id, item.method, item.path, item.auth]).sort(),
    [
      ['rt.job.run', 'POST', '/:id/jobs', 'user'],
      ['rt.service.restart', 'POST', '/:id/services/:name/actions/restart', 'user'],
      ['rt.services.list', 'GET', '/:id/services', 'user'],
      ['rt.system.read', 'GET', '/:id/system', 'user'],
      ['rt.target.credential.update', 'POST', '/:id/actions/credential', 'root'],
      ['rt.target.get', 'GET', '/:id', 'user'],
      ['rt.target.migrate', 'POST', '/:id/actions/migrate', 'root'],
      ['rt.target.migration-source', 'GET', '/:id/actions/migration-source', 'user'],
      ['rt.target.preview', 'POST', '/:id/actions/preview', 'user'],
      ['rt.target.register', 'PUT', '/:id', 'root'],
      ['rt.target.remove', 'DELETE', '/:id', 'root'],
      ['rt.targets.list', 'GET', '', 'user'],
    ],
  )
  for (const item of operations) {
    assert.equal(typeof item.run, 'function')
    assert.equal('capability' in item, false)
    assert.equal('capabilities' in item, false)
  }
})

test('list/get/remove handler 只依赖 dataDirectory 与路径参数', async (t) => {
  const f = fixture(t)

  const listed = await list.run(undefined, undefined, f.context())
  assert.deepEqual(listed.map((target) => target.id), ['win-x', 'build-y'])

  const shown = await get.run(undefined, undefined, f.context({ id: 'win' }))
  assert.equal(shown.id, 'win-x')
  assert.equal(shown.identity.login, 'Administrator')

  await assert.rejects(
    async () => get.run(undefined, undefined, f.context({ id: 'unknown' })),
    (error) => error.code === 'not-found' && error.details.domain === 'target-not-found',
  )
  await assert.rejects(
    async () => get.run(undefined, undefined, f.context()),
    (error) => error.code === 'conflict' && error.details.domain === 'ambiguous-target',
  )

  const removed = await remove.run(undefined, undefined, f.context({ id: 'win-x' }))
  assert.deepEqual(removed, { target: 'win-x', removed: true })
  assert.deepEqual((await list.run(undefined, undefined, f.context())).map((target) => target.id), ['build-y'])
})

test('register handler 缺少秘密时不写入目标', async (t) => {
  const f = fixture(t)
  let written = false
  const context = f.context({ id: 'new-target' })
  context.credential.write = async () => {
    written = true
    return 'credential:new-target'
  }

  await assert.rejects(
    register.run(undefined, {
      spec: JSON.stringify({
        resource: { kind: 'server' },
        identity: { login: 'root', auth: { method: 'private-key' } },
        connectivity: { host: '192.0.2.1' },
      }),
    }, context),
    (error) => error.code === 'invalid-argument',
  )
  assert.equal(written, false)
  assert.deepEqual((await list.run(undefined, undefined, f.context())).map((target) => target.id), ['win-x', 'build-y'])
})
