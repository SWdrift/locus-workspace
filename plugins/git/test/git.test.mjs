import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { createLocusCore } from '../../../packages/core/lib/index.js'
import { createFilesystemService } from '../../filesystem/lib/index.js'
import { capability, createGitService, inject, name } from '../lib/index.js'

const exec = promisify(execFile)

async function nativeGit(directory, ...args) {
  const result = await exec('git', [
    '--no-pager', '--no-optional-locks',
    '-c', 'core.fsmonitor=false',
    '-c', 'core.autocrlf=false',
    '-c', `core.hooksPath=${join(directory, '.git', 'locus-unused-hooks')}`,
    '-c', 'commit.gpgSign=false',
    '-C', directory,
    ...args,
  ], {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  })
  return result.stdout.replace(/\r?\n$/, '')
}

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'locus-git-')))
  const dataDirectory = join(root, 'data')
  const nativeDirectory = join(root, 'native')
  await mkdir(nativeDirectory)
  const core = createLocusCore({ dataDirectory })
  const filesystem = createFilesystemService(core)
  const git = createGitService(core, filesystem)
  t.after(async () => {
    try {
      await git.dispose()
      await filesystem.dispose()
      await core.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  return { root, dataDirectory, nativeDirectory, core, filesystem, git }
}

function workspace(f) {
  const value = f.core.workspaces.create('Git 工作语境')
  f.core.workspaces.configureCapability(value.id, f.filesystem.capability)
  f.core.workspaces.configureCapability(value.id, f.git.capability)
  return value
}

async function initialize(directory) {
  await nativeGit(directory, 'init', '--initial-branch=main', '--template=')
}

async function commitFile(directory) {
  await writeFile(join(directory, 'tracked.txt'), '已提交的内容\n')
  await nativeGit(directory, 'add', '--', 'tracked.txt')
  await nativeGit(directory,
    '-c', 'user.name=Locus Git Test',
    '-c', 'user.email=locus-git-test@example.invalid',
    'commit', '--no-gpg-sign', '-m', 'initial')
  return nativeGit(directory, 'rev-parse', 'HEAD')
}

test('Git 声明与原生可用性独立于 Workspace 配置，查询不创建持久化数据', async t => {
  const f = await fixture(t)
  assert.equal(name, 'locus-git')
  assert.deepEqual(inject, ['locus', 'locusFilesystem'])
  assert.deepEqual(capability, { id: 'locus.git', provider: '@locus/git', tags: ['development'] })
  assert.equal(f.git.capability, capability)
  assert.equal(Object.isFrozen(capability), true)
  assert.equal(Object.isFrozen(capability.tags), true)
  assert.deepEqual(await f.git.availability(), { available: true })
  await assert.rejects(stat(f.dataDirectory), { code: 'ENOENT' })
})

test('真实提交、仓库根和 Remote 只读观察保留来源，输出脱敏不改变原生配置', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  await initialize(f.nativeDirectory)
  const commit = await commitFile(f.nativeDirectory)
  const raw = 'https://fake-user:fake-password@example.invalid/team/repo.git?access_token=fake-token&view=tree#client_secret=fake-fragment'
  const remotes = [
    ['origin', raw, 'https://example.invalid/team/repo.git?[REDACTED]'],
    ['ssh', 'git@example.invalid:team/repo.git', 'git@example.invalid:team/repo.git'],
    ['fragment', 'http://fake-user@example.invalid/repo.git#fake-fragment-only', 'http://example.invalid/repo.git#[REDACTED]'],
    ['encoded', 'HTTPS://fake%40user:fake%2Fpassword@example.invalid/repo.git?arbitrary=fake-unknown-secret', 'HTTPS://example.invalid/repo.git?[REDACTED]'],
    ['ssh-query', 'ssh://git@example.invalid/team/repo.git?password=fake-ssh-secret', 'ssh://example.invalid/team/repo.git?[REDACTED]'],
    ['ftp', 'ftp://fake-user:fake-password@example.invalid/repo.git', 'ftp://example.invalid/repo.git'],
    ['ssh-password', 'ssh://git:fake-password@example.invalid/repo.git', 'ssh://example.invalid/repo.git'],
  ]
  for (const [remote, url] of remotes) await nativeGit(f.nativeDirectory, 'remote', 'add', remote, url)
  const before = await readFile(join(f.nativeDirectory, '.git', 'config'))
  const observed = await f.git.inspect(value.id, location.id)
  assert.equal(observed.workspaceId, value.id)
  assert.equal(observed.locationId, location.id)
  assert.equal(observed.state, 'repository')
  assert.equal(observed.filesystem.state, 'accessible')
  assert.equal(observed.filesystem.path, location.path)
  assert.deepEqual(observed.filesystem.reference, location.reference)
  assert.equal(observed.root, f.nativeDirectory)
  assert.deepEqual(observed.reference, { namespace: `locus.git:${hostname()}`, id: pathToFileURL(f.nativeDirectory).href })
  assert.equal(observed.branch, 'main')
  assert.equal(observed.commit, commit)
  assert.equal(observed.dirty, false)
  assert.ok(Number.isFinite(Date.parse(observed.observedAt)))
  const byName = new Map(observed.remotes.map(remote => [remote.name, remote.url]))
  assert.equal(byName.size, remotes.length)
  for (const [remote, , redacted] of remotes) assert.equal(byName.get(remote), redacted)
  assert.equal(JSON.stringify(observed).includes('fake-'), false)
  assert.deepEqual(await readFile(join(f.nativeDirectory, '.git', 'config')), before)
  assert.equal(await nativeGit(f.nativeDirectory, 'remote', 'get-url', 'origin'), raw)
  assert.deepEqual(f.core.workspaces.get(value.id).relations, [])

  const file = await f.git.inspect(value.id, location.id, 'tracked.txt')
  assert.equal(file.filesystem.kind, 'file')
  assert.equal(file.filesystem.path, join(f.nativeDirectory, 'tracked.txt'))
  assert.equal(file.root, observed.root)
  assert.deepEqual(file.reference, observed.reference)
})

test('unborn 的 commit 为 null，未跟踪、工作树与暂存区变更都实时反映 dirty', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  await initialize(f.nativeDirectory)
  const empty = await f.git.inspect(value.id, location.id)
  assert.equal(empty.state, 'repository')
  assert.equal(empty.branch, 'main')
  assert.equal(empty.commit, null)
  assert.equal(empty.dirty, false)
  assert.deepEqual(empty.remotes, [])
  await writeFile(join(f.nativeDirectory, 'untracked.txt'), '尚未跟踪')
  assert.equal((await f.git.inspect(value.id, location.id)).dirty, true)
  await rm(join(f.nativeDirectory, 'untracked.txt'))
  const committed = await commitFile(f.nativeDirectory)
  assert.equal((await f.git.inspect(value.id, location.id)).dirty, false)
  await writeFile(join(f.nativeDirectory, 'tracked.txt'), '修改工作树\n')
  const dirty = await f.git.inspect(value.id, location.id)
  assert.equal(dirty.dirty, true)
  assert.equal(dirty.commit, committed)
  await nativeGit(f.nativeDirectory, 'add', '--', 'tracked.txt')
  assert.equal((await f.git.inspect(value.id, location.id)).dirty, true)
})

