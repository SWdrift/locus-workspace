import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { createLocusCore } from '../packages/core/lib/index.js'
import { capability, createFilesystemService } from '../plugins/filesystem/lib/index.js'

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'locus-filesystem-')))
  const dataDirectory = join(root, 'data')
  const nativeDirectory = join(root, 'native')
  await mkdir(nativeDirectory)
  let core = createLocusCore({ dataDirectory })
  let filesystem = createFilesystemService(core)
  t.after(async () => {
    await filesystem.dispose()
    await core.dispose()
    await rm(root, { recursive: true, force: true })
  })
  return {
    root,
    dataDirectory,
    nativeDirectory,
    get core() { return core },
    get filesystem() { return filesystem },
    async restart() {
      await filesystem.dispose()
      await core.dispose()
      core = createLocusCore({ dataDirectory })
      filesystem = createFilesystemService(core)
    },
  }
}

function workspace(f, name = '文件工作空间') {
  const value = f.core.workspaces.create(name)
  f.core.workspaces.configureCapability(value.id, f.filesystem.capability)
  return value
}

test('Filesystem 延迟建立独立数据库，多位置、共享位置和父子位置重启后保持独立', async t => {
  const f = await fixture(t)
  await assert.rejects(stat(join(f.dataDirectory, 'filesystem.sqlite')), { code: 'ENOENT' })
  const zero = f.core.workspaces.create('零目录')
  assert.deepEqual(f.filesystem.locations(zero.id), [])
  assert.deepEqual(f.core.workspaces.get(zero.id).relations, [])

  const first = workspace(f, '一')
  const second = workspace(f, '二')
  const parent = join(f.nativeDirectory, 'parent')
  const child = join(parent, 'child')
  const separate = join(f.root, 'separate')
  await mkdir(child, { recursive: true })
  await mkdir(separate)
  const one = f.filesystem.register(first.id, parent)
  assert.deepEqual(f.filesystem.register(first.id, join(parent, '.')), one)
  const two = f.filesystem.register(first.id, child)
  const three = f.filesystem.register(first.id, separate)
  const shared = f.filesystem.register(second.id, parent)
  assert.notEqual(one.id, two.id)
  assert.notEqual(one.id, shared.id)
  assert.deepEqual(one.reference, shared.reference)
  assert.deepEqual(one.reference, {
    namespace: `locus.filesystem:${hostname()}`,
    id: pathToFileURL(parent).href,
  })
  assert.match(one.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.deepEqual(f.filesystem.locations(first.id), [one, two, three])
  await f.filesystem.discover(first.id, one.id)
  assert.deepEqual(f.core.workspaces.get(first.id).relations, [])

  await f.restart()
  assert.deepEqual(f.filesystem.locations(zero.id), [])
  assert.deepEqual(f.filesystem.locations(first.id), [one, two, three])
  assert.deepEqual(f.filesystem.locations(second.id), [shared])
  assert.equal((await f.filesystem.inspect(first.id, one.id)).state, 'accessible')
  assert.deepEqual(f.core.workspaces.get(first.id).relations, [])
  const database = new DatabaseSync(join(f.dataDirectory, 'filesystem.sqlite'))
  try {
    assert.equal(database.prepare('PRAGMA user_version').get().user_version, 1)
    assert.equal(database.prepare('PRAGMA journal_mode').get().journal_mode, 'delete')
  } finally {
    database.close()
  }
})

test('登记和观察要求显式选择匹配提供方，停用保留配置且取消登记不删除原生文件或 Core 关系', async t => {
  const f = await fixture(t)
  const value = f.core.workspaces.create('配置与确认分离')
  await writeFile(join(f.nativeDirectory, 'kept.txt'), '保留原生内容')
  assert.throws(() => f.filesystem.register(value.id, f.nativeDirectory), /尚未启用能力 locus\.filesystem/)
  assert.throws(() => f.filesystem.register('unknown-workspace', f.nativeDirectory))
  assert.deepEqual(f.filesystem.locations(value.id), [])
  f.core.workspaces.configureCapability(value.id, capability)
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  const candidate = await f.filesystem.inspect(value.id, location.id, 'kept.txt')
  assert.deepEqual(f.core.workspaces.get(value.id).relations, [])
  const confirmed = f.core.workspaces.link(value.id, 'member', candidate.reference, {
    kind: 'discovery', detail: `位置 ${location.id} 的显式选择`,
  })

  f.core.workspaces.removeCapability(value.id, capability.id)
  await f.restart()
  assert.deepEqual(f.filesystem.locations(value.id), [location])
  assert.throws(() => f.filesystem.register(value.id, f.nativeDirectory), /尚未启用能力 locus\.filesystem/)
  await assert.rejects(f.filesystem.inspect(value.id, location.id), /尚未启用能力 locus\.filesystem/)
  await assert.rejects(f.filesystem.discover(value.id, location.id), /尚未启用能力 locus\.filesystem/)
  await assert.rejects(f.filesystem.read(value.id, location.id, 'kept.txt'), /尚未启用能力 locus\.filesystem/)
  f.core.workspaces.configureCapability(value.id, { ...capability, provider: '@other/filesystem' })
  await assert.rejects(f.filesystem.inspect(value.id, location.id), /尚未启用能力 locus\.filesystem/)
  f.core.workspaces.removeCapability(value.id, capability.id)
  f.filesystem.unregister(value.id, location.id)
  assert.deepEqual(f.filesystem.locations(value.id), [])
  assert.equal(await readFile(join(f.nativeDirectory, 'kept.txt'), 'utf8'), '保留原生内容')
  assert.deepEqual(f.core.workspaces.get(value.id).relations.map(relation => relation.id), [confirmed.id])
  await f.restart()
  assert.deepEqual(f.filesystem.locations(value.id), [])
  assert.equal(await readFile(join(f.nativeDirectory, 'kept.txt'), 'utf8'), '保留原生内容')
})

test('位置按 Workspace 隔离，取消共享位置的一处登记不改变另一处', async t => {
  const f = await fixture(t)
  const first = workspace(f, '一')
  const second = workspace(f, '二')
  const one = f.filesystem.register(first.id, f.nativeDirectory)
  const two = f.filesystem.register(second.id, f.nativeDirectory)
  await assert.rejects(f.filesystem.inspect(second.id, one.id), /不存在 Filesystem 位置/)
  assert.throws(() => f.filesystem.unregister(second.id, one.id), /不存在 Filesystem 位置/)
  f.filesystem.unregister(first.id, one.id)
  assert.deepEqual(f.filesystem.locations(second.id), [two])
  assert.equal((await f.filesystem.inspect(second.id, two.id)).state, 'accessible')
  assert.equal((await stat(f.nativeDirectory)).isDirectory(), true)
})

test('缺失位置可以显式登记，观察不创建路径且每次从原生状态重新读取', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const missing = join(f.nativeDirectory, 'not-yet-created')
  const location = f.filesystem.register(value.id, missing)
  await assert.rejects(stat(missing), { code: 'ENOENT' })
  const observed = await f.filesystem.inspect(value.id, location.id)
  assert.equal(observed.state, 'missing')
  assert.equal(observed.kind, 'unknown')
  assert.deepEqual(observed.reference, location.reference)
  assert.ok(Number.isFinite(Date.parse(observed.observedAt)))
  const discovered = await f.filesystem.discover(value.id, location.id)
  assert.equal(discovered.root.state, 'missing')
  assert.deepEqual(discovered.entries, [])
  assert.equal(discovered.truncated, false)
  await assert.rejects(f.filesystem.read(value.id, location.id), /不存在/)

  await mkdir(missing)
  assert.equal((await f.filesystem.inspect(value.id, location.id)).kind, 'directory')
  await writeFile(join(missing, 'fresh.txt'), '第一次')
  assert.equal((await f.filesystem.read(value.id, location.id, 'fresh.txt')).text, '第一次')
  await writeFile(join(missing, 'fresh.txt'), '第二次')
  assert.equal((await f.filesystem.read(value.id, location.id, 'fresh.txt')).text, '第二次')
  await rm(join(missing, 'fresh.txt'))
  assert.equal((await f.filesystem.inspect(value.id, location.id, 'fresh.txt')).state, 'missing')
  assert.deepEqual(f.core.workspaces.get(value.id).relations, [])
})

