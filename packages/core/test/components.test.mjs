import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { z } from 'zod'
import {
  ComponentFailure,
  createLocusCore,
  defineComponent,
  defineCredential,
  defineOperation,
  parseComponent,
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

function definedPackage(id, version = '1', extra = {}) {
  return defineComponent(packageSpec(id, version, extra))
}

function operation(extra = {}) {
  return defineOperation({
    id: 'demo.connect', method: 'GET', scheme: 'demo', authority: 'items', path: '/:id', auth: 'user',
    input: z.undefined(), output: z.unknown(),
    run: async () => 'connected',
    ...extra,
  })
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

test('defineComponent 把 operation 与可序列化规格分开', () => {
  const credential = defineCredential({
    id: 'demo-auth',
    fields: [{ name: 'token', secret: true, required: true }],
  })
  const defined = definedPackage('demo', '2', {
    operations: [operation()],
    credentials: [credential],
    info: { text: '说明' },
  })
  assert.equal(Object.isFrozen(defined.component), true)
  assert.equal(defined.component.operations.length, 1)
  assert.equal(defined.component.operations[0].id, 'demo.connect')
  assert.equal('run' in defined.component.operations[0], false)
  assert.equal(defined.component.credentials[0].id, 'demo-auth')
  assert.equal('input' in defined.component.credentials[0], false)
  assert.equal(defined.operations.length, 1)
  assert.equal(typeof defined.operations[0].run, 'function')

  const yaml = parseComponent(`
id: demo
version: '2'
name: Demo
summary: 示例
kind: locus
`)
  assert.equal(yaml.id, 'demo')
})

test('可编辑 YAML 拒绝 operations 与 credentials', () => {
  assert.throws(() => parseComponent(externalYaml('demo', 'operations: []')), failureCode('invalid-spec'))
  assert.throws(() => parseComponent(`
id: demo
version: '1'
name: Demo
summary: 示例
kind: locus
credentials: []
`), failureCode('invalid-spec'))
  const defined = definedPackage('demo', '1', {
    operations: [operation()],
    credentials: [defineCredential({ id: 'demo-auth', fields: [{ name: 'token', secret: true, required: true }] })],
  })
  assert.equal(defined.component.kind, 'locus')
})

test('operation 与凭据声明拒绝重复、非法 method 与缺少 schema', () => {
  assert.throws(() => definedPackage('demo', '1', { operations: [operation(), operation()] }), failureCode('invalid-spec'))
  assert.throws(() => definedPackage('demo', '1', { operations: [operation({ method: 'TRACE' })] }), failureCode('invalid-spec'))
  assert.throws(() => definedPackage('demo', '1', { operations: [operation({ auth: 'admin' })] }), failureCode('invalid-spec'))
  assert.throws(() => definedPackage('demo', '1', {
    operations: [defineOperation({
      id: 'demo.bad', method: 'GET', scheme: 'demo', authority: 'items', path: '/:id', auth: 'user',
      run: () => undefined,
    })],
  }), failureCode('invalid-spec'))
  assert.throws(() => defineCredential({ id: 'bad', fields: [{ name: 'x', secret: false, required: true }] }), /secret/)
})

test('external 组件不能声明 operations 或 credentials', () => {
  assert.throws(() => defineComponent({
    id: 'outside', version: '1', name: 'outside', summary: '外部', kind: 'external',
    operations: [operation()],
  }), failureCode('invalid-spec'))
})

test('包组件物化只写描述性元数据，operation 与凭据从代码合并', async (t) => {
  const setup = fixture(t)
  const credential = defineCredential({
    id: 'demo-auth',
    fields: [{ name: 'token', secret: true, required: true }],
  })
  const core = setup.open({
    components: [definedPackage('demo', '1', {
      operations: [operation()],
      credentials: [credential],
      config: { mode: 'demo' },
    })],
  })
  const view = core.components.show('demo')
  assert.equal(view.operations?.length, 1)
  assert.equal(view.credentials?.[0].id, 'demo-auth')
  const path = join(setup.dataDirectory, 'components', 'demo.yaml')
  const text = readFileSync(path, 'utf8')
  assert.equal(text.includes('operations'), false)
  assert.equal(text.includes('credentials'), false)
  assert.equal(text.includes('run:'), false)
})

test('upgrade 保留 config 并刷新版本；无 config 时回退代码定义', async (t) => {
  const setup = fixture(t)
  const first = definedPackage('demo', '1', { config: { mode: 'demo' }, operations: [operation()] })
  const core = setup.open({ components: [first] })
  core.components.show('demo')
  const path = join(setup.dataDirectory, 'components', 'demo.yaml')
  writeFileSync(path, readFileSync(path, 'utf8').replace(/version:.*/, "version: '0'"), 'utf8')
  const upgraded = core.components.upgrade('demo')
  assert.equal(upgraded.version, '1')
  assert.equal(readFileSync(path, 'utf8').includes('mode: demo'), true)
})

test('动态组件只接受 external YAML，删除只影响动态定义', async (t) => {
  const setup = fixture(t)
  const core = setup.open({ components: [definedPackage('demo')] })
  const added = core.components.addFromText(externalYaml('external-one'))
  assert.equal(added.id, 'external-one')
  assert.throws(() => core.components.addFromText(externalYaml('external-one')), failureCode('component-exists'))
  assert.throws(() => core.components.addFromText(`id: dynamic
version: '1'
name: Dynamic
summary: 动态
kind: locus
`), failureCode('invalid-spec'))
  core.components.remove('external-one')
  assert.equal(existsSync(join(setup.dataDirectory, 'components', 'external-one.yaml')), false)
  assert.throws(() => core.components.remove('demo'), failureCode('component-package'))
})

test('探针按退出、ENOENT 与超时分类，并跨重开保留状态', async (t) => {
  const setup = fixture(t)
  const runner = fakeRunner((argv) => {
    if (argv[0] === 'absent') return result({ exitCode: 1, errorCode: 'ENOENT' })
    if (argv[0] === 'slow') return result({ exitCode: 1, timedOut: true })
    if (argv[0] === 'stopped') return result({ exitCode: 3, stderr: 'stopped' })
    return result({ stdout: 'healthy output' })
  })
  const core = setup.open({ componentRunner: runner })
  core.components.addFromText(externalYaml('healthy'))
  core.components.addFromText(externalYaml('absent'))
  core.components.addFromText(externalYaml('slow', '  onFailure: stopped'))
  core.components.addFromText(externalYaml('stopped', '  onFailure: stopped'))
  assert.equal((await core.components.probe('healthy')).external.state, 'healthy')
  assert.equal((await core.components.probe('absent')).external.state, 'absent')
  assert.equal((await core.components.probe('slow')).external.state, 'abnormal')
  assert.equal((await core.components.probe('stopped')).external.state, 'stopped')
  await core.dispose()

  const reopened = setup.open({ components: [] })
  assert.equal(reopened.components.show('healthy').external.state, 'healthy')
})

test('locus 组件按 requires 派生外部状态，不执行探针', async (t) => {
  const setup = fixture(t)
  const runner = fakeRunner(() => result({ stdout: 'ok' }))
  const core = setup.open({
    componentRunner: runner,
    components: [
      definedPackage('dependency'),
      definedPackage('parent', '1', { requires: ['dependency'] }),
    ],
  })
  const view = await core.components.probe('parent')
  assert.equal(view.external.source, 'derived')
  assert.equal(runner.calls.length, 0)
})

test('部署命令记录成功与失败，未声明时明确拒绝', async (t) => {
  const setup = fixture(t)
  const runner = fakeRunner((argv) => (argv.includes('fail')
    ? result({ exitCode: 2, stderr: 'failed' })
    : result({ stdout: 'deployed' })))
  const core = setup.open({ componentRunner: runner })
  core.components.addFromText(`id: deployable
version: '1'
name: Deploy
summary: 可部署
kind: external
deploy:
  argv: [deploy]
`)
  assert.equal((await core.components.deploy('deployable')).deploy.state, 'deployed')
  core.components.addFromText(`id: failing
version: '1'
name: Failing
summary: 失败
kind: external
deploy:
  argv: [fail]
`)
  assert.equal((await core.components.deploy('failing')).deploy.state, 'failed')
  core.components.addFromText(externalYaml('plain'))
  await assert.rejects(core.components.deploy('plain'), failureCode('no-deploy'))
})

test('tcp 与 http 探针按连接与状态码分类', async (t) => {
  const setup = fixture(t)
  const tcp = createTcpServer((socket) => socket.end())
  await new Promise((resolve) => tcp.listen(0, '127.0.0.1', resolve))
  const http = createHttpServer((_request, response) => response.writeHead(204).end())
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    tcp.close()
    http.close()
  })
  const port = tcp.address().port
  const httpPort = http.address().port
  const core = setup.open()
  core.components.addFromText(`id: tcp-ok
version: '1'
name: TCP
summary: TCP
kind: external
probe:
  kind: tcp
  host: 127.0.0.1
  port: ${port}
`)
  core.components.addFromText(`id: http-ok
version: '1'
name: HTTP
summary: HTTP
kind: external
probe:
  kind: http
  url: http://127.0.0.1:${httpPort}/health
  expectStatus: 204
`)
  assert.equal((await core.components.probe('tcp-ok')).external.state, 'healthy')
  assert.equal((await core.components.probe('http-ok')).external.state, 'healthy')
})

test('释放后组件服务不可继续调用', async (t) => {
  const setup = fixture(t)
  const core = setup.open()
  await core.dispose()
  assert.throws(() => core.components.list(), /已释放/)
})
