import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ComponentFailure,
  createLocusCore,
  defineComponent,
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

function plainCapability(extra = {}) {
  return { id: 'connect', resourceType: 'database', ...extra }
}

function capability(extra = {}) {
  return { ...plainCapability(), run: async () => 'connected', ...extra }
}

function plainCredential(extra = {}) {
  return {
    id: 'database-auth',
    fields: [{ name: 'password', secret: true, required: true }],
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

function packageSpecYaml(id) {
  return `id: ${id}
version: '1'
name: ${id}
summary: ${id} 测试组件
kind: locus
`
}

function readSpec(path) {
  return parseComponent(readFileSync(path, 'utf8'))
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

test('defineComponent 返回可序列化组件，YAML 由 parseComponent 解析', () => {
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
  const { component, api } = defineComponent(source)
  assert.deepEqual(component, source)
  assert.deepEqual(api, {})
  assert.equal(Object.isFrozen(component), true)
  assert.equal(Object.isFrozen(component.probe), true)
  assert.equal(Object.isFrozen(component.config), true)
  assert.equal(Object.isFrozen(api), true)

  const fromYaml = parseComponent(`id: demo
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
  assert.deepEqual(fromYaml, component)

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
  for (const id of ['version', 'workspace', 'component', 'shell', 'help', 'rt', 'init', 'security', 'credential']) {
    assert.throws(() => defineComponent({ ...source, id }), failureCode('invalid-spec'))
  }
  assert.equal(
    defineComponent({ id: 'template', version: '1', name: '模板', summary: '模板', kind: 'locus' }).component.id,
    'template',
  )
  assert.throws(
    () => defineComponent({ ...source, info: { text: 'a', json: { b: 1 } } }),
    failureCode('invalid-spec'),
  )
  assert.throws(() => parseComponent('id: [unclosed'), failureCode('invalid-spec'))
  assert.throws(() => parseComponent(''), failureCode('invalid-spec'))
  assert.throws(() => parseComponent(null), /不能为空/)
  // defineComponent 只接受对象；YAML 文本必须走 parseComponent。
  assert.throws(() => defineComponent(packageSpecYaml('from-text')), failureCode('invalid-spec'))
  assert.throws(
    () => createLocusCore({ dataDirectory: 'relative', components: [source] }),
    /absolute|绝对路径/,
  )
})

test('defineComponent 单独交付本地能力表，序列化组件不包含 handler', () => {
  const connect = async () => 'connected'
  const inspect = () => 'inspected'
  const source = packageSpec('demo', '1', {
    capabilities: [
      {
        id: 'connect',
        resourceType: 'database',
        defaultAuthLevel: 'user',
        secrets: [{ slot: 'database-auth', access: 'read' }],
        run: connect,
      },
      { id: 'database.inspect', resourceType: 'database', run: inspect },
    ],
    credentials: [plainCredential()],
  })
  const { component, api } = defineComponent(source)
  assert.deepEqual(component.capabilities, [
    {
      id: 'connect',
      resourceType: 'database',
      defaultAuthLevel: 'user',
      secrets: [{ slot: 'database-auth', access: 'read' }],
    },
    { id: 'database.inspect', resourceType: 'database' },
  ])
  assert.equal('run' in component.capabilities[0], false)
  assert.deepEqual(Object.keys(api), ['connect', 'database.inspect'])
  assert.equal(api.connect, connect)
  assert.equal(api['database.inspect'], inspect)
  assert.equal(Object.isFrozen(api), true)
  assert.equal(Object.isFrozen(component.capabilities), true)
  assert.equal(Object.isFrozen(component.capabilities[0]), true)
  assert.equal(Object.isFrozen(component.capabilities[0].secrets), true)
  assert.equal(Object.isFrozen(component.capabilities[0].secrets[0]), true)
  assert.throws(() => { component.capabilities.push({ id: 'more', resourceType: 'database' }) }, TypeError)
  assert.throws(() => { component.capabilities[0].defaultAuthLevel = 'root' }, TypeError)
  assert.throws(() => { component.capabilities[0].secrets[0].access = 'write' }, TypeError)
  source.capabilities[0].secrets[0].slot = 'changed'
  assert.equal(component.capabilities[0].secrets[0].slot, 'database-auth')
  assert.deepEqual(
    parseComponent(JSON.parse(JSON.stringify(component)), { allowCapabilities: true }),
    component,
  )
  assert.deepEqual(
    parseComponent({ ...packageSpec('explicit'), capabilities: [plainCapability()] }, { allowCapabilities: true })
      .capabilities,
    [plainCapability()],
  )

  const empty = defineComponent(packageSpec('empty', '1', { capabilities: [] }))
  assert.deepEqual(empty.component.capabilities, [])
  assert.deepEqual(Object.keys(empty.api), [])
  const plain = defineComponent(packageSpec('plain'))
  assert.equal('capabilities' in plain.component, false)
  assert.deepEqual(plain.api, {})
})

test('能力声明拒绝带冒号的全局 id、非法结构与重复声明', () => {
  for (const capabilities of [null, {}, 'connect', [null], [[]]]) {
    assert.throws(
      () => defineComponent(packageSpec('invalid', '1', { capabilities })),
      failureCode('invalid-spec'),
    )
  }

  for (const id of ['connect', 'database.connect', 'database-connect', 'a1.b2-c3']) {
    assert.equal(
      defineComponent(packageSpec('valid', '1', { capabilities: [capability({ id })] }))
        .component.capabilities[0].id,
      id,
    )
  }

  const invalidCapabilities = [
    plainCapability({ id: 'database:local:connect' }),
    plainCapability({ id: 'connect:now' }),
    plainCapability({ id: '' }),
    plainCapability({ id: 'Connect' }),
    plainCapability({ id: ' database' }),
    plainCapability({ id: 'database::connect' }),
    plainCapability({ id: 'connect all' }),
    plainCapability({ id: 'connect_thing' }),
    plainCapability({ id: 'connect-' }),
    plainCapability({ id: '1connect' }),
    plainCapability({ id: undefined }),
    plainCapability({ resourceType: undefined }),
    plainCapability({ resourceType: '' }),
    plainCapability({ resourceType: 'Database' }),
    plainCapability({ resourceType: 'database_x' }),
    plainCapability({ resourceType: 'database type' }),
    plainCapability({ defaultAuthLevel: 'admin' }),
    plainCapability({ defaultAuthLevel: 'Root' }),
    plainCapability({ defaultAuthLevel: true }),
    plainCapability({ secrets: 'read' }),
    plainCapability({ secrets: [null] }),
    plainCapability({ secrets: [[]] }),
    plainCapability({ secrets: [{ slot: 'database-auth' }] }),
    plainCapability({ secrets: [{ slot: 'database-auth', access: 'execute' }] }),
    plainCapability({ secrets: [{ slot: 'database-auth', access: 'read', extra: true }] }),
    plainCapability({ secrets: [{ slot: 'Database', access: 'read' }] }),
    plainCapability({ secrets: [{ slot: 'database_auth', access: 'read' }] }),
    plainCapability({
      secrets: [
        { slot: 'database-auth', access: 'read' },
        { slot: 'database-auth', access: 'write' },
      ],
    }),
    plainCapability({ unknown: true }),
  ]
  for (const invalidCapability of invalidCapabilities) {
    assert.throws(
      () => defineComponent(packageSpec('invalid', '1', { capabilities: [capability(invalidCapability)] })),
      failureCode('invalid-spec'),
    )
  }

  // handler 是可信定义的组成部分，不能在序列化组件里出现。
  assert.throws(
    () => defineComponent(packageSpec('invalid', '1', { capabilities: [plainCapability()] })),
    failureCode('invalid-spec'),
  )
  assert.throws(
    () => defineComponent(packageSpec('invalid', '1', { capabilities: [capability({ run: 'connect' })] })),
    failureCode('invalid-spec'),
  )
  assert.throws(
    () => parseComponent(
      { ...packageSpec('invalid'), capabilities: [capability()] },
      { allowCapabilities: true },
    ),
    failureCode('invalid-spec'),
  )

  for (const duplicate of [
    plainCapability(),
    plainCapability({ defaultAuthLevel: 'root' }),
  ]) {
    assert.throws(
      () => defineComponent(packageSpec('duplicate', '1', { capabilities: [capability(), capability(duplicate)] })),
      failureCode('invalid-spec'),
    )
  }

  assert.throws(
    () => defineComponent(packageSpec('invalid', '1', {
      capabilities: [capability({ secrets: [{ slot: 'missing', access: 'read' }] })],
      credentials: [plainCredential()],
    })),
    failureCode('invalid-spec'),
  )
  assert.throws(
    () => defineComponent(packageSpec('invalid', '1', {
      capabilities: [capability({ secrets: [{ slot: 'database-auth', access: 'read' }] })],
    })),
    failureCode('invalid-spec'),
  )

  const shared = defineComponent(packageSpec('shared', '1', {
    capabilities: [
      capability({ secrets: [{ slot: 'database-auth', access: 'read' }] }),
      capability({ id: 'manage', secrets: [{ slot: 'database-auth', access: 'write' }] }),
    ],
    credentials: [plainCredential()],
  }))
  assert.deepEqual(shared.component.capabilities.map((value) => value.id), ['connect', 'manage'])

  assert.throws(
    () => defineComponent(packageSpecYaml('invalid')),
    failureCode('invalid-spec'),
  )
})

test('凭据槽只声明字段结构，拒绝 kind/capability 与非法字段', () => {
  const full = {
    id: 'database-auth',
    fields: [
      { name: 'username', secret: false, required: true },
      { name: 'password', secret: true, required: true },
      { name: 'remark', secret: false, required: false },
    ],
  }
  const defined = defineComponent(packageSpec('demo', '1', { credentials: [full] }))
  assert.deepEqual(defined.component.credentials, [full])
  assert.equal(Object.isFrozen(defined.component.credentials), true)
  assert.equal(Object.isFrozen(defined.component.credentials[0]), true)
  assert.equal(Object.isFrozen(defined.component.credentials[0].fields), true)
  assert.equal('kind' in defined.component.credentials[0], false)
  assert.equal('capability' in defined.component.credentials[0], false)

  const invalidCredentials = [
    null,
    {},
    'password',
    [null],
    [[]],
    [plainCredential({ id: 'Database' })],
    [plainCredential({ id: 'database_auth' })],
    [plainCredential({ id: 'database:auth' })],
    [plainCredential({ kind: 'password' })],
    [plainCredential({ capability: 'connect' })],
    [plainCredential({ fields: [] })],
    [plainCredential({ fields: null })],
    [plainCredential({ fields: [{ name: 'Password', secret: true, required: true }] })],
    [plainCredential({ fields: [{ name: 'pass_word', secret: true, required: true }] })],
    [plainCredential({ fields: [{ name: 'password', secret: 'yes', required: true }] })],
    [plainCredential({ fields: [{ name: 'password', secret: true, required: 'yes' }] })],
    [plainCredential({ fields: [{ name: 'password', secret: true, required: true, extra: true }] })],
    [plainCredential({ fields: [{ name: 'username', secret: false, required: true }] })],
    [plainCredential({
      fields: [
        { name: 'password', secret: true, required: true },
        { name: 'password', secret: true, required: true },
      ],
    })],
    [plainCredential(), plainCredential()],
  ]
  for (const credentials of invalidCredentials) {
    assert.throws(
      () => defineComponent(packageSpec('invalid', '1', { credentials })),
      failureCode('invalid-spec'),
    )
  }
  assert.deepEqual(
    defineComponent(packageSpec('plain', '1', { credentials: [full] })).component.credentials,
    [full],
  )
  assert.throws(
    () => defineComponent({ ...packageSpec('external', '1'), kind: 'external', credentials: [full] }),
    failureCode('invalid-spec'),
  )
})

test('可编辑 YAML 拒绝 capabilities 与 credentials，external 不携带能力', () => {
  const capabilityYaml = `id: demo
version: '1'
name: demo
summary: demo
kind: locus
capabilities:
  - id: connect
    resourceType: database
    defaultAuthLevel: user
    secrets:
      - slot: database-auth
        access: read
`
  const credentialYaml = `id: demo
version: '1'
name: demo
summary: demo
kind: locus
credentials:
  - id: database-auth
    fields:
      - name: password
        secret: true
        required: true
`
  for (const text of [capabilityYaml, credentialYaml]) {
    assert.throws(() => parseComponent(text), failureCode('invalid-spec'))
  }
  assert.throws(
    () => parseComponent({ ...packageSpec('demo'), capabilities: [plainCapability()] }),
    failureCode('invalid-spec'),
  )
  assert.throws(
    () => parseComponent({ ...packageSpec('demo'), credentials: [plainCredential()] }),
    failureCode('invalid-spec'),
  )

  const external = parseComponent(externalYaml('ext'))
  assert.equal(external.kind, 'external')
  assert.equal('capabilities' in external, false)
  assert.equal('credentials' in external, false)
  assert.throws(
    () => defineComponent({
      ...packageSpec('external', '1'),
      kind: 'external',
      capabilities: [capability()],
    }),
    failureCode('invalid-spec'),
  )
  assert.throws(
    () => parseComponent(`id: ext
version: '1'
name: ext
summary: ext
kind: external
capabilities:
  - id: connect
    resourceType: database
`),
    failureCode('invalid-spec'),
  )
})

test('包组件物化只写可序列化元数据，能力与凭据不进入 YAML', async (t) => {
  const setup = fixture(t)
  const alpha = definedPackage('alpha', '1', {
    capabilities: [capability({ secrets: [{ slot: 'database-auth', access: 'read' }] })],
    credentials: [plainCredential()],
  })
  const first = setup.open({ components: [alpha.component] })
  assert.equal(existsSync(setup.dataDirectory), false)
  const listed = first.components.list()
  assert.deepEqual(listed.components.map((view) => view.id), ['alpha'])
  assert.equal(listed.components[0].needsUpgrade, false)
  assert.deepEqual(listed.components[0].capabilities.map((item) => item.id), ['connect'])
  assert.deepEqual(listed.components[0].credentials.map((item) => item.id), ['database-auth'])
  const file = join(setup.dataDirectory, 'components', 'alpha.yaml')
  assert.equal(existsSync(file), true)
  const text = readFileSync(file, 'utf8')
  assert.equal(text.includes('capabilities'), false)
  assert.equal(text.includes('credentials'), false)
  const materialized = parseComponent(text)
  assert.equal(materialized.version, '1')
  assert.equal('capabilities' in materialized, false)
  assert.equal('credentials' in materialized, false)
  assert.deepEqual(Object.keys(alpha.api), ['connect'])

  const second = setup.open({
    components: [
      definedPackage('alpha', '2', {
        summary: 'alpha 升级版本',
        capabilities: [capability({ id: 'manage' })],
        credentials: [plainCredential({ id: 'database-manage' })],
      }).component,
    ],
  })
  const pending = second.components.show('alpha')
  assert.equal(pending.version, '1')
  assert.equal(pending.codeVersion, '2')
  assert.equal(pending.needsUpgrade, true)
  assert.equal(readSpec(file).version, '1')

  const upgraded = second.components.upgrade('alpha')
  assert.equal(upgraded.version, '2')
  assert.equal(upgraded.needsUpgrade, false)
  assert.equal(upgraded.codeVersion, '2')
  assert.deepEqual(upgraded.capabilities.map((item) => item.id), ['manage'])
  assert.deepEqual(upgraded.credentials.map((item) => item.id), ['database-manage'])
  const persisted = readSpec(file)
  assert.equal(persisted.version, '2')
  assert.equal('capabilities' in persisted, false)
  assert.equal('credentials' in persisted, false)

  const reopened = setup.open({
    components: [
      definedPackage('alpha', '2', {
        summary: 'alpha 升级版本',
        capabilities: [capability({ id: 'manage' })],
        credentials: [plainCredential({ id: 'database-manage' })],
      }).component,
    ],
  })
  assert.equal(reopened.components.show('alpha').needsUpgrade, false)

  rmSync(file)
  const recreated = second.components.show('alpha')
  assert.equal(recreated.version, '2')
  assert.equal(existsSync(file), true)
  const rematerialized = readSpec(file)
  assert.equal(rematerialized.version, '2')
  assert.equal('capabilities' in rematerialized, false)
})

test('upgrade 保留 config，删除物化文件后按当前版本重建', async (t) => {
  const setup = fixture(t)
  const core = setup.open({
    components: [
      definedPackage('alpha', '1', {
        config: 'alpha-config/',
        capabilities: [capability()],
        credentials: [plainCredential()],
      }).component,
    ],
  })
  core.components.list()
  const file = join(setup.dataDirectory, 'components', 'alpha.yaml')
  const before = readSpec(file)
  assert.equal(before.config, 'alpha-config/')
  writeFileSync(file, JSON.stringify({ ...before, config: 'custom-config/' }), 'utf8')

  const next = setup.open({
    components: [
      definedPackage('alpha', '2', {
        config: 'alpha-config/',
        capabilities: [capability({ id: 'manage' })],
        credentials: [plainCredential()],
      }).component,
    ],
  })
  assert.equal(next.components.show('alpha').needsUpgrade, true)
  assert.equal(readSpec(file).version, '1')
  const upgraded = next.components.upgrade('alpha')
  assert.equal(upgraded.version, '2')
  assert.equal(upgraded.configPath, join(setup.dataDirectory, 'custom-config'))
  const persisted = readSpec(file)
  assert.equal(persisted.version, '2')
  assert.equal(persisted.config, 'custom-config/')
  assert.equal('capabilities' in persisted, false)

  const reopened = setup.open({
    components: [
      definedPackage('alpha', '2', {
        config: 'alpha-config/',
        capabilities: [capability({ id: 'manage' })],
        credentials: [plainCredential()],
      }).component,
    ],
  })
  assert.equal(reopened.components.show('alpha').needsUpgrade, false)

  rmSync(file)
  const recreated = next.components.show('alpha')
  assert.equal(recreated.version, '2')
  assert.equal(existsSync(file), true)
  assert.equal(readSpec(file).config, 'alpha-config/')
})

test('升级保留内联 config，能力变更不进入 YAML', async (t) => {
  const setup = fixture(t)
  const originalConfig = { database: { host: 'localhost', ports: [5432] } }
  const core = setup.open({
    components: [
      definedPackage('alpha', '1', {
        config: originalConfig,
        capabilities: [capability()],
        credentials: [plainCredential()],
      }).component,
    ],
  })
  core.components.list()
  const next = setup.open({
    components: [
      definedPackage('alpha', '2', {
        config: { database: { host: 'package-default' } },
        capabilities: [capability({ id: 'manage' })],
        credentials: [plainCredential({ id: 'database-manage' })],
      }).component,
    ],
  })
  next.components.upgrade('alpha')
  const upgraded = readSpec(join(setup.dataDirectory, 'components', 'alpha.yaml'))
  assert.deepEqual(upgraded.config, originalConfig)
  assert.equal(upgraded.version, '2')
  assert.equal('capabilities' in upgraded, false)
  assert.equal('credentials' in upgraded, false)
})

test('动态组件只接受 external YAML，能力与凭据不能在运行时声明', async (t) => {
  const setup = fixture(t)
  const core = setup.open({ components: [definedPackage('alpha').component] })
  core.components.list()

  const added = core.components.addFromText(externalYaml('ext'))
  assert.equal(added.source, 'dynamic')
  assert.equal(added.external.state, null)
  assert.equal('capabilities' in added, false)
  assert.equal('credentials' in added, false)
  const extFile = join(setup.dataDirectory, 'components', 'ext.yaml')
  assert.equal(existsSync(extFile), true)
  assert.equal(readSpec(extFile).kind, 'external')

  assert.throws(
    () => core.components.addFromText(`id: ext-caps
version: '1'
name: ext-caps
summary: ext-caps
kind: external
capabilities:
  - id: connect
    resourceType: database
`),
    failureCode('invalid-spec'),
  )
  assert.throws(
    () => core.components.addFromText(JSON.stringify({
      ...packageSpec('ext-credentials'),
      kind: 'external',
      credentials: [plainCredential()],
    })),
    failureCode('invalid-spec'),
  )
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
  assert.equal('capabilities' in copied, false)
  assert.equal(
    readFileSync(join(setup.dataDirectory, 'components', 'ext-folder', 'settings.txt'), 'utf8'),
    'value',
  )
  core.components.remove('ext-folder')
  assert.equal(existsSync(join(setup.dataDirectory, 'components', 'ext-folder')), false)

  core.components.remove('ext')
  assert.equal(existsSync(extFile), false)
  assert.equal(core.components.list().components.some((view) => view.id === 'ext'), false)
})

test('损坏或冲突的定义只影响该组件，不阻断其他组件', async (t) => {
  const setup = fixture(t)
  const core = setup.open({
    components: [definedPackage('alpha').component, definedPackage('beta').component],
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
  const core = setup.open({ components: [definedPackage('alpha').component] })
  const components = core.components
  components.list()
  await core.dispose()
  assert.throws(() => components.list(), /已释放/)
})
