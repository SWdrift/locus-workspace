import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { createLocusCore } from '@locus/core'
import { createDispatcher, InvocationFailure } from '@locus/core/invocation'
import { createMemoryCredentialProvider, createMemorySecurityStore } from '@locus/core/security'
import { component, createTemplateService, operations, TemplateFailure } from '../lib/index.js'

const list = operations.find((operation) => operation.id === 'template.templates.list')
const get = operations.find((operation) => operation.id === 'template.templates.get')
const register = operations.find((operation) => operation.id === 'template.templates.register')
const metadata = operations.find((operation) => operation.id === 'template.templates.metadata')
const remove = operations.find((operation) => operation.id === 'template.templates.remove')
const create = operations.find((operation) => operation.id === 'template.templates.create')
assert.ok(list, '缺少 template.templates.list')
assert.ok(get, '缺少 template.templates.get')
assert.ok(register, '缺少 template.templates.register')
assert.ok(metadata, '缺少 template.templates.metadata')
assert.ok(remove, '缺少 template.templates.remove')
assert.ok(create, '缺少 template.templates.create')

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-template-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dataDirectory = join(root, 'data')
  return { root, dataDirectory, service: createTemplateService({ dataDirectory }) }
}

/** operation handler 只读取 url.pathParams 与 dataDirectory。 */
function contextFor(fixtureValue, id) {
  return {
    dataDirectory: fixtureValue.dataDirectory,
    url: { pathParams: id === undefined ? {} : { id } },
  }
}