test('发现只枚举当前目录一层，并用多读一个目录项明确判定 limit 截断', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  assert.equal((await f.filesystem.discover(value.id, location.id, '', 1)).truncated, false)
  await mkdir(join(f.nativeDirectory, 'nested'))
  await writeFile(join(f.nativeDirectory, 'nested', 'not-a-root-entry.txt'), '下一层')
  const exact = await f.filesystem.discover(value.id, location.id, '', 1)
  assert.equal(exact.entries.length, 1)
  assert.equal(exact.truncated, false)
  assert.equal(exact.entries[0].kind, 'directory')
  await writeFile(join(f.nativeDirectory, 'file.txt'), '当前层')
  const limited = await f.filesystem.discover(value.id, location.id, '', 1)
  assert.equal(limited.entries.length, 1)
  assert.equal(limited.truncated, true)
  const all = await f.filesystem.discover(value.id, location.id)
  assert.deepEqual(all.entries.map(entry => basename(entry.path)), ['file.txt', 'nested'])
  assert.equal(all.truncated, false)
  assert.ok(all.entries.every(entry => entry.state === 'accessible'))
  assert.ok(all.entries.every(entry => entry.reference.namespace === location.reference.namespace))
  const nested = await f.filesystem.discover(value.id, location.id, 'nested')
  assert.deepEqual(nested.entries.map(entry => basename(entry.path)), ['not-a-root-entry.txt'])
  for (const limit of [0, -1, 0.5, 1001, Number.POSITIVE_INFINITY]) {
    await assert.rejects(f.filesystem.discover(value.id, location.id, '', limit), /limit/)
  }
  assert.deepEqual(f.core.workspaces.get(value.id).relations, [])
})

