import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  ComponentFailure,
  createLocusCore,
  defineComponent,
} from '../lib/index.js'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-components-'))
  const dataDirectory = join(root, 'data')
  const cores = []
  t.after(async () => {
    for (const core of cores) await core.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root,
    dataDirectory,
    open(options = {}) {
      const core = createLocusCore({ dataDirectory, ...options })
      cores.push(core)
      return core
    },
  }
}

function packageSpec(id, version = '1', extra = {}) {
  return {
    id,
    version,
    name: id,
    summary: `${id} 测试组件`,
    kind: 'locus',
    ...extra,
  }
}

function externalYaml(id, extra = '') {
  return `id: ${id}
version: '1'
name: ${id}
summary: ${id} 外部组件
kind: external
probe:
  argv: [${id}, --version]
${extra}`
}

function result(overrides = {}) {
  return {
    exitCode: 0,
    stdout: '',
    stderr: '',
    errorCode: null,
    timedOut: false,
    ...overrides,
  }
}

function fakeRunner(handler) {
  const calls = []
  return {
    calls,
    async run(argv, options) {
      calls.push({ argv, options })
      return handler(argv, options)
    },
  }
}

function failureCode(code) {
  return (error) => error instanceof ComponentFailure && error.code === code
}

test('defineComponent 接受对象与 YAML 并拒绝非法字段', () => {
  const source = {
    id: 'demo',
    version: '1',
    name: 'Demo',
    summary: '示例',
    kind: 'external',
    config: { mode: 'local' },
    probe: { argv: ['demo', '--version'], timeoutMs: 1000, onFailure: 'stopped' },
    deploy: { argv: ['demo', 'install'] },
    info: { text: 'hello' },
  }
  const fromObject = defineComponent(source)
  const fromYaml = defineComponent(`id: demo
version: '1'
name: Demo
summary: 示例
kind: external
config:
  mode: local
probe:
  argv: [demo, --version]
  timeoutMs: 1000
  onFailure: stopped
deploy:
  argv: [demo, install]
info:
  text: hello
`)
  assert.deepEqual(fromObject, fromYaml)
  assert.equal(Object.isFrozen(fromObject), true)
  assert.equal(Object.isFrozen(fromObject.probe), true)

  assert.throws(() => defineComponent({ ...source, extra: true }), failureCode('invalid-spec'))
  assert.throws(() => defineComponent({ ...source, id: 'Bad_ID' }), failureCode('invalid-spec'))
  assert.throws(
    () => defineComponent({ ...source, kind: 'locus', probe: source.probe }),
    failureCode('invalid-spec'),
  )
  assert.throws(
    () => defineComponent({ ...source, kind: 'locus', requires: ['demo'] }),
    failureCode('invalid-spec'),
  )
  assert.throws(
    () => defineComponent({ ...source, kind: 'locus', requires: ['other', 'other'] }),
    failureCode('invalid-spec'),
  )
  assert.throws(
    () => defineComponent({ ...source, config: '/absolute/path' }),
    failureCode('invalid-spec'),
  )
  assert.throws(
    () => defineComponent({ ...source, config: '../escape' }),
    failureCode('invalid-spec'),
  )
  assert.throws(
    () => defineComponent({ ...source, probe: { argv: [] } }),
    failureCode('invalid-spec'),
  )
  assert.throws(
    () => defineComponent({ ...source, probe: { argv: ['demo'], onFailure: 'maybe' } }),
    failureCode('invalid-spec'),
  )
  assert.throws(
    () => defineComponent({ ...source, probe: { kind: 'tcp', host: '127.0.0.1', port: 0 } }),
    failureCode('invalid-spec'),
  )
  assert.throws(
    () => defineComponent({ ...source, probe: { kind: 'http', url: 'ftp://example.com' } }),
    failureCode('invalid-spec'),
  )
  assert.throws(
    () => defineComponent({
      ...source,
      probe: { kind: 'tcp', host: '127.0.0.1', port: 1, argv: ['demo'] },
    }),
    failureCode('invalid-spec'),
  )
  assert.throws(
    () => defineComponent({ ...source, probe: { kind: 'udp', host: '127.0.0.1', port: 1 } }),
    failureCode('invalid-spec'),
  )
  for (const id of ['version', 'workspace', 'component', 'shell', 'help', 'rt']) {
    assert.throws(() => defineComponent({ ...source, id }), failureCode('invalid-spec'))
  }
  assert.equal(
    defineComponent({ id: 'template', version: '1', name: '模板', summary: '模板', kind: 'locus' }).id,
    'template',
  )
  assert.throws(
    () => defineComponent({ ...source, info: { text: 'a', json: { b: 1 } } }),
    failureCode('invalid-spec'),
  )
  assert.throws(() => defineComponent('id: [unclosed'), failureCode('invalid-spec'))
  assert.throws(() => defineComponent(''), failureCode('invalid-spec'))
  assert.throws(
    () => createLocusCore({ dataDirectory: 'relative', components: [source] }),
    /absolute|绝对路径/,
  )
})

