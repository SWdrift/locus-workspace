import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { createLocusCore } from '@locus/core'
import { createDispatcher, InvocationFailure } from '@locus/core/invocation'
import { createMemoryCredentialProvider, createMemorySecurityStore } from '@locus/core/security'
import { component, createTemplateService, operations, TemplateFailure } from '../lib/index.js'

const list = operations.find((operation) => operation.id === 'template.templates.list')
const create = operations.find((operation) => operation.id === 'template.templates.create')
assert.ok(list, '缺少 template.templates.list')
assert.ok(create, '缺少 template.templates.create')

/** operation handler 只读取 url.pathParams；其余上下文不在模板路径上。 */
function contextFor(id) {
  return { url: { pathParams: id === undefined ? {} : { id } } }
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-template-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root }
}

function writeTemplate(directory, manifest, files) {
  mkdirSync(directory, { recursive: true })
  if (manifest !== undefined) {
    writeFileSync(join(directory, 'template.json'), JSON.stringify(manifest), 'utf8')
  }
  for (const [name, content] of Object.entries(files)) {
    const target = join(directory, ...name.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
}

function recordAt(destination) {
  return JSON.parse(readFileSync(join(destination, '.template.json'), 'utf8'))
}

function destinationAt(root, name) {
  return join(root, name)
}

function invocationFailure(code, domain) {
  return (error) => error instanceof InvocationFailure &&
    error.code === code && error.details?.domain === domain
}

test('list 列出内置模板，create 使用 pathParams.id 复制并写入实例记录', async (t) => {
  const f = fixture(t)
  const listed = await list.run(undefined, undefined, contextFor())
  assert.ok(Array.isArray(listed))
  const minimal = listed.find((item) => item.id === 'minimal')
  assert.ok(minimal, '默认内置 minimal 模板应可列出')
  assert.equal(minimal.sourceKind, 'builtin')
  assert.deepEqual(list.output.parse(listed), listed)

  const target = destinationAt(f.root, 'minimal-project')
  const result = await create.run(undefined, { destination: target }, contextFor('minimal'))
  assert.equal(result.destination, target)
  assert.equal(result.template.id, 'minimal')
  assert.equal(result.template.sourceKind, 'builtin')
  assert.equal(result.dryRun, false)
  assert.equal(result.metadataPath, '.template.json')
  assert.deepEqual(create.output.parse(result), result)
  assert.match(result.digest, /^sha256:[0-9a-f]{64}$/)
  assert.ok(result.files.includes('README.md'))
  assert.ok(result.files.includes('.gitignore'))
  assert.equal(result.files.includes('template.json'), false)
  assert.equal(existsSync(join(target, 'README.md')), true)
  assert.equal(existsSync(join(target, '.gitignore')), true)
  assert.equal(existsSync(join(target, 'template.json')), false)

  const record = recordAt(target)
  assert.equal(record.schema, 'locus.template-instance/v1')
  assert.equal(record.templateId, 'minimal')
  assert.equal(record.sourceKind, 'builtin')
  assert.equal(record.sourceDigest, result.digest)
  assert.deepEqual(record.parameters, {})
  assert.ok(record.createdAt)
})

test('本地模板复制排除元数据与依赖，digest 稳定且目标已存在时拒绝', async (t) => {
  const f = fixture(t)
  const source = join(f.root, 'source')
  writeTemplate(source, { id: 'local-template', name: 'Local', version: '1.2.0' }, {
    'README.md': '# 项目\n',
    'src/index.ts': 'export {}\n',
    'nested/template.json': '{"nested":true}\n',
    '.git/config': '不复制\n',
    'node_modules/pkg/index.js': '不复制\n',
    '.template.json': '{"old":true}\n',
  })
  mkdirSync(join(source, 'empty'))

  const target = destinationAt(f.root, 'project')
  const result = await create.run(undefined, { destination: target }, contextFor(source))
  assert.equal(result.template.id, 'local-template')
  assert.equal(result.template.name, 'Local')
  assert.equal(result.template.version, '1.2.0')
  assert.equal(result.template.sourceKind, 'local')
  assert.deepEqual(result.files, ['README.md', 'nested/template.json', 'src/index.ts'])
  assert.deepEqual(result.directories, ['empty', 'nested', 'src'])
  assert.equal(existsSync(join(target, 'empty')), true)
  assert.equal(existsSync(join(target, 'nested/template.json')), true)
  assert.equal(existsSync(join(target, 'template.json')), false)
  assert.equal(existsSync(join(target, '.git')), false)
  assert.equal(existsSync(join(target, 'node_modules')), false)
  assert.equal(readFileSync(join(target, 'src/index.ts'), 'utf8'), 'export {}\n')

  const record = recordAt(target)
  assert.equal(record.templateId, 'local-template')
  assert.equal(record.templateVersion, '1.2.0')
  assert.equal(record.sourceKind, 'local')
  assert.equal(record.sourceDigest, result.digest)
  assert.deepEqual(record.parameters, {})

  const repeated = await create.run(undefined, { destination: destinationAt(f.root, 'project-2') }, contextFor(source))
  assert.equal(repeated.digest, result.digest)

  await assert.rejects(
    create.run(undefined, { destination: target }, contextFor(source)),
    invocationFailure('conflict', 'destination-exists'),
  )
})

test('dry-run 不写目标，缺失 id、目标与父目录约束明确失败', async (t) => {
  const f = fixture(t)
  const source = join(f.root, 'source')
  writeTemplate(source, { id: 'dry', version: '1' }, { 'README.md': 'dry\n' })

  const target = destinationAt(f.root, 'dry-project')
  const preview = await create.run(undefined, { destination: target, dryRun: true }, contextFor(source))
  assert.equal(preview.dryRun, true)
  assert.equal(preview.destination, target)
  assert.equal(existsSync(target), false)
  assert.deepEqual(preview.files, ['README.md'])
  assert.match(preview.digest, /^sha256:[0-9a-f]{64}$/)

  await assert.rejects(
    create.run(undefined, { destination: join(f.root, 'missing-parent', 'project') }, contextFor(source)),
    invocationFailure('invalid-argument', 'invalid-destination'),
  )
  await assert.rejects(
    create.run(undefined, { destination: 'relative-destination' }, contextFor(source)),
    invocationFailure('invalid-argument', 'invalid-destination'),
  )
  await assert.rejects(
    create.run(undefined, { destination: target }, contextFor()),
    /缺少路径参数 id/,
  )
})

test('非法 manifest、缺失模板与符号链接失败', async (t) => {
  const f = fixture(t)
  const invalid = join(f.root, 'invalid')
  mkdirSync(invalid)
  writeFileSync(join(invalid, 'template.json'), '{not json', 'utf8')
  await assert.rejects(
    create.run(undefined, { destination: join(f.root, 'invalid-out') }, contextFor(invalid)),
    invocationFailure('invalid-argument', 'invalid-template'),
  )
  await assert.rejects(
    create.run(undefined, { destination: join(f.root, 'missing-out') }, contextFor(join(f.root, 'missing'))),
    invocationFailure('not-found', 'not-found'),
  )

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
    create.run(undefined, { destination: join(f.root, 'linked-out') }, contextFor(linked)),
    invocationFailure('invalid-argument', 'symlink'),
  )
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
  const existing = join(root, 'existing')
  mkdirSync(existing)
  const service = createTemplateService()
  await assert.rejects(
    service.create('minimal', { destination: existing }),
    (error) => error instanceof TemplateFailure && error.code === 'destination-exists',
  )
  await assert.rejects(
    service.create('missing-template-for-dispatch-test', { destination: join(root, 'missing-source') }),
    (error) => error instanceof TemplateFailure && error.code === 'not-found',
  )
  await assert.rejects(
    service.create('minimal', { destination: 'relative' }),
    (error) => error instanceof TemplateFailure && error.code === 'invalid-destination',
  )

  for (const [id, destination, code, domain] of [
    ['minimal', existing, 'conflict', 'destination-exists'],
    ['missing-template-for-dispatch-test', join(root, 'missing-output'), 'not-found', 'not-found'],
    ['minimal', 'relative', 'invalid-argument', 'invalid-destination'],
  ]) {
    const result = await dispatcher.invoke({
      method: 'POST',
      uri: `template://templates/${id}/instances`,
      contentType: 'application/json',
      body: { destination },
    })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, code)
    assert.equal(result.error.details.domain, domain)
  }
  const result = await dispatcher.invoke({
    method: 'POST',
    uri: 'template://templates/minimal/instances',
    contentType: 'application/json',
    body: { destination: join(root, 'created') },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(create.output.parse(result.data), result.data)
  assert.equal(JSON.parse(JSON.stringify(result)).data.template.id, 'minimal')
})