test('默认发现上限为 200，显式最多 1000，不先收集整个目录', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  await Promise.all(Array.from({ length: 201 }, (_, index) =>
    writeFile(join(f.nativeDirectory, `${String(index).padStart(3, '0')}.txt`), 'x')))
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  const bounded = await f.filesystem.discover(value.id, location.id)
  assert.equal(bounded.entries.length, 200)
  assert.equal(bounded.truncated, true)
  const complete = await f.filesystem.discover(value.id, location.id, '', 1000)
  assert.equal(complete.entries.length, 201)
  assert.equal(complete.truncated, false)
})

test('读取仅限普通文件，按字节有界并返回完整 UTF-8 前缀和准确截断状态', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  await writeFile(join(f.nativeDirectory, 'ascii.txt'), 'abcdef')
  const short = await f.filesystem.read(value.id, location.id, 'ascii.txt', 4)
  assert.equal(short.text, 'abcd')
  assert.equal(short.truncated, true)
  assert.equal(short.resource.state, 'accessible')
  assert.equal(short.resource.kind, 'file')
  const exact = await f.filesystem.read(value.id, location.id, 'ascii.txt', 6)
  assert.equal(exact.text, 'abcdef')
  assert.equal(exact.truncated, false)
  await writeFile(join(f.nativeDirectory, 'utf8.txt'), '甲乙🙂Z')
  const utf8 = await f.filesystem.read(value.id, location.id, 'utf8.txt', 4)
  assert.equal(utf8.text, '甲')
  assert.equal(utf8.truncated, true)
  assert.equal(utf8.text.includes('\uFFFD'), false)
  assert.equal((await f.filesystem.read(value.id, location.id, 'utf8.txt')).text, '甲乙🙂Z')
  await writeFile(join(f.nativeDirectory, 'default.txt'), 'a'.repeat(65537))
  const defaultRead = await f.filesystem.read(value.id, location.id, 'default.txt')
  assert.equal(defaultRead.text.length, 65536)
  assert.equal(defaultRead.truncated, true)
  assert.equal((await f.filesystem.read(value.id, location.id, 'default.txt', 1024 * 1024)).truncated, false)
  await writeFile(join(f.nativeDirectory, 'empty.txt'), '')
  assert.equal((await f.filesystem.read(value.id, location.id, 'empty.txt', 1)).truncated, false)
  for (const maxBytes of [0, -1, 0.5, 1024 * 1024 + 1, Number.NaN]) {
    await assert.rejects(f.filesystem.read(value.id, location.id, 'ascii.txt', maxBytes), /maxBytes/)
  }
  await assert.rejects(f.filesystem.read(value.id, location.id), /只能读取普通文件/)
  const fileLocation = f.filesystem.register(value.id, join(f.nativeDirectory, 'ascii.txt'))
  assert.equal((await f.filesystem.read(value.id, fileLocation.id)).text, 'abcdef')
})

test('relativePath 拒绝绝对路径与 .. 越界，合法范围内的规范化不扩大范围', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  await writeFile(join(f.nativeDirectory, 'inside.txt'), '范围内')
  await writeFile(join(f.root, 'outside.txt'), '范围外')
  for (const relativePath of [join(f.root, 'outside.txt'), '../outside.txt', 'sub/../../outside.txt', 'bad\0name']) {
    await assert.rejects(f.filesystem.inspect(value.id, location.id, relativePath), /relativePath/)
    await assert.rejects(f.filesystem.discover(value.id, location.id, relativePath), /relativePath/)
    await assert.rejects(f.filesystem.read(value.id, location.id, relativePath), /relativePath/)
  }
  assert.equal((await f.filesystem.read(value.id, location.id, './inside.txt')).text, '范围内')
  assert.throws(() => f.filesystem.register(value.id, ''), /登记路径/)
  assert.throws(() => f.filesystem.register(value.id, 'bad\0name'), /登记路径/)
})