test('包组件在首次访问时物化，版本不一致只标记需要升级', async (t) => {
  const setup = fixture(t)
  const first = setup.open({ components: [packageSpec('alpha', '1')] })
  assert.equal(existsSync(setup.dataDirectory), false)
  const listed = first.components.list()
  assert.deepEqual(listed.components.map((view) => view.id), ['alpha'])
  assert.equal(listed.components[0].needsUpgrade, false)
  assert.equal(existsSync(join(setup.dataDirectory, 'components', 'alpha.yaml')), true)

  const second = setup.open({ components: [packageSpec('alpha', '2')] })
  const pending = second.components.show('alpha')
  assert.equal(pending.version, '1')
  assert.equal(pending.codeVersion, '2')
  assert.equal(pending.needsUpgrade, true)
  const onDisk = defineComponent(
    readFileSync(join(setup.dataDirectory, 'components', 'alpha.yaml'), 'utf8'),
  )
  assert.equal(onDisk.version, '1')

  const upgraded = second.components.upgrade('alpha')
  assert.equal(upgraded.version, '2')
  assert.equal(upgraded.needsUpgrade, false)
  assert.equal(upgraded.codeVersion, '2')
})

test('upgrade 保留 config，删除物化文件后按当前版本重建', async (t) => {
  const setup = fixture(t)
  const core = setup.open({
    components: [packageSpec('alpha', '1', { config: 'alpha-config/' })],
  })
  core.components.list()
  const file = join(setup.dataDirectory, 'components', 'alpha.yaml')
  const before = readFileSync(file, 'utf8')
  assert.match(before, /config: alpha-config\//)
  writeFileSync(file, before.replace('alpha-config/', 'custom-config/'), 'utf8')

  const next = setup.open({
    components: [packageSpec('alpha', '2', { config: 'alpha-config/' })],
  })
  const upgraded = next.components.upgrade('alpha')
  assert.equal(upgraded.configPath, join(setup.dataDirectory, 'custom-config'))
  const text = readFileSync(file, 'utf8')
  assert.match(text, /version: "2"/)
  assert.match(text, /custom-config\//)

  rmSync(file)
  const recreated = next.components.show('alpha')
  assert.equal(recreated.version, '2')
  assert.equal(existsSync(file), true)
})

test('损坏或冲突的定义只影响该组件，不阻断其他组件', async (t) => {
  const setup = fixture(t)
  const core = setup.open({
    components: [packageSpec('alpha'), packageSpec('beta')],
  })
  core.components.list()
  const beta = join(setup.dataDirectory, 'components', 'beta.yaml')
  writeFileSync(beta, 'id: [broken', 'utf8')

  const listed = core.components.list()
  assert.deepEqual(listed.components.map((view) => view.id), ['alpha'])
  assert.equal(listed.problems.length, 1)
  assert.equal(listed.problems[0].id, 'beta')
  assert.match(listed.problems[0].error, /YAML|解析/)
  assert.throws(() => core.components.show('beta'), failureCode('invalid-definition'))

  writeFileSync(beta, packageSpecYaml('beta'), 'utf8')
  const folder = join(setup.dataDirectory, 'components', 'beta')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'component.yaml'), packageSpecYaml('beta'), 'utf8')
  const conflicted = core.components.list()
  assert.equal(conflicted.problems.some((problem) => problem.id === 'beta'), true)
  assert.match(
    conflicted.problems.find((problem) => problem.id === 'beta').error,
    /同时存在/,
  )
})

function packageSpecYaml(id) {
  return `id: ${id}
version: '1'
name: ${id}
summary: ${id} 测试组件
kind: locus
`
}