function writeSource(directory, manifest, files) {
  mkdirSync(directory, { recursive: true })
  if (manifest !== undefined) {
    writeFileSync(join(directory, '.template.json'), JSON.stringify(manifest), 'utf8')
  }
  for (const [name, content] of Object.entries(files)) {
    const target = join(directory, ...name.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
}

function invocationFailure(code, domain) {
  return (error) => error instanceof InvocationFailure &&
    error.code === code && error.details?.domain === domain
}

test('模板 operation 声明中文协议说明与输入结构', () => {
  for (const item of operations) assert.match(item.summary, /[\u4e00-\u9fff]/)
  assert.throws(() => create.input.parse({}))
  assert.deepEqual(create.input.parse({ destination: '/tmp/project', dryRun: true }), {
    destination: '/tmp/project',
    dryRun: true,
  })
  assert.throws(() => register.input.parse({ id: 'custom' }))
  assert.deepEqual(register.input.parse({ id: 'custom', source: { kind: 'builtin', id: 'minimal' } }), {
    id: 'custom',
    source: { kind: 'builtin', id: 'minimal' },
  })
  assert.deepEqual(metadata.input.parse({}), {})
})

test('list 返回内置模板与 problems；detail 读取元信息与当前摘要', async (t) => {
  const f = fixture(t)
  const listed = await list.run(undefined, undefined, contextFor(f))
  assert.equal(listed.problems.length, 0)
  const ids = listed.templates.map((item) => item.id)
  for (const id of ['minimal', 'node-service', 'ts-lib', 'python-service']) {
    assert.ok(ids.includes(id), `应列出内置模板 ${id}`)
  }
  const minimal = listed.templates.find((item) => item.id === 'minimal')
  assert.equal(minimal.sourceKind, 'builtin')
  assert.deepEqual(list.output.parse(listed), listed)

  const detail = await get.run(undefined, undefined, contextFor(f, 'minimal'))
  assert.equal(detail.id, 'minimal')
  assert.equal(detail.sourceKind, 'builtin')
  assert.match(detail.digest, /^sha256:[0-9a-f]{64}$/)
  assert.ok(detail.fileCount >= 2)
  assert.ok(detail.directoryCount >= 0)
  assert.deepEqual(get.output.parse(detail), detail)
})

test('register 复制模板进库，create 纯复制且不写 .template.json', async (t) => {
  const f = fixture(t)
  const source = join(f.root, 'source')
  writeSource(source, { schema: 'locus.template/v1', id: 'custom', name: 'Custom', version: '1.2.0' }, {
    'README.md': '# 项目\n',
    'src/index.ts': 'export {}\n',
    'nested/template.json': '{"nested":true}\n',
    'nested/.template.json': '{"old":true}\n',
    '.git/config': '不复制\n',
    'node_modules/pkg/index.js': '不复制\n',
  })
  mkdirSync(join(source, 'empty'))

  const registered = await register.run(
    undefined,
    { id: 'custom', source: { kind: 'path', path: source } },
    contextFor(f),
  )
  assert.equal(registered.id, 'custom')
  assert.equal(registered.name, 'Custom')
  assert.equal(registered.version, '1.2.0')
  assert.equal(registered.sourceKind, 'user')
  assert.match(registered.digest, /^sha256:[0-9a-f]{64}$/)
  assert.equal(existsSync(join(f.dataDirectory, 'templates', 'custom', '.template.json')), true)

  const listed = await list.run(undefined, undefined, contextFor(f))
  assert.equal(listed.templates.find((item) => item.id === 'custom').sourceKind, 'user')

  const target = join(f.root, 'project')
  const result = await create.run(undefined, { destination: target }, contextFor(f, 'custom'))
  assert.equal(result.template.id, 'custom')
  assert.equal(result.template.sourceKind, 'user')
  assert.equal(result.dryRun, false)
  assert.match(result.digest, /^sha256:[0-9a-f]{64}$/)
  assert.deepEqual(result.files, ['README.md', 'nested/template.json', 'src/index.ts'])
  assert.deepEqual(result.directories, ['empty', 'nested', 'src'])
  assert.equal(existsSync(join(target, '.template.json')), false)
  assert.equal(existsSync(join(target, 'template.json')), false)
  assert.equal(existsSync(join(target, '.git')), false)
  assert.equal(existsSync(join(target, 'node_modules')), false)
  assert.equal(existsSync(join(target, 'empty')), true)

  const repeated = await create.run(undefined, { destination: join(f.root, 'project-2') }, contextFor(f, 'custom'))
  assert.equal(repeated.digest, result.digest)
  await assert.rejects(
    create.run(undefined, { destination: target }, contextFor(f, 'custom')),
    invocationFailure('conflict', 'destination-exists'),
  )
})

test('用户模板遮蔽同名内置，删除后内置重新可见', async (t) => {
  const f = fixture(t)
  const source = join(f.root, 'minimal-copy')
  writeSource(source, { schema: 'locus.template/v1', id: 'minimal', name: 'Custom minimal' }, {
    'README.md': '# custom\n',
  })
  await register.run(undefined, { id: 'minimal', source: { kind: 'path', path: source } }, contextFor(f))
  const listed = await list.run(undefined, undefined, contextFor(f))
  const minimal = listed.templates.filter((item) => item.id === 'minimal')
  assert.equal(minimal.length, 1)
  assert.equal(minimal[0].sourceKind, 'user')
  assert.equal(minimal[0].name, 'Custom minimal')

  await remove.run(undefined, undefined, contextFor(f, 'minimal'))
  const restored = await list.run(undefined, undefined, contextFor(f))
  const builtin = restored.templates.find((item) => item.id === 'minimal')
  assert.equal(builtin.sourceKind, 'builtin')
})

test('PATCH 只更新元信息，内置模板拒绝修改与删除', async (t) => {
  const f = fixture(t)
  const source = join(f.root, 'meta-source')
  writeSource(source, { schema: 'locus.template/v1', id: 'meta', name: 'Meta' }, { 'README.md': 'meta\n' })
  await register.run(undefined, { id: 'meta', source: { kind: 'path', path: source } }, contextFor(f))

  const updated = await metadata.run(
    undefined,
    { name: 'Renamed', version: '2.0.0', description: '新描述' },
    contextFor(f, 'meta'),
  )
  assert.equal(updated.name, 'Renamed')
  assert.equal(updated.version, '2.0.0')
  assert.equal(updated.description, '新描述')

  const cleared = await metadata.run(undefined, { description: '' }, contextFor(f, 'meta'))
  assert.equal(cleared.description, undefined)

  await assert.rejects(
    metadata.run(undefined, { name: 'x' }, contextFor(f, 'minimal')),
    invocationFailure('forbidden', 'template-builtin'),
  )
  await assert.rejects(
    remove.run(undefined, undefined, contextFor(f, 'minimal')),
    invocationFailure('forbidden', 'template-builtin'),
  )
})

test('注册与目标约束明确失败，符号链接拒绝', async (t) => {
  const f = fixture(t)
  const source = join(f.root, 'source')
  writeSource(source, { schema: 'locus.template/v1', id: 'source', name: 'Source' }, { 'README.md': 'x\n' })
  await register.run(undefined, { id: 'source', source: { kind: 'path', path: source } }, contextFor(f))
  await assert.rejects(
    register.run(undefined, { id: 'source', source: { kind: 'path', path: source } }, contextFor(f)),
    invocationFailure('conflict', 'template-exists'),
  )
  await assert.rejects(
    register.run(undefined, { id: 'missing', source: { kind: 'path', path: join(f.root, 'missing') } }, contextFor(f)),
    invocationFailure('invalid-argument', 'invalid-source'),
  )
  await assert.rejects(
    register.run(undefined, { id: 'Bad_ID', source: { kind: 'path', path: source } }, contextFor(f)),
    invocationFailure('invalid-argument', 'invalid-id'),
  )
  await assert.rejects(
    create.run(undefined, { destination: join(f.root, 'missing-parent', 'project') }, contextFor(f, 'source')),
    invocationFailure('invalid-argument', 'invalid-destination'),
  )
  await assert.rejects(
    create.run(undefined, { destination: 'relative' }, contextFor(f, 'source')),
    invocationFailure('invalid-argument', 'invalid-destination'),
  )
  await assert.rejects(create.run(undefined, { destination: join(f.root, 'x') }, contextFor(f)), /缺少路径参数 id/)

  const linked = join(f.root, 'linked')
  mkdirSync(linked)
  writeFileSync(join(linked, 'file.txt'), 'target', 'utf8')
  try {
    symlinkSync(join(linked, 'file.txt'), join(linked, 'link.txt'))
  } catch (error) {
    t.skip(`当前环境不能创建符号链接：${error.message}`)
    return
  }
  await assert.rejects(
    register.run(undefined, { id: 'linked', source: { kind: 'path', path: linked } }, contextFor(f)),
    invocationFailure('invalid-argument', 'symlink'),
  )
})

test('dry-run 不写目标，非法元信息进入 problems', async (t) => {
  const f = fixture(t)
  const source = join(f.root, 'dry')
  writeSource(source, { schema: 'locus.template/v1', id: 'dry', name: 'Dry' }, { 'README.md': 'dry\n' })
  await register.run(undefined, { id: 'dry', source: { kind: 'path', path: source } }, contextFor(f))
  const target = join(f.root, 'dry-project')
  const preview = await create.run(undefined, { destination: target, dryRun: true }, contextFor(f, 'dry'))
  assert.equal(preview.dryRun, true)
  assert.equal(existsSync(target), false)

  const broken = join(f.dataDirectory, 'templates', 'broken')
  mkdirSync(broken, { recursive: true })
  writeFileSync(join(broken, '.template.json'), '{not json', 'utf8')
  const listed = await list.run(undefined, undefined, contextFor(f))
  assert.equal(listed.templates.some((item) => item.id === 'broken'), false)
  assert.equal(listed.problems.some((item) => item.id === 'broken'), true)
})

test('直接服务保留 TemplateFailure，真实 Dispatcher 将领域错误转换为稳定协议分类', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'locus-template-dispatch-'))
  let host
  const core = createLocusCore({
    dataDirectory: join(root, 'core'),
    components: [{ component, operations }],
    security: {
      store: createMemorySecurityStore(),
      provider: createMemoryCredentialProvider(),
      receiveHost(value) { host = value },
    },
  })
  const session = host.createSession('human')
  const dispatcher = createDispatcher(core.router, host, session, core.events, core.dataDirectory)
  t.after(async () => {
    host.endSession(session)
    await core.dispose()
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  await host.initializeRoot('template-test-root', 'template-test-root')

  const source = join(root, 'source')
  writeSource(source, { schema: 'locus.template/v1', id: 'dispatch', name: 'Dispatch' }, { 'README.md': 'x\n' })
  const service = createTemplateService({ dataDirectory: core.dataDirectory })
  await assert.rejects(
    service.create('missing', { destination: join(root, 'missing-out') }),
    (error) => error instanceof TemplateFailure && error.code === 'not-found',
  )

  const registered = await dispatcher.invoke({
    method: 'POST',
    uri: 'template://templates',
    contentType: 'application/json',
    body: { id: 'dispatch', source: { kind: 'path', path: source } },
  })
  assert.equal(registered.ok, true)
  assert.equal(registered.data.id, 'dispatch')

  const duplicate = await dispatcher.invoke({
    method: 'POST',
    uri: 'template://templates',
    contentType: 'application/json',
    body: { id: 'dispatch', source: { kind: 'path', path: source } },
  })
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.error.code, 'conflict')
  assert.equal(duplicate.error.details.domain, 'template-exists')

  const builtinPatch = await dispatcher.invoke({
    method: 'PATCH',
    uri: 'template://templates/minimal',
    contentType: 'application/json',
    body: { name: 'x' },
  })
  assert.equal(builtinPatch.ok, false)
  assert.equal(builtinPatch.error.code, 'forbidden')
  assert.equal(builtinPatch.error.details.domain, 'template-builtin')

  const existing = join(root, 'existing')
  mkdirSync(existing)
  const conflict = await dispatcher.invoke({
    method: 'POST',
    uri: 'template://templates/dispatch/instances',
    contentType: 'application/json',
    body: { destination: existing },
  })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.error.code, 'conflict')
  assert.equal(conflict.error.details.domain, 'destination-exists')

  const missing = await dispatcher.invoke({
    method: 'POST',
    uri: 'template://templates/missing/instances',
    contentType: 'application/json',
    body: { destination: join(root, 'missing-output') },
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'not-found')
  assert.equal(missing.error.details.domain, 'not-found')

  const created = await dispatcher.invoke({
    method: 'POST',
    uri: 'template://templates/dispatch/instances',
    contentType: 'application/json',
    body: { destination: join(root, 'created') },
  })
  assert.equal(created.ok, true)
  assert.equal(created.data.template.id, 'dispatch')
  assert.equal(existsSync(join(root, 'created', '.template.json')), false)
  assert.equal(existsSync(join(root, 'created', 'README.md')), true)
})