test('符号链接或 Windows junction 可观察但不能作为根或中间路径遍历', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const outside = join(f.root, 'outside')
  await mkdir(outside)
  await mkdir(join(outside, 'nested'))
  await writeFile(join(outside, 'secret.txt'), '不可越界读取的内容')
  await writeFile(join(outside, 'nested', 'secret.txt'), '不能通过登记链接后代绕过检查')
  const link = join(f.nativeDirectory, 'shortcut')
  try {
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(error.code)) {
      t.skip(`当前环境不允许创建测试链接：${error.code}`)
      return
    }
    throw error
  }
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  const root = f.filesystem.register(value.id, link)
  const underneathLink = f.filesystem.register(value.id, join(link, 'nested'))
  assert.equal((await f.filesystem.inspect(value.id, location.id, 'shortcut')).kind, 'symlink')
  const child = await f.filesystem.inspect(value.id, location.id, 'shortcut/secret.txt')
  assert.equal(child.state, 'unavailable')
  assert.match(child.error, /符号链接|junction/)
  const discovered = await f.filesystem.discover(value.id, location.id)
  assert.equal(discovered.entries[0].kind, 'symlink')
  const linkDiscovery = await f.filesystem.discover(value.id, location.id, 'shortcut')
  assert.equal(linkDiscovery.root.kind, 'symlink')
  assert.deepEqual(linkDiscovery.entries, [])
  assert.equal((await f.filesystem.inspect(value.id, root.id)).kind, 'symlink')
  assert.deepEqual((await f.filesystem.discover(value.id, root.id)).entries, [])
  assert.equal((await f.filesystem.inspect(value.id, underneathLink.id)).state, 'unavailable')
  assert.deepEqual((await f.filesystem.discover(value.id, underneathLink.id)).entries, [])
  await assert.rejects(f.filesystem.read(value.id, location.id, 'shortcut/secret.txt'), /符号链接|junction/)
  await assert.rejects(f.filesystem.read(value.id, location.id, 'shortcut'), /符号链接|junction/)
  await assert.rejects(f.filesystem.read(value.id, root.id, 'secret.txt'), /符号链接|junction/)
  await assert.rejects(f.filesystem.read(value.id, underneathLink.id, 'secret.txt'), /符号链接|junction/)
  assert.deepEqual(f.core.workspaces.get(value.id).relations, [])
})

test('恢复别机位置保留原引用并报告 unavailable，不自动绑定本机同名路径', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  await writeFile(join(f.nativeDirectory, 'same-name.txt'), '本机内容不是别机身份')
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  await f.filesystem.dispose()
  const database = new DatabaseSync(join(f.dataDirectory, 'filesystem.sqlite'))
  try {
    database.prepare('UPDATE locations SET hostname = ?, reference_namespace = ? WHERE id = ?')
      .run('restored-other-host', 'locus.filesystem:restored-other-host', location.id)
  } finally {
    database.close()
  }
  await f.restart()
  const restored = f.filesystem.locations(value.id)[0]
  assert.equal(restored.id, location.id)
  assert.equal(restored.path, location.path)
  assert.equal(restored.reference.namespace, 'locus.filesystem:restored-other-host')
  const observed = await f.filesystem.inspect(value.id, location.id)
  assert.equal(observed.state, 'unavailable')
  assert.deepEqual(observed.reference, restored.reference)
  assert.deepEqual((await f.filesystem.discover(value.id, location.id)).entries, [])
  await assert.rejects(f.filesystem.read(value.id, location.id, 'same-name.txt'), /其他主机/)
  const explicitLocal = f.filesystem.register(value.id, f.nativeDirectory)
  assert.notEqual(explicitLocal.id, location.id)
  assert.equal(f.filesystem.locations(value.id).length, 2)
  assert.equal((await f.filesystem.inspect(value.id, explicitLocal.id)).state, 'accessible')
  assert.equal((await f.filesystem.inspect(value.id, location.id)).state, 'unavailable')
})

test('观察区分通用原生错误，error 不回显原生异常中的路径或内容', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  const sensitiveName = `private-token-${'x'.repeat(40000)}`
  const observed = await f.filesystem.inspect(value.id, location.id, sensitiveName)
  assert.equal(observed.state, 'error')
  assert.equal(observed.kind, 'unknown')
  assert.match(observed.error, /ENAMETOOLONG/)
  assert.equal(observed.error.includes('private-token'), false)
  await assert.rejects(f.filesystem.read(value.id, location.id, sensitiveName), error => {
    assert.equal(error.message.includes('private-token'), false)
    assert.match(error.message, /ENAMETOOLONG/)
    return true
  })
})