test('detached HEAD 的 branch 为 null，提交和仓库引用仍可观察', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  await initialize(f.nativeDirectory)
  const commit = await commitFile(f.nativeDirectory)
  await nativeGit(f.nativeDirectory, 'checkout', '--detach', commit)
  const observed = await f.git.inspect(value.id, location.id)
  assert.equal(observed.state, 'repository')
  assert.equal(observed.branch, null)
  assert.equal(observed.commit, commit)
  assert.equal(observed.dirty, false)
  assert.equal(observed.reference.id, pathToFileURL(f.nativeDirectory).href)
})

test('普通非 Git 目录正常返回 not-repository，不伪造仓库字段或修改 Workspace', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  const before = f.core.workspaces.get(value.id)
  const observed = await f.git.inspect(value.id, location.id)
  assert.equal(observed.state, 'not-repository')
  assert.equal(observed.filesystem.state, 'accessible')
  assert.deepEqual(observed.filesystem.reference, location.reference)
  for (const key of ['root', 'reference', 'branch', 'commit', 'dirty', 'remotes', 'error']) {
    assert.equal(Object.hasOwn(observed, key), false)
  }
  assert.deepEqual(f.core.workspaces.get(value.id), before)
})

test('原生退出码 128 的仓库格式错误保留 error，不误报为非仓库', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  await initialize(f.nativeDirectory)
  await nativeGit(f.nativeDirectory, 'config', 'core.repositoryformatversion', '99')
  const observed = await f.git.inspect(value.id, location.id)
  assert.equal(observed.state, 'error')
  assert.equal(observed.filesystem.state, 'accessible')
  assert.match(observed.error, /128/)
  assert.equal(f.filesystem.locations(value.id).length, 1)
})