test('动态组件可添加文件夹与文本，只能删除动态组件', async (t) => {
  const setup = fixture(t)
  const core = setup.open({ components: [packageSpec('alpha')] })
  core.components.list()

  const added = core.components.addFromText(externalYaml('ext'))
  assert.equal(added.source, 'dynamic')
  assert.equal(added.external.state, null)
  assert.equal(existsSync(join(setup.dataDirectory, 'components', 'ext.yaml')), true)
  assert.throws(() => core.components.addFromText(externalYaml('ext')), failureCode('component-exists'))
  assert.throws(
    () => core.components.addFromText(packageSpecYaml('locus-only')),
    failureCode('invalid-spec'),
  )
  assert.throws(
    () => core.components.addFromText(externalYaml('alpha')),
    failureCode('component-package'),
  )
  assert.throws(() => core.components.remove('alpha'), failureCode('component-package'))
  assert.throws(() => core.components.remove('missing'), failureCode('component-not-found'))

  const folder = join(setup.root, 'ext-folder')
  mkdirSync(folder)
  writeFileSync(join(folder, 'component.yaml'), externalYaml('ext-folder'), 'utf8')
  writeFileSync(join(folder, 'settings.txt'), 'value', 'utf8')
  const copied = core.components.addFromPath(folder)
  assert.equal(copied.id, 'ext-folder')
  assert.equal(
    readFileSync(join(setup.dataDirectory, 'components', 'ext-folder', 'settings.txt'), 'utf8'),
    'value',
  )
  core.components.remove('ext-folder')
  assert.equal(existsSync(join(setup.dataDirectory, 'components', 'ext-folder')), false)

  core.components.remove('ext')
  assert.equal(existsSync(join(setup.dataDirectory, 'components', 'ext.yaml')), false)
  assert.equal(core.components.list().components.some((view) => view.id === 'ext'), false)
})

test('探针按退出、ENOENT、超时分类并跨进程保留状态', async (t) => {
  const setup = fixture(t)
  const runner = fakeRunner((argv) => {
    if (argv[0] === 'down') return result({ exitCode: 1, stderr: 'daemon down' })
    if (argv[0] === 'ghost') return result({ exitCode: 1, errorCode: 'ENOENT' })
    if (argv[0] === 'slow') return result({ timedOut: true, exitCode: 1 })
    return result({ stdout: 'ok' })
  })
  const core = setup.open({ componentRunner: runner })
  core.components.addFromText(`id: up
version: '1'
name: up
summary: up
kind: external
probe:
  argv: [up]
`)
  core.components.addFromText(`id: down
version: '1'
name: down
summary: down
kind: external
probe:
  argv: [down]
  onFailure: stopped
`)
  core.components.addFromText(externalYaml('ghost'))
  core.components.addFromText(externalYaml('slow'))

  assert.equal((await core.components.probe('up')).external.state, 'healthy')
  assert.equal((await core.components.probe('down')).external.state, 'stopped')
  const ghost = await core.components.probe('ghost')
  assert.equal(ghost.external.state, 'absent')
  assert.match(ghost.external.detail, /ghost/)
  assert.equal((await core.components.probe('slow')).external.state, 'abnormal')

  const reopened = setup.open()
  const persisted = reopened.components.show('down')
  assert.equal(persisted.external.state, 'stopped')
  assert.match(persisted.external.detail, /daemon down/)
  assert.ok(persisted.external.checkedAt)
})

test('locus 组件按 requires 派生外部状态，不执行探针', async (t) => {
  const setup = fixture(t)
  const runner = fakeRunner(() => result({ exitCode: 1, errorCode: 'ENOENT' }))
  const core = setup.open({
    components: [
      packageSpec('app', '1', { requires: ['dep'] }),
      packageSpec('solo'),
      packageSpec('ghosted', '1', { requires: ['ghost'] }),
    ],
    componentRunner: runner,
  })
  core.components.addFromText(externalYaml('dep'))
  core.components.addFromText(`id: noprobe
version: '1'
name: noprobe
summary: noprobe
kind: external
`)
  assert.equal(core.components.show('app').external.state, null)
  assert.match(core.components.show('app').external.detail, /未探查/)

  const probed = await core.components.probe('app')
  assert.equal(runner.calls.length, 0)
  assert.equal(probed.external.state, null)

  await core.components.probe('dep')
  const derived = core.components.show('app')
  assert.equal(derived.external.state, 'absent')
  assert.equal(derived.external.source, 'derived')

  const missing = core.components.show('ghosted')
  assert.equal(missing.external.state, null)
  assert.match(missing.external.detail, /未登记依赖：ghost/)

  await assert.rejects(core.components.probe('solo'), failureCode('no-external'))
  await assert.rejects(core.components.probe('noprobe'), failureCode('no-probe'))
})

test('部署命令记录成功与失败，未声明时明确拒绝', async (t) => {
  const setup = fixture(t)
  let mode = 'ok'
  const runner = fakeRunner(() => (mode === 'ok' ? result({ stdout: 'installed' }) : result({ exitCode: 2, stderr: 'nope' })))
  const core = setup.open({ componentRunner: runner })
  core.components.addFromText(`id: deployable
version: '1'
name: deployable
summary: deployable
kind: external
deploy:
  argv: [installer]
`)
  core.components.addFromText(externalYaml('plain'))

  assert.equal(core.components.show('deployable').deploy.state, 'not-deployed')
  assert.equal((await core.components.deploy('deployable')).deploy.state, 'deployed')
  mode = 'fail'
  assert.equal((await core.components.deploy('deployable')).deploy.state, 'failed')
  await assert.rejects(core.components.deploy('plain'), failureCode('no-deploy'))
  assert.equal(core.components.show('plain').deploy.state, 'not-deployable')

  const reopened = setup.open()
  assert.equal(reopened.components.show('deployable').deploy.state, 'failed')
})