test('原生权限拒绝报告 denied，而不是删除登记或伪造 missing', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const path = join(f.nativeDirectory, 'private.txt')
  await writeFile(path, '不可回显的内容')
  const location = f.filesystem.register(value.id, path)
  try {
    if (process.platform === 'win32') {
      const denied = spawnSync('icacls', [path, '/deny', `${process.env.USERNAME}:(R)`], { encoding: 'utf8' })
      assert.equal(denied.status, 0, denied.stderr || denied.stdout)
    } else {
      await chmod(path, 0)
    }
    const observed = await f.filesystem.inspect(value.id, location.id)
    if (process.platform !== 'win32' && observed.state === 'accessible') {
      t.skip('当前用户可绕过文件权限，不能制造真实 EACCES')
      return
    }
    assert.equal(observed.state, 'denied')
    assert.equal(observed.kind, 'file')
    assert.match(observed.error, /EACCES|EPERM/)
    assert.equal(observed.error.includes('不可回显'), false)
    await assert.rejects(f.filesystem.read(value.id, location.id), /拒绝访问/)
    assert.equal(f.filesystem.locations(value.id).length, 1)
  } finally {
    if (process.platform === 'win32') {
      const restored = spawnSync('icacls', [path, '/remove:d', process.env.USERNAME], { encoding: 'utf8' })
      assert.equal(restored.status, 0, restored.stderr || restored.stdout)
    } else {
      await chmod(path, 0o600)
    }
  }
})

test('未知版本与损坏库拒绝打开，绝不覆盖成空配置', async t => {
  for (const kind of ['unknown-version', 'corrupt']) {
    await t.test(kind, async child => {
      const f = await fixture(child)
      const value = workspace(f)
      const file = join(f.dataDirectory, 'filesystem.sqlite')
      f.filesystem.register(value.id, f.nativeDirectory)
      await f.filesystem.dispose()
      if (kind === 'unknown-version') {
        const database = new DatabaseSync(file)
        try {
          database.exec('PRAGMA user_version = 77')
        } finally {
          database.close()
        }
      } else {
        await writeFile(file, '损坏内容，不允许重建')
      }
      await f.restart()
      const before = await readFile(file)
      assert.throws(() => f.filesystem.locations(value.id), kind === 'corrupt' ? /database|数据库/i : /版本/)
      assert.deepEqual(await readFile(file), before)
    })
  }
})

test('初始化中断留下的空 Filesystem 库可安全建立结构', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  await mkdir(f.dataDirectory, { recursive: true })
  const file = join(f.dataDirectory, 'filesystem.sqlite')
  await writeFile(file, '')
  assert.deepEqual(f.filesystem.locations(value.id), [])
  assert.ok((await readFile(file)).length > 0)
})

test('SQLite 写锁明确失败且保留已提交位置，释放写锁后才能登记新位置', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const first = f.filesystem.register(value.id, f.nativeDirectory)
  const database = new DatabaseSync(join(f.dataDirectory, 'filesystem.sqlite'))
  try {
    database.exec('BEGIN IMMEDIATE')
    assert.throws(() => f.filesystem.register(value.id, join(f.root, 'later')), /locked|busy/i)
    assert.deepEqual(f.filesystem.locations(value.id), [first])
    database.exec('ROLLBACK')
  } finally {
    if (database.isTransaction) database.exec('ROLLBACK')
    database.close()
  }
  const next = f.filesystem.register(value.id, join(f.root, 'later'))
  await f.restart()
  assert.deepEqual(f.filesystem.locations(value.id), [first, next])
})

test('释放服务等待正在进行的有界 I/O，之后拒绝新调用且重复释放幂等', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  await writeFile(join(f.nativeDirectory, 'active.txt'), 'a'.repeat(65537))
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  const reading = f.filesystem.read(value.id, location.id, 'active.txt')
  const disposal = f.filesystem.dispose()
  assert.equal(f.filesystem.dispose(), disposal)
  const result = await reading
  await disposal
  assert.equal(result.text.length, 65536)
  assert.equal(result.truncated, true)
  assert.throws(() => f.filesystem.locations(value.id), /已释放/)
  await assert.rejects(f.filesystem.inspect(value.id, location.id), /已释放/)
  assert.equal(await readFile(join(f.nativeDirectory, 'active.txt'), 'utf8'), 'a'.repeat(65537))
})