test('未选择匹配 Git 或 Filesystem 提供方时拒绝用例，保留 Workspace 与登记', async t => {
  const f = await fixture(t)
  const value = f.core.workspaces.create('前置配置失败不删除语境')
  f.core.workspaces.configureCapability(value.id, f.filesystem.capability)
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  await assert.rejects(f.git.inspect(value.id, location.id), /尚未启用能力 locus\.git/)
  f.core.workspaces.configureCapability(value.id, { ...capability, provider: '@other/git' })
  await assert.rejects(f.git.inspect(value.id, location.id), /尚未启用能力 locus\.git/)
  f.core.workspaces.removeCapability(value.id, capability.id)
  f.core.workspaces.configureCapability(value.id, capability)
  f.core.workspaces.link(value.id, 'member', location.reference, { kind: 'manual', detail: '明确保留的位置成员' })
  f.core.workspaces.removeCapability(value.id, f.filesystem.capability.id)
  const before = f.core.workspaces.get(value.id)
  await assert.rejects(f.git.inspect(value.id, location.id), /尚未启用能力 locus\.filesystem/)
  assert.deepEqual(f.core.workspaces.get(value.id), before)
  assert.deepEqual(f.filesystem.locations(value.id), [location])
  f.core.workspaces.configureCapability(value.id, { ...f.filesystem.capability, provider: '@other/filesystem' })
  await assert.rejects(f.git.inspect(value.id, location.id), /尚未启用能力 locus\.filesystem/)
  await assert.rejects(f.git.inspect(value.id, 'unknown-location'), /尚未启用能力 locus\.filesystem/)
})

test('仓库路径消失返回真实 Filesystem 来源和 unavailable，显式确认的关联不丢失', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  await initialize(f.nativeDirectory)
  await commitFile(f.nativeDirectory)
  const found = await f.git.inspect(value.id, location.id)
  assert.deepEqual(f.core.workspaces.get(value.id).relations, [])
  f.core.workspaces.link(value.id, 'association', found.reference, { kind: 'discovery', detail: `位置 ${location.id} 的显式 Git 确认` })
  const before = f.core.workspaces.get(value.id)
  await rm(f.nativeDirectory, { recursive: true })
  const missing = await f.git.inspect(value.id, location.id)
  assert.equal(missing.state, 'unavailable')
  assert.equal(missing.workspaceId, value.id)
  assert.equal(missing.locationId, location.id)
  assert.equal(missing.filesystem.state, 'missing')
  assert.equal(missing.filesystem.path, location.path)
  assert.deepEqual(missing.filesystem.reference, location.reference)
  assert.deepEqual(f.core.workspaces.get(value.id), before)
  assert.deepEqual(f.filesystem.locations(value.id), [location])
  await f.git.dispose()
  assert.deepEqual(f.core.workspaces.get(value.id), before)
})

test('Git 缺失时 availability 和观察均明确 unavailable，不影响原生文件或来源', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  await initialize(f.nativeDirectory)
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
  const original = process.env[pathKey]
  try {
    process.env[pathKey] = ''
    const availability = await f.git.availability()
    assert.equal(availability.available, false)
    assert.match(availability.error, /ENOENT/)
    const observed = await f.git.inspect(value.id, location.id)
    assert.equal(observed.state, 'unavailable')
    assert.match(observed.error, /ENOENT/)
    assert.deepEqual(observed.filesystem.reference, location.reference)
    assert.equal(observed.filesystem.state, 'accessible')
  } finally {
    if (original === undefined) delete process.env[pathKey]
    else process.env[pathKey] = original
  }
  assert.equal((await f.git.availability()).available, true)
  assert.equal((await stat(join(f.nativeDirectory, '.git'))).isDirectory(), true)
})

