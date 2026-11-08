import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createLocusCore, LOCUS_VERSION } from '../packages/core/lib/index.js'

const filesystemCapability = {
  id: 'locus.filesystem',
  provider: '@locus/filesystem',
  tags: ['environment'],
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-core-'))
  const dataDirectory = join(root, 'data')
  const cores = []
  t.after(async () => {
    for (const core of cores) await core.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root,
    dataDirectory,
    open(directory = dataDirectory) {
      const core = createLocusCore({ dataDirectory: directory })
      cores.push(core)
      return core
    },
  }
}

test('进程在未提交写事务中退出后，Core 恢复已确认身份而不保留半写入对象', async (t) => {
  const setup = fixture(t)
  const core = setup.open()
  const saved = core.workspaces.create('已提交身份')
  await core.dispose()
  const interrupted = spawnSync(process.execPath, [
    '--input-type=module', '-e',
    `import { DatabaseSync } from 'node:sqlite';
     const db = new DatabaseSync(process.argv[1]);
     db.exec("BEGIN IMMEDIATE; INSERT INTO workspaces VALUES ('interrupted', '未提交', '2026-11-08');");
     process.exit(9);`,
    join(setup.dataDirectory, 'core.sqlite'),
  ], { encoding: 'utf8', timeout: 10000 })
  assert.equal(interrupted.status, 9, interrupted.stderr)
  assert.deepEqual(setup.open().workspaces.list(), [saved])
})

test('版本查询不创建数据目录，数据目录必须是绝对路径', async (t) => {
  const setup = fixture(t)
  const core = setup.open()
  assert.equal(core.info.version, LOCUS_VERSION)
  assert.equal(core.dataDirectory, setup.dataDirectory)
  assert.equal(isAbsolute(core.dataDirectory), true)
  assert.equal(existsSync(setup.dataDirectory), false)
  await core.dispose()
  assert.equal(existsSync(setup.dataDirectory), false)
  assert.throws(() => createLocusCore({ dataDirectory: 'relative-data' }), /dataDirectory.*绝对路径/)
  assert.throws(() => createLocusCore({ dataDirectory: '' }), /dataDirectory.*绝对路径/)
  assert.throws(() => createLocusCore({ dataDirectory: null }), /dataDirectory.*绝对路径/)
})

test('LOCUS_HOME 采用绝对位置，显式选项优先，默认目录与工作目录无关', async (t) => {
  const setup = fixture(t)
  const previous = process.env.LOCUS_HOME
  const cores = []
  try {
    process.env.LOCUS_HOME = join(setup.root, 'environment-home')
    const environmentCore = createLocusCore()
    cores.push(environmentCore)
    assert.equal(environmentCore.dataDirectory, process.env.LOCUS_HOME)
    assert.equal(existsSync(environmentCore.dataDirectory), false)

    process.env.LOCUS_HOME = 'relative-home'
    assert.throws(() => createLocusCore(), /LOCUS_HOME.*绝对路径/)
    assert.equal(setup.open().dataDirectory, setup.dataDirectory)

    delete process.env.LOCUS_HOME
    const defaultCore = createLocusCore()
    cores.push(defaultCore)
    assert.equal(defaultCore.dataDirectory, join(homedir(), '.locus-workspace'))
  } finally {
    for (const core of cores) await core.dispose()
    if (previous === undefined) delete process.env.LOCUS_HOME
    else process.env.LOCUS_HOME = previous
  }
})

test('零目录 Workspace 的身份、改名、关系来源和能力快照跨重开及备份恢复保持稳定', async (t) => {
  const setup = fixture(t)
  const core = setup.open()
  const created = core.workspaces.create('  长期语境  ')
  assert.match(created.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(created.name, '长期语境')
  assert.equal(Number.isNaN(Date.parse(created.createdAt)), false)
  assert.deepEqual(created.relations, [])
  assert.deepEqual(created.capabilities, [])

  core.workspaces.rename(created.id, '继续工作')
  const target = { namespace: 'example.resource', id: '不透明引用，不需要目录存在' }
  core.workspaces.link(created.id, 'member', target, { kind: 'manual', detail: '用户明确输入' })
  core.workspaces.link(created.id, 'association', target, { kind: 'discovery', detail: '发现批次：first' })
  const capability = { ...filesystemCapability, tags: [...filesystemCapability.tags] }
  core.workspaces.configureCapability(created.id, capability)
  capability.tags.push('development')
  assert.deepEqual(core.workspaces.get(created.id).capabilities, [filesystemCapability])
  const expected = core.workspaces.get(created.id)
  await core.dispose()

  const reopened = setup.open()
  assert.deepEqual(reopened.workspaces.get(created.id), expected)
  assert.deepEqual(reopened.workspaces.list(), [expected])
  await reopened.dispose()

  const backupDirectory = join(setup.root, 'restored')
  mkdirSync(backupDirectory)
  copyFileSync(join(setup.dataDirectory, 'core.sqlite'), join(backupDirectory, 'core.sqlite'))
  const restored = setup.open(backupDirectory)
  assert.deepEqual(restored.workspaces.get(created.id), expected)
  restored.workspaces.rename(created.id, '备份恢复后的独立修改')
  const original = setup.open()
  assert.equal(original.workspaces.get(created.id).name, expected.name)
})

test('共享目标与嵌套 Workspace 各自独立，取消一处关系不删除其他归属或原生资源', (t) => {
  const setup = fixture(t)
  const core = setup.open()
  const parent = core.workspaces.create('父语境')
  const child = core.workspaces.create('子语境')
  const other = core.workspaces.create('另一语境')
  const nativePath = join(setup.root, 'shared.txt')
  writeFileSync(nativePath, '原生内容')
  const target = { namespace: 'example.resource', id: `opaque:${nativePath}` }
  const source = { kind: 'manual', detail: '分别确认共享资源' }
  const parentRelation = core.workspaces.link(parent.id, 'member', target, source)
  const otherRelation = core.workspaces.link(other.id, 'member', target, source)
  const childRelation = core.workspaces.link(child.id, 'association', target, source)
  core.workspaces.configureCapability(child.id, filesystemCapability)
  const nested = core.workspaces.link(
    parent.id,
    'member',
    { namespace: 'locus.workspace', id: child.id },
    { kind: 'manual', detail: '明确嵌套，不继承' },
  )
  assert.equal(core.workspaces.get(parent.id).relations.length, 2)
  assert.deepEqual(core.workspaces.get(parent.id).capabilities, [])
  assert.deepEqual(core.workspaces.get(child.id).relations, [childRelation])

  core.workspaces.unlink(parent.id, parentRelation.id)
  core.workspaces.unlink(parent.id, nested.id)
  assert.deepEqual(core.workspaces.get(parent.id).relations, [])
  assert.deepEqual(core.workspaces.get(other.id).relations, [otherRelation])
  assert.deepEqual(core.workspaces.get(child.id).relations, [childRelation])
  assert.deepEqual(core.workspaces.get(child.id).capabilities, [filesystemCapability])
  assert.equal(readFileSync(nativePath, 'utf8'), '原生内容')
  assert.deepEqual(
    core.workspaces.list().map((workspace) => workspace.id),
    [parent.id, child.id, other.id],
  )
})

test('Workspace 不能把自身保存为嵌套引用，且失败不写入半条关系', (t) => {
  const setup = fixture(t)
  const core = setup.open()
  const workspace = core.workspaces.create('自引用')
  const before = core.workspaces.get(workspace.id)
  assert.throws(
    () => core.workspaces.link(workspace.id, 'member', { namespace: 'locus.workspace', id: workspace.id }, { kind: 'manual', detail: '自身' }),
    /不能把自身/,
  )
  assert.deepEqual(core.workspaces.get(workspace.id), before)
})

test('同 kind 与目标重复确认幂等，成员和关联并存且保留首次确认来源', (t) => {
  const core = fixture(t).open()
  const workspace = core.workspaces.create('幂等确认')
  const target = { namespace: 'example.resource', id: 'resource-1' }
  const member = core.workspaces.link(workspace.id, 'member', target, { kind: 'manual', detail: '首次确认' })
  const repeated = core.workspaces.link(workspace.id, 'member', target, {
    kind: 'discovery',
    detail: '再次发现并确认',
  })
  assert.deepEqual(repeated, member)
  const association = core.workspaces.link(workspace.id, 'association', target, {
    kind: 'discovery',
    detail: '有意关联',
  })
  assert.notEqual(member.id, association.id)
  assert.deepEqual(core.workspaces.get(workspace.id).relations, [member, association])
  core.workspaces.unlink(workspace.id, member.id)
  assert.deepEqual(core.workspaces.get(workspace.id).relations, [association])
})

test('能力选择按 id 更新提供方声明快照，移除不影响关系或其他 Workspace', (t) => {
  const core = fixture(t).open()
  const first = core.workspaces.create('已配置')
  const second = core.workspaces.create('独立配置')
  const relation = core.workspaces.link(
    first.id,
    'association',
    { namespace: 'locus.filesystem', id: '没有加载提供方也应保留' },
    { kind: 'manual', detail: '用户长期意图' },
  )
  core.workspaces.configureCapability(first.id, filesystemCapability)
  core.workspaces.configureCapability(second.id, filesystemCapability)
  const replacement = {
    id: filesystemCapability.id,
    provider: '@example/other-filesystem',
    tags: ['environment', 'development'],
  }
  assert.deepEqual(core.workspaces.configureCapability(first.id, replacement).capabilities, [replacement])
  assert.deepEqual(core.workspaces.get(second.id).capabilities, [filesystemCapability])
  assert.deepEqual(core.workspaces.removeCapability(first.id, replacement.id).capabilities, [])
  assert.deepEqual(core.workspaces.get(first.id).relations, [relation])
  assert.deepEqual(core.workspaces.get(second.id).capabilities, [filesystemCapability])
})

test('无效输入在打开数据库前拒绝，已有数据库不写入无效状态', (t) => {
  const setup = fixture(t)
  const core = setup.open()
  const service = core.workspaces
  const target = { namespace: 'example.resource', id: 'target' }
  const source = { kind: 'manual', detail: '有效来源' }
  const invalidOperations = [
    () => service.create(' \t\n '),
    () => service.create(null),
    () => service.create('\0'),
    () => service.get(' '),
    () => service.rename('', '名称'),
    () => service.rename('id', ''),
    () => service.link('id', 'invalid', target, source),
    () => service.link('id', 'member', null, source),
    () => service.link('id', 'member', { namespace: ' ', id: 'target' }, source),
    () => service.link('id', 'member', { namespace: 'example.resource', id: '' }, source),
    () => service.link('id', 'member', target, null),
    () => service.link('id', 'member', target, { kind: 'automatic', detail: '来源' }),
    () => service.link('id', 'member', target, { kind: 'manual', detail: ' ' }),
    () => service.unlink('id', ''),
    () => service.configureCapability('id', null),
    () => service.configureCapability('id', { ...filesystemCapability, id: '' }),
    () => service.configureCapability('id', { ...filesystemCapability, id: 'two words' }),
    () => service.configureCapability('id', { ...filesystemCapability, provider: ' ' }),
    () => service.configureCapability('id', { ...filesystemCapability, provider: 'two providers' }),
    () => service.configureCapability('id', { ...filesystemCapability, tags: 'environment' }),
    () => service.configureCapability('id', { ...filesystemCapability, tags: [''] }),
    () => service.configureCapability('id', { ...filesystemCapability, tags: [42] }),
    () => service.removeCapability('id', ' '),
  ]
  for (const operation of invalidOperations) assert.throws(operation)
  assert.equal(existsSync(setup.dataDirectory), false)

  const workspace = service.create('合法数据')
  const before = readFileSync(join(setup.dataDirectory, 'core.sqlite'))
  for (const operation of invalidOperations) assert.throws(operation)
  assert.deepEqual(service.get(workspace.id), workspace)
  assert.deepEqual(readFileSync(join(setup.dataDirectory, 'core.sqlite')), before)
})

test('缺失 Workspace、关系或嵌套目标给出可定位错误，不改变已有数据', (t) => {
  const setup = fixture(t)
  const core = setup.open()
  const workspace = core.workspaces.create('仍然存在')
  const other = core.workspaces.create('不同所有者')
  const relation = core.workspaces.link(
    workspace.id,
    'member',
    { namespace: 'example.resource', id: 'target' },
    { kind: 'manual', detail: '确认' },
  )
  const before = readFileSync(join(setup.dataDirectory, 'core.sqlite'))
  assert.throws(() => core.workspaces.get('missing-workspace'), /missing-workspace/)
  assert.throws(() => core.workspaces.rename('missing-workspace', '改名'), /missing-workspace/)
  assert.throws(
    () =>
      core.workspaces.link(
        workspace.id,
        'member',
        { namespace: 'locus.workspace', id: 'missing-nested-target' },
        { kind: 'manual', detail: '不能确认不存在的 Workspace' },
      ),
    /missing-nested-target/,
  )
  assert.throws(
    () => core.workspaces.link('missing-workspace', 'member', relation.target, relation.source),
    /missing-workspace/,
  )
  assert.throws(() => core.workspaces.unlink(workspace.id, 'missing-relation'), /missing-relation/)
  assert.throws(
    () => core.workspaces.unlink(other.id, relation.id),
    (error) => error.message.includes(other.id) && error.message.includes(relation.id),
  )
  assert.throws(
    () => core.workspaces.configureCapability('missing-workspace', filesystemCapability),
    /missing-workspace/,
  )
  assert.throws(
    () => core.workspaces.removeCapability('missing-workspace', filesystemCapability.id),
    /missing-workspace/,
  )
  assert.deepEqual(core.workspaces.get(workspace.id).relations, [relation])
  assert.deepEqual(readFileSync(join(setup.dataDirectory, 'core.sqlite')), before)
})

test('未知数据库版本拒绝打开且保留全部原始字节', async (t) => {
  const setup = fixture(t)
  const core = setup.open()
  core.workspaces.create('不能丢失')
  await core.dispose()
  const filename = join(setup.dataDirectory, 'core.sqlite')
  const database = new DatabaseSync(filename)
  database.exec('PRAGMA user_version = 99')
  database.close()
  const before = readFileSync(filename)
  const incompatible = setup.open()
  assert.throws(() => incompatible.workspaces.list(), /core\.sqlite.*不支持.*99/)
  assert.deepEqual(readFileSync(filename), before)
  assert.throws(() => incompatible.workspaces.list(), /不支持.*99/)
  assert.deepEqual(readFileSync(filename), before)
})

test('已有未版本化结构拒绝覆盖，空库可安全初始化', (t) => {
  const setup = fixture(t)
  mkdirSync(setup.dataDirectory)
  const filename = join(setup.dataDirectory, 'core.sqlite')
  const database = new DatabaseSync(filename)
  database.exec("CREATE TABLE existing (value TEXT); INSERT INTO existing VALUES ('保留')")
  database.close()
  const before = readFileSync(filename)
  assert.throws(() => setup.open().workspaces.list(), /仅初始化新空库/)
  assert.deepEqual(readFileSync(filename), before)

  const emptyDirectory = join(setup.root, 'existing-empty')
  mkdirSync(emptyDirectory)
  const emptyFilename = join(emptyDirectory, 'core.sqlite')
  writeFileSync(emptyFilename, '')
  assert.deepEqual(setup.open(emptyDirectory).workspaces.list(), [])
  assert.ok(readFileSync(emptyFilename).length > 0)
})

test('损坏数据库明确失败，不重建或覆盖原数据', (t) => {
  const setup = fixture(t)
  mkdirSync(setup.dataDirectory)
  const filename = join(setup.dataDirectory, 'core.sqlite')
  const corrupt = Buffer.from('这不是 SQLite 数据，不能静默覆盖')
  writeFileSync(filename, corrupt)
  const core = setup.open()
  assert.throws(() => core.workspaces.create('不能伪造成功'), /core\.sqlite/)
  assert.deepEqual(readFileSync(filename), corrupt)
})

test('完整性检查拒绝结构有效但约束已经损坏的现有库，不覆盖数据', async (t) => {
  const setup = fixture(t)
  const core = setup.open()
  const workspace = core.workspaces.create('原有数据')
  await core.dispose()
  const filename = join(setup.dataDirectory, 'core.sqlite')
  const database = new DatabaseSync(filename)
  database.exec('PRAGMA ignore_check_constraints = ON')
  database.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run('', workspace.id)
  database.close()
  const before = readFileSync(filename)
  assert.throws(() => setup.open().workspaces.list(), /core\.sqlite.*完整性检查失败/)
  assert.deepEqual(readFileSync(filename), before)
})

test('多个连接始终读取最新提交，不会用旧快照覆盖其他连接的关系和能力', (t) => {
  const setup = fixture(t)
  const first = setup.open()
  const workspace = first.workspaces.create('初始名称')
  const second = setup.open()
  const staleSnapshot = second.workspaces.get(workspace.id)
  first.workspaces.rename(workspace.id, '第一次改名')
  second.workspaces.configureCapability(workspace.id, filesystemCapability)
  const relation = first.workspaces.link(
    workspace.id,
    'member',
    { namespace: 'example.resource', id: 'shared-target' },
    { kind: 'manual', detail: '另一连接确认' },
  )
  second.workspaces.rename(workspace.id, '第二次改名')
  assert.equal(staleSnapshot.name, '初始名称')
  const current = first.workspaces.get(workspace.id)
  assert.equal(current.name, '第二次改名')
  assert.deepEqual(current.relations, [relation])
  assert.deepEqual(current.capabilities, [filesystemCapability])
  assert.deepEqual(second.workspaces.get(workspace.id), current)
})

test('已有写锁时明确拒绝写入且不丢数据，释放锁后连接仍可提交', (t) => {
  const setup = fixture(t)
  const core = setup.open()
  const workspace = core.workspaces.create('锁定前')
  const locker = new DatabaseSync(join(setup.dataDirectory, 'core.sqlite'))
  try {
    locker.exec('BEGIN IMMEDIATE')
    assert.throws(() => core.workspaces.rename(workspace.id, '不能提交'), /locked/i)
    assert.deepEqual(core.workspaces.get(workspace.id), workspace)
    locker.exec('ROLLBACK')
  } finally {
    locker.close()
  }
  assert.equal(core.workspaces.rename(workspace.id, '锁释放后').name, '锁释放后')
})

test('dispose 关闭已打开的连接并阻止捕获的服务继续使用，重复释放安全', async (t) => {
  const setup = fixture(t)
  const core = setup.open()
  const service = core.workspaces
  const workspace = service.create('释放资源')
  await core.dispose()
  await core.dispose()
  assert.throws(() => core.info, /已释放/)
  assert.throws(() => core.dataDirectory, /已释放/)
  assert.throws(() => core.workspaces, /已释放/)
  const operations = [
    () => service.create('新对象'),
    () => service.list(),
    () => service.get(workspace.id),
    () => service.rename(workspace.id, '改名'),
    () =>
      service.link(
        workspace.id,
        'member',
        { namespace: 'example.resource', id: 'target' },
        { kind: 'manual', detail: '来源' },
      ),
    () => service.unlink(workspace.id, 'relation-id'),
    () => service.configureCapability(workspace.id, filesystemCapability),
    () => service.removeCapability(workspace.id, filesystemCapability.id),
  ]
  for (const operation of operations) assert.throws(operation, /已释放/)
  assert.deepEqual(setup.open().workspaces.get(workspace.id), workspace)
})