test('tcp 与 http 探针按连接与状态码分类', async (t) => {
  const setup = fixture(t)
  const core = setup.open()
  const tcp = createTcpServer((socket) => socket.end())
  await new Promise((resolve) => tcp.listen(0, '127.0.0.1', resolve))
  const tcpPort = tcp.address().port
  const http = createHttpServer((request, response) => {
    response.statusCode = request.url === '/ok' ? 200 : 503
    response.end('ok')
  })
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve))
  const httpPort = http.address().port
  t.after(() => {
    if (tcp.listening) tcp.close()
    if (http.listening) http.close()
  })

  core.components.addFromText(`id: tcp-up
version: '1'
name: tcp-up
summary: tcp
kind: external
probe:
  kind: tcp
  host: 127.0.0.1
  port: ${tcpPort}
  timeoutMs: 3000
  onFailure: stopped
`)
  const up = await core.components.probe('tcp-up')
  assert.equal(up.external.state, 'healthy')
  assert.match(up.external.detail, new RegExp(String(tcpPort)))

  await new Promise((resolve) => tcp.close(resolve))
  const down = await core.components.probe('tcp-up')
  assert.equal(down.external.state, 'stopped')
  assert.match(down.external.detail, /ECONNREFUSED|拒绝/)

  core.components.addFromText(`id: http-up
version: '1'
name: http-up
summary: http
kind: external
probe:
  kind: http
  url: http://127.0.0.1:${httpPort}/ok
  timeoutMs: 3000
  onFailure: stopped
`)
  assert.equal((await core.components.probe('http-up')).external.state, 'healthy')

  core.components.addFromText(`id: http-bad
version: '1'
name: http-bad
summary: http
kind: external
probe:
  kind: http
  url: http://127.0.0.1:${httpPort}/bad
  expectStatus: 200
  onFailure: stopped
`)
  const bad = await core.components.probe('http-bad')
  assert.equal(bad.external.state, 'stopped')
  assert.match(bad.external.detail, /503/)

  await new Promise((resolve) => {
    http.close(resolve)
    http.closeAllConnections()
  })
  assert.equal((await core.components.probe('http-up')).external.state, 'stopped')
})

test('释放后组件服务不可继续调用', async (t) => {
  const setup = fixture(t)
  const core = setup.open({ components: [packageSpec('alpha')] })
  const components = core.components
  components.list()
  await core.dispose()
  assert.throws(() => components.list(), /已释放/)
})

test('v2 数据库迁移到 v3 并保留 Workspace', async (t) => {
  const setup = fixture(t)
  mkdirSync(setup.dataDirectory, { recursive: true })
  const database = new DatabaseSync(join(setup.dataDirectory, 'core.sqlite'))
  database.exec(`
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE relations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      kind TEXT NOT NULL CHECK (kind IN ('member', 'association')),
      target_namespace TEXT NOT NULL CHECK (length(trim(target_namespace)) > 0),
      target_id TEXT NOT NULL CHECK (length(trim(target_id)) > 0),
      source_kind TEXT NOT NULL CHECK (source_kind IN ('manual', 'discovery')),
      source_detail TEXT NOT NULL CHECK (length(trim(source_detail)) > 0),
      created_at TEXT NOT NULL,
      UNIQUE (workspace_id, kind, target_namespace, target_id)
    ) STRICT;
    CREATE TABLE mounts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      name_key TEXT NOT NULL CHECK (length(trim(name_key)) > 0),
      path TEXT NOT NULL CHECK (length(trim(path)) > 0),
      path_key TEXT NOT NULL CHECK (length(trim(path_key)) > 0),
      created_at TEXT NOT NULL,
      UNIQUE (workspace_id, name_key),
      UNIQUE (workspace_id, path_key)
    ) STRICT;
    INSERT INTO workspaces VALUES ('ws-1', '迁移前', '2026-11-15T00:00:00.000Z');
    PRAGMA user_version = 2;
  `)
  database.close()

  const core = setup.open({ components: [packageSpec('alpha')] })
  assert.equal(core.workspaces.list()[0].name, '迁移前')
  const reopened = new DatabaseSync(join(setup.dataDirectory, 'core.sqlite'))
  assert.equal(reopened.prepare('PRAGMA user_version').get().user_version, 3)
  assert.equal(
    reopened.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'component_states'").get() !== undefined,
    true,
  )
  reopened.close()
})
