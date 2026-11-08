import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createLocusCore } from '../packages/core/lib/index.js'
import { createFilesystemService } from '../plugins/filesystem/lib/index.js'
import { createGitService } from '../plugins/git/lib/index.js'
import { createSessionService } from '../plugins/session/lib/index.js'
import { createCommands } from '../plugins/cli/lib/commands.js'

/** 复用真实应用命令树，但不启动 launcher；DSH profile 装配由 smoke 覆盖。 */
async function invoke(services, argv) {
  const commands = createCommands(services.locus, services.filesystem, services.git, services.session)
  const silence = (program) => {
    program.exitOverride()
    program.configureOutput({ writeOut() {}, writeErr() {} })
    for (const child of program.commands) silence(child)
  }
  silence(commands.program)
  try {
    commands.program.parse(argv, { from: 'user' })
  } catch (error) {
    return { exitCode: error.exitCode ?? 1, error }
  }
  const pending = commands.execute()
  if (!pending) return { exitCode: 1, error: new Error('未选择命令') }
  return { ...(await pending), json: commands.json() }
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-cli-'))
  const data = join(root, 'data')
  const resources = join(root, 'resources')
  const parent = join(resources, 'parent')
  const child = join(parent, 'child')
  const sibling = join(resources, 'sibling')
  mkdirSync(child, { recursive: true })
  mkdirSync(sibling)
  writeFileSync(join(parent, 'note.txt'), 'CLI file\n')
  writeFileSync(join(child, 'child.txt'), 'child file\n')
  let core = createLocusCore({ dataDirectory: data })
  let filesystem = createFilesystemService(core)
  let git = createGitService(core, filesystem)
  const sessionRecords = []
  const sessionQuery = {
    async listSessions() {
      return sessionRecords
    },
    async filterSessions(filters) {
      const id = filters[0].values[0]
      return sessionRecords.filter((record) => record.header.id === id)
    },
    async readTitleSnapshot(sessionId) {
      return {
        session: { version: 4, id: sessionId, createdAt: 1_700_000_000_000, isSeeded: false },
        title: {
          title: 'CLI Session',
          messageSeqs: [],
          source: { kind: 'user' },
          eventSeq: 1,
          updatedAt: 1_700_000_000_000,
        },
      }
    },
  }
  let session = createSessionService({
    source: { home: 'C:/tmp/locus-cli-dsh', label: 'locus' },
    query: () => sessionQuery,
  })
  t.after(async () => {
    await git.dispose()
    await filesystem.dispose()
    await core.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root, data, resources, parent, child, sibling,
    sessionRecords,
    services: () => ({ locus: core, filesystem, git, session }),
    async restart() {
      await git.dispose()
      await filesystem.dispose()
      await core.dispose()
      core = createLocusCore({ dataDirectory: data })
      filesystem = createFilesystemService(core)
      git = createGitService(core, filesystem)
      session = createSessionService({
        source: { home: 'C:/tmp/locus-cli-dsh', label: 'locus' },
        query: () => sessionQuery,
      })
    },
  }
}

async function createWorkspace(f, name) {
  return (await invoke(f.services(), ['workspace', 'create', name])).value
}

function sessionRecord(id, { header = {}, ...overrides } = {}) {
  return {
    header: {
      version: 4,
      id,
      createdAt: 1_700_000_000_000,
      cwd: 'C:/work/session',
      isSeeded: false,
      ...header,
    },
    live: true,
    persisted: true,
    ...overrides,
  }
}

test('Workspace 独立于目录，能力选择与提供方包名均可配置', async (t) => {
  const f = fixture(t)
  const a = await createWorkspace(f, 'Research')
  const c = await createWorkspace(f, 'NoDirectory')
  assert.equal(c.relations.length, 0)
  assert.equal(c.capabilities.length, 0)

  const declared = (await invoke(f.services(), ['capability', 'list', a.id])).value
    .find((item) => item.id === 'locus.filesystem')
  assert.equal(declared.declared, true)
  assert.equal(declared.configured, false)
  await assert.rejects(
    invoke(f.services(), ['fs', 'register', c.id, f.parent]),
    /尚未启用能力 locus\.filesystem/,
  )
  const configured = (await invoke(f.services(), ['capability', 'configure', a.id, '@locus/filesystem'])).value
  assert.deepEqual(configured.capabilities.map((item) => item.id), ['locus.filesystem'])
  assert.equal(configured.capabilities[0].provider, '@locus/filesystem')
})

test('发现与确认分离，共享/父子位置与嵌套引用保持独立', async (t) => {
  const f = fixture(t)
  const a = await createWorkspace(f, 'A')
  const b = await createWorkspace(f, 'B')
  for (const workspace of [a, b]) await invoke(f.services(), ['capability', 'configure', workspace.id, 'filesystem'])
  const shared = (await invoke(f.services(), ['fs', 'register', a.id, f.parent])).value
  const otherShared = (await invoke(f.services(), ['fs', 'register', b.id, f.parent])).value
  const child = (await invoke(f.services(), ['fs', 'register', a.id, f.child])).value
  const missing = (await invoke(f.services(), ['fs', 'register', a.id, join(f.root, 'missing')])).value
  assert.deepEqual(shared.reference, otherShared.reference)
  assert.equal((await invoke(f.services(), ['fs', 'locations', a.id])).value.length, 3)

  const discovered = (await invoke(f.services(), ['fs', 'discover', a.id, shared.id])).value
  assert.equal(discovered.root.state, 'accessible')
  assert.ok(discovered.entries.some((entry) => entry.path === join(f.parent, 'note.txt')))
  assert.deepEqual((await invoke(f.services(), ['workspace', 'show', a.id])).value.relations, [])
  assert.equal((await invoke(f.services(), ['fs', 'inspect', a.id, missing.id])).value.state, 'missing')

  const member = (await invoke(f.services(), ['fs', 'confirm', a.id, shared.id, 'note.txt'])).value
  assert.equal(member.kind, 'member')
  assert.equal(member.source.kind, 'discovery')
  const repeated = (await invoke(f.services(), ['fs', 'confirm', a.id, shared.id, 'note.txt'])).value
  assert.equal(repeated.id, member.id)
  const association = (await invoke(f.services(), ['fs', 'confirm', a.id, child.id, 'child.txt', '--kind', 'association'])).value
  assert.equal(association.kind, 'association')
  await invoke(f.services(), ['fs', 'confirm', b.id, otherShared.id, 'note.txt'])
  await invoke(f.services(), ['workspace', 'link', a.id, 'locus.workspace', b.id, '--kind', 'member'])
  assert.equal((await invoke(f.services(), ['workspace', 'show', a.id])).value.relations.length, 3)
  await assert.rejects(
    invoke(f.services(), ['workspace', 'link', b.id, 'locus.workspace', b.id]),
    /不能把自身/,
  )
})

test('读取、改名、取消位置与关系不删除共享资源；缺失插件仍保留长期事实', async (t) => {
  const f = fixture(t)
  const a = await createWorkspace(f, 'A')
  const b = await createWorkspace(f, 'B')
  for (const workspace of [a, b]) await invoke(f.services(), ['capability', 'configure', workspace.id, 'filesystem'])
  const shared = (await invoke(f.services(), ['fs', 'register', a.id, f.parent])).value
  const bShared = (await invoke(f.services(), ['fs', 'register', b.id, f.parent])).value
  const member = (await invoke(f.services(), ['fs', 'confirm', a.id, shared.id, 'note.txt'])).value
  await invoke(f.services(), ['fs', 'confirm', b.id, bShared.id, 'note.txt'])
  assert.equal((await invoke(f.services(), ['fs', 'read', a.id, shared.id, 'note.txt'])).value.text, 'CLI file\n')
  await assert.rejects(invoke(f.services(), ['fs', 'read', a.id, shared.id, '../outside']), /越过/)
  const renamed = (await invoke(f.services(), ['workspace', 'rename', a.id, 'A2'])).value
  assert.equal(renamed.id, a.id)

  const index = readFileSync(join(f.parent, 'note.txt'))
  const withoutPlugins = { locus: f.services().locus, filesystem: undefined, git: undefined }
  const saved = (await invoke(withoutPlugins, ['capability', 'list', a.id])).value
    .find((item) => item.id === 'locus.filesystem')
  assert.equal(saved.declared, false)
  assert.equal(saved.configured, true)
  assert.equal(saved.loaded, false)
  assert.equal(saved.available, false)
  assert.equal((await invoke(withoutPlugins, ['workspace', 'show', a.id])).value.relations.length, 1)
  await assert.rejects(invoke(withoutPlugins, ['fs', 'register', a.id, f.sibling]), /Filesystem 能力不可用/)

  const noConfirm = await invoke(f.services(), ['workspace', 'unlink', a.id, member.id])
  assert.equal(noConfirm.exitCode, 1)
  await invoke(f.services(), ['workspace', 'unlink', a.id, member.id, '--yes'])
  await invoke(f.services(), ['fs', 'unregister', a.id, shared.id, '--yes'])
  assert.deepEqual(readFileSync(join(f.parent, 'note.txt')), index)
  assert.equal((await invoke(f.services(), ['workspace', 'show', b.id])).value.relations.length, 1)
  assert.equal((await invoke(f.services(), ['fs', 'read', b.id, bShared.id, 'note.txt'])).value.text, 'CLI file\n')
  await invoke(f.services(), ['capability', 'remove', b.id, '@locus/filesystem', '--yes'])
  assert.equal((await invoke(f.services(), ['fs', 'locations', b.id])).value.length, 1)
  await assert.rejects(invoke(f.services(), ['fs', 'inspect', b.id, bShared.id]), /尚未启用能力 locus\.filesystem/)
})

test('重启恢复身份、关系与位置；JSON 与无参数/未知命令行为稳定', async (t) => {
  const f = fixture(t)
  const a = await createWorkspace(f, 'Persisted')
  await invoke(f.services(), ['capability', 'configure', a.id, 'filesystem'])
  const location = (await invoke(f.services(), ['fs', 'register', a.id, f.parent])).value
  const relation = (await invoke(f.services(), ['fs', 'confirm', a.id, location.id, 'note.txt'])).value
  const shown = await invoke(f.services(), ['workspace', 'show', a.id, '--json'])
  assert.equal(shown.json, true)
  assert.equal(shown.value.id, a.id)

  await f.restart()
  const restored = (await invoke(f.services(), ['workspace', 'show', a.id])).value
  assert.equal(restored.id, a.id)
  assert.equal(restored.relations[0].id, relation.id)
  assert.equal((await invoke(f.services(), ['fs', 'locations', a.id])).value[0].id, location.id)

  const unknown = await invoke(f.services(), ['bogus'])
  assert.equal(unknown.exitCode, 1)
  assert.match(unknown.error.message, /未知命令：bogus/)
  const empty = await invoke(f.services(), [])
  assert.equal(empty.exitCode, 1)
  assert.match(empty.error.message, /请指定命令/)
})

test('Git 从 Filesystem 线索读取真实仓库，非仓库正常且 Remote 脱敏', async (t) => {
  const f = fixture(t)
  const workspace = await createWorkspace(f, 'Repo')
  await invoke(f.services(), ['capability', 'configure', workspace.id, 'filesystem'])
  await invoke(f.services(), ['capability', 'configure', workspace.id, 'git'])
  const repo = join(f.resources, 'repo')
  mkdirSync(repo)
  const native = (args) => {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 10000 })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  native(['init', '--initial-branch=main'])
  writeFileSync(join(repo, 'tracked.txt'), 'git file\n')
  native(['add', 'tracked.txt'])
  native(['-c', 'user.name=CLI Test', '-c', 'user.email=cli@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'initial'])
  native(['remote', 'add', 'origin', 'https://user:secret@example.invalid/repo.git?token=hidden'])
  const repoLocation = (await invoke(f.services(), ['fs', 'register', workspace.id, repo])).value
  const observed = (await invoke(f.services(), ['git', 'inspect', workspace.id, repoLocation.id])).value
  assert.equal(observed.state, 'repository')
  assert.equal(observed.branch, 'main')
  assert.equal(JSON.stringify(observed).includes('secret'), false)
  const nonRepo = (await invoke(f.services(), ['git', 'inspect', workspace.id, (await invoke(f.services(), ['fs', 'register', workspace.id, f.sibling])).value.id])).value
  assert.equal(nonRepo.state, 'not-repository')
  const relation = (await invoke(f.services(), ['git', 'confirm', workspace.id, repoLocation.id])).value
  assert.deepEqual(relation.target, observed.reference)
  assert.equal((await invoke(f.services(), ['workspace', 'show', workspace.id])).value.relations.length, 1)
})

test('Session 发现、显式关联、跨 Workspace 复用与解除不删除原生 Session', async (t) => {
  const f = fixture(t)
  const a = await createWorkspace(f, 'SessionA')
  const b = await createWorkspace(f, 'SessionB')
  await invoke(f.services(), ['capability', 'configure', a.id, 'session'])
  await invoke(f.services(), ['capability', 'configure', b.id, 'session'])
  f.sessionRecords.push(
    sessionRecord('session-live'),
    sessionRecord('session-cold', { live: false, header: { cwd: 'C:/work/other' } }),
  )

  const listed = await invoke(f.services(), ['session', 'list', '--json'])
  assert.equal(listed.json, true)
  assert.deepEqual(listed.value.map((item) => item.sessionId), ['session-live', 'session-cold'])
  assert.equal(JSON.stringify(listed.value).includes('events'), false)
  assert.equal(listed.value[1].state, 'persisted')
  assert.equal(listed.value[1].cwd, 'C:/work/other')

  const shown = await invoke(f.services(), ['session', 'show', 'session-live'])
  assert.equal(shown.exitCode, 0)
  assert.equal(shown.value.title, 'CLI Session')
  assert.equal(shown.value.state, 'live')

  const relationA = (await invoke(f.services(), ['session', 'associate', a.id, 'session-live'])).value
  assert.equal(relationA.kind, 'association')
  assert.equal(relationA.target.id, 'session-live')
  assert.match(relationA.target.namespace, /^dsh\.session\./)
  const relationB = (await invoke(f.services(), ['session', 'associate', b.id, 'session-live'])).value
  assert.notEqual(relationA.id, relationB.id)
  assert.equal((await invoke(f.services(), ['session', 'associate', a.id, 'session-cold'])).value.target.id, 'session-cold')

  const links = (await invoke(f.services(), ['session', 'links', a.id])).value
  assert.equal(links.length, 2)
  assert.deepEqual(links.map((item) => item.summary.state), ['live', 'persisted'])
  assert.match(links[0].summary.title, /CLI Session/)

  const noConfirm = await invoke(f.services(), ['session', 'dissociate', a.id, relationA.id])
  assert.equal(noConfirm.exitCode, 1)
  await invoke(f.services(), ['session', 'dissociate', a.id, relationA.id, '--yes'])
  assert.equal((await invoke(f.services(), ['workspace', 'show', a.id])).value.relations.length, 1)
  assert.equal((await invoke(f.services(), ['workspace', 'show', b.id])).value.relations.length, 1)
  assert.equal((await invoke(f.services(), ['session', 'list'])).value.length, 2)
})

test('Session 查询不可用或插件停用时不删除已保存关联', async (t) => {
  const f = fixture(t)
  const workspace = await createWorkspace(f, 'Offline')
  await invoke(f.services(), ['capability', 'configure', workspace.id, 'session'])
  f.sessionRecords.push(sessionRecord('session-live'))
  const relation = (await invoke(f.services(), ['session', 'associate', workspace.id, 'session-live'])).value

  const withoutSession = {
    locus: f.services().locus,
    filesystem: f.services().filesystem,
    git: f.services().git,
    session: undefined,
  }
  const links = (await invoke(withoutSession, ['session', 'links', workspace.id])).value
  assert.equal(links[0].summary.state, 'unavailable')
  assert.match(links[0].summary.error, /locusSession/)
  assert.equal((await invoke(withoutSession, ['workspace', 'show', workspace.id])).value.relations[0].id, relation.id)
  await assert.rejects(invoke(withoutSession, ['session', 'list']), /Session 能力不可用/)

  const noQuery = {
    ...f.services(),
    session: createSessionService({
      source: { home: 'C:/tmp/locus-cli-dsh', label: 'locus' },
      query: () => undefined,
    }),
  }
  const unavailable = await invoke(noQuery, ['session', 'show', 'session-live'])
  assert.equal(unavailable.exitCode, 2)
  assert.equal(unavailable.value.state, 'unavailable')
  assert.match(unavailable.value.error, /ctx\.sessionQuery/)
  await assert.rejects(invoke(noQuery, ['session', 'list']), /ctx\.sessionQuery/)
  const retained = (await invoke(noQuery, ['session', 'links', workspace.id])).value
  assert.equal(retained.length, 1)
  assert.equal(retained[0].summary.state, 'unavailable')
})

test('Session 关联要求当前可访问，且 capability 状态区分声明与可用性', async (t) => {
  const f = fixture(t)
  const workspace = await createWorkspace(f, 'Capability')
  const declared = (await invoke(f.services(), ['capability', 'list', workspace.id])).value
    .find((item) => item.id === 'locus.session')
  assert.equal(declared.declared, true)
  assert.equal(declared.configured, false)
  assert.equal(declared.available, true)

  await assert.rejects(
    invoke(f.services(), ['session', 'associate', workspace.id, 'session-live']),
    /尚未启用能力 locus\.session/,
  )
  const configured = (await invoke(f.services(), ['capability', 'configure', workspace.id, 'session'])).value
  assert.deepEqual(configured.capabilities.map((item) => item.id), ['locus.session'])

  await assert.rejects(
    invoke(f.services(), ['session', 'associate', workspace.id, 'missing-session']),
    /无法关联 Session missing-session/,
  )
  assert.equal((await invoke(f.services(), ['workspace', 'show', workspace.id])).value.relations.length, 0)
})