test('符号链接或 junction 只返回 Filesystem 观察，不跟随到真实仓库', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  await initialize(f.nativeDirectory)
  const linked = join(f.root, 'linked-repository')
  await symlink(f.nativeDirectory, linked, process.platform === 'win32' ? 'junction' : 'dir')
  const location = f.filesystem.register(value.id, linked)
  const observed = await f.git.inspect(value.id, location.id)
  assert.equal(observed.state, 'unavailable')
  assert.equal(observed.filesystem.state, 'accessible')
  assert.equal(observed.filesystem.kind, 'symlink')
  assert.equal(observed.filesystem.path, linked)
  assert.equal(observed.reference, undefined)
})

test('特殊文件不作为 Git 路径跟随', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const fifo = join(f.nativeDirectory, 'pipe')
  await exec('mkfifo', [fifo], { timeout: 10000 })
  const location = f.filesystem.register(value.id, fifo)
  const observed = await f.git.inspect(value.id, location.id)
  assert.equal(observed.state, 'unavailable')
  assert.equal(observed.filesystem.kind, 'other')
  assert.equal(observed.reference, undefined)
})

test('status 不执行用户 fsmonitor 钩子，不写入 index 或原生配置', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  await initialize(f.nativeDirectory)
  await commitFile(f.nativeDirectory)
  const hook = join(f.root, 'fsmonitor-hook')
  await writeFile(hook, '#!/bin/sh\nprintf called > "${0}.called"\nexit 0\n')
  await chmod(hook, 0o755)
  await nativeGit(f.nativeDirectory, 'config', 'core.fsmonitor', hook)
  const index = join(f.nativeDirectory, '.git', 'index')
  const configuration = join(f.nativeDirectory, '.git', 'config')
  const indexBefore = await readFile(index)
  const configBefore = await readFile(configuration)
  const indexTime = (await stat(index)).mtimeMs
  await writeFile(join(f.nativeDirectory, 'tracked.txt'), '真实工作树修改\n')
  const observed = await f.git.inspect(value.id, location.id)
  assert.equal(observed.state, 'repository')
  assert.equal(observed.dirty, true)
  await assert.rejects(stat(`${hook}.called`), { code: 'ENOENT' })
  assert.deepEqual(await readFile(index), indexBefore)
  assert.equal((await stat(index)).mtimeMs, indexTime)
  assert.deepEqual(await readFile(configuration), configBefore)
})

test('原生配置读取拒绝是 error，不是 not-repository，恢复权限后资源仍在', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  await initialize(f.nativeDirectory)
  const configuration = join(f.nativeDirectory, '.git', 'config')
  try {
    if (process.platform === 'win32') {
      await exec('icacls', [configuration, '/deny', `${process.env.USERNAME}:(R)`], { timeout: 10000 })
    } else {
      await chmod(configuration, 0)
    }
    const observed = await f.git.inspect(value.id, location.id)
    if (process.platform !== 'win32' && observed.state === 'repository') {
      t.skip('当前用户可绕过文件权限，不能制造真实 Git 权限拒绝')
      return
    }
    assert.equal(observed.state, 'error')
    assert.equal(observed.filesystem.state, 'accessible')
    assert.deepEqual(observed.filesystem.reference, location.reference)
    assert.equal(f.filesystem.locations(value.id).length, 1)
  } finally {
    if (process.platform === 'win32') {
      await exec('icacls', [configuration, '/remove:d', process.env.USERNAME], { timeout: 10000 })
    } else {
      await chmod(configuration, 0o600)
    }
  }
})

test('dispose 阻止新操作并等待已接收的观察完成，不释放 Filesystem 或 Core', async t => {
  const f = await fixture(t)
  const value = workspace(f)
  const location = f.filesystem.register(value.id, f.nativeDirectory)
  await initialize(f.nativeDirectory)
  await commitFile(f.nativeDirectory)
  const inspecting = f.git.inspect(value.id, location.id)
  const disposal = f.git.dispose()
  assert.equal(f.git.dispose(), disposal)
  await assert.rejects(f.git.availability(), /已释放/)
  await assert.rejects(f.git.inspect(value.id, location.id), /已释放/)
  assert.equal((await inspecting).state, 'repository')
  await disposal
  assert.equal((await f.filesystem.inspect(value.id, location.id)).state, 'accessible')
  assert.equal(f.core.workspaces.get(value.id).id, value.id)
  assert.equal((await stat(join(f.nativeDirectory, '.git'))).isDirectory(), true)
})
