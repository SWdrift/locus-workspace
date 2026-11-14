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
import { createTemplateService, TemplateFailure } from '../lib/index.js'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-template-'))
  const builtin = join(root, 'builtin')
  mkdirSync(builtin)
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return {
    root,
    builtin,
    service: createTemplateService({ builtinDirectory: builtin }),
  }
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

test('复制模板、排除元数据与依赖，并写入实例记录', async (t) => {
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

  const destination = join(f.root, 'project')
  const result = await f.service.create(source, { destination })

  assert.equal(result.template.id, 'local-template')
  assert.equal(result.template.name, 'Local')
  assert.equal(result.template.version, '1.2.0')
  assert.equal(result.template.sourceKind, 'local')
  assert.deepEqual(result.files, ['README.md', 'nested/template.json', 'src/index.ts'])
  assert.deepEqual(result.directories, ['empty', 'nested', 'src'])
  assert.equal(existsSync(join(destination, 'empty')), true)
  assert.equal(existsSync(join(destination, 'nested/template.json')), true)
  assert.equal(existsSync(join(destination, 'template.json')), false)
  assert.equal(existsSync(join(destination, '.git')), false)
  assert.equal(existsSync(join(destination, 'node_modules')), false)
  assert.equal(readFileSync(join(destination, 'src/index.ts'), 'utf8'), 'export {}\n')

  const record = recordAt(destination)
  assert.equal(record.schema, 'locus.template-instance/v1')
  assert.equal(record.templateId, 'local-template')
  assert.equal(record.templateVersion, '1.2.0')
  assert.equal(record.sourceKind, 'local')
  assert.match(record.sourceDigest, /^sha256:[0-9a-f]{64}$/)
  assert.deepEqual(record.parameters, {})
  assert.ok(record.createdAt)

  const second = join(f.root, 'project-2')
  const repeated = await f.service.create(source, { destination: second })
  assert.equal(repeated.digest, result.digest)

  await assert.rejects(
    f.service.create(source, { destination }),
    (error) => error instanceof TemplateFailure && error.code === 'destination-exists',
  )
})

test('列出并创建内置模板，使用内置 sourceKind', async (t) => {
  const f = fixture(t)
  writeTemplate(join(f.builtin, 'hello'), { id: 'hello', name: 'Hello', version: '1' }, {
    'README.md': 'hello\n',
  })

  const listed = await f.service.list()
  assert.deepEqual(listed.map((item) => [item.id, item.sourceKind]), [['hello', 'builtin']])

  const destination = join(f.root, 'from-builtin')
  const result = await f.service.create('hello', { destination })
  assert.equal(result.template.sourceKind, 'builtin')
  assert.equal(recordAt(destination).sourceKind, 'builtin')
  assert.equal(recordAt(destination).templateVersion, '1')
})

test('默认内置 minimal 模板可列出并创建', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'locus-template-default-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const service = createTemplateService()
  const listed = await service.list()
  assert.ok(listed.some((item) => item.id === 'minimal'))

  const destination = join(root, 'minimal-project')
  const result = await service.create('minimal', { destination })
  assert.equal(result.template.id, 'minimal')
  assert.equal(existsSync(join(destination, 'README.md')), true)
  assert.equal(existsSync(join(destination, '.gitignore')), true)
  assert.equal(existsSync(join(destination, 'template.json')), false)
  assert.equal(recordAt(destination).templateId, 'minimal')
})

test('dry-run 不写目标，目标与父目录约束明确失败', async (t) => {
  const f = fixture(t)
  const source = join(f.root, 'source')
  writeTemplate(source, { id: 'dry', version: '1' }, { 'README.md': 'dry\n' })

  const destination = join(f.root, 'dry-project')
  const preview = await f.service.create(source, { destination, dryRun: true })
  assert.equal(preview.dryRun, true)
  assert.equal(existsSync(destination), false)
  assert.deepEqual(preview.files, ['README.md'])
  assert.match(preview.digest, /^sha256:/)

  await assert.rejects(
    f.service.create(source, { destination: join(f.root, 'missing-parent', 'project') }),
    (error) => error instanceof TemplateFailure && error.code === 'invalid-destination',
  )
  await assert.rejects(
    f.service.create(source, { destination: 'relative-destination' }),
    (error) => error instanceof TemplateFailure && error.code === 'invalid-destination',
  )
})

test('非法 manifest、缺失模板与符号链接失败', async (t) => {
  const f = fixture(t)
  const invalid = join(f.root, 'invalid')
  mkdirSync(invalid)
  writeFileSync(join(invalid, 'template.json'), '{not json', 'utf8')
  await assert.rejects(
    f.service.create(invalid, { destination: join(f.root, 'invalid-out') }),
    (error) => error instanceof TemplateFailure && error.code === 'invalid-template',
  )
  await assert.rejects(
    f.service.create(join(f.root, 'missing'), { destination: join(f.root, 'missing-out') }),
    (error) => error instanceof TemplateFailure && error.code === 'not-found',
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
    f.service.create(linked, { destination: join(f.root, 'linked-out') }),
    (error) => error instanceof TemplateFailure && error.code === 'symlink',
  )
})
