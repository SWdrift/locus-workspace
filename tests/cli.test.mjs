import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createLocusCore } from '../packages/core/lib/index.js'
import { createFilesystemService } from '../plugins/filesystem/lib/index.js'
import { createGitService } from '../plugins/git/lib/index.js'
import { createConnectivityService } from '../plugins/connectivity/lib/index.js'
import { createGiteaService } from '../plugins/gitea/lib/index.js'
import { createRemoteMachineService } from '../plugins/remote-machine/lib/index.js'
import { createSessionService } from '../plugins/session/lib/index.js'
import { createCommands } from '../plugins/cli/lib/commands.js'

/** 复用真实应用命令树，但不启动 launcher；DSH profile 装配由 smoke 覆盖。 */
async function invoke(services, argv) {
  const commands = createCommands(
    services.locus, services.filesystem, services.git, services.session, services.remoteMachine,
    services.connectivity, services.gitea,
  )
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
  let remoteMachine = createRemoteMachineService(core, {
    run: async (args) => {
      if (args[0] === '-V') return { stdout: '', stderr: 'OpenSSH_9.5', error: null }
      if (args.at(-1) === 'hostname') return { stdout: 'remote-cli\n', stderr: '', error: null }
      return { stdout: '', stderr: '', error: { code: 'UNKNOWN' } }
    },
  })
  const sshConfigOutput = [
    'hostname 198.51.100.10',
    'port 22',
    'user admin',
    'proxyjump none',
    'proxycommand none',
    'stricthostkeychecking yes',
    'identityfile C:\\Users\\test\\.ssh\\id_ed25519',
    '',
  ].join('\n')
  let connectivity = createConnectivityService(core, remoteMachine, {
    run: async (args) => {
      if (args[0] === '-V') return { stdout: '', stderr: 'OpenSSH_9.5', error: null }
      if (args.includes('-G')) return { stdout: sshConfigOutput, stderr: '', error: null }
      return { stdout: 'remote-cli\n', stderr: '', error: null }
    },
  })
  const giteaSha = 'a'.repeat(40)
  const giteaRepository = {
    id: 7,
    full_name: 'acme/repo',
    default_branch: 'main',
    private: true,
    archived: false,
    has_actions: true,
    html_url: 'http://gitea.example/acme/repo',
  }
  const giteaFetch = async (input) => {
    const url = new URL(String(input))
    const json = (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
    if (url.pathname.endsWith('/api/v1/version')) return json({ version: '1.25.5' })
    if (url.pathname.endsWith('/api/v1/user')) return json({ login: 'acme' })
    if (url.pathname === '/api/v1/repos/acme/repo') return json(giteaRepository)
    if (url.pathname === '/api/v1/repositories/7') return json(giteaRepository)
    if (url.pathname === '/api/v1/repos/acme/repo/actions/runs') {
      const sha = url.searchParams.get('head_sha') ?? giteaSha
      return json({
        total_count: 1,
        workflow_runs: [{
          id: 101,
          run_number: 12,
          display_title: 'CLI CI',
          event: 'push',
          status: 'completed',
          conclusion: 'success',
          head_sha: sha,
          head_branch: 'main',
        }],
      })
    }
    if (url.pathname === '/api/v1/repos/acme/repo/actions/runs/101') {
      return json({
        id: 101,
        run_number: 12,
        display_title: 'CLI CI',
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        head_sha: giteaSha,
        head_branch: 'main',
        path: 'ci.yaml@refs/heads/main',
        started_at: '2026-07-16T15:15:45+08:00',
        completed_at: '2026-07-16T15:16:19+08:00',
      })
    }
    return json({ message: 'not found' }, 404)
  }
  let gitea = createGiteaService(core, {
    fetch: giteaFetch,
    env: { GITEA_TOKEN: 'cli-token' },
  })
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
    await connectivity.dispose()
    await gitea.dispose()
    await remoteMachine.dispose()
    await filesystem.dispose()
    await core.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root, data, resources, parent, child, sibling,
    sessionRecords,
    services: () => ({ locus: core, filesystem, git, session, remoteMachine, connectivity, gitea }),
    async restart() {
      await git.dispose()
      await connectivity.dispose()
      await gitea.dispose()
      await remoteMachine.dispose()
      await filesystem.dispose()
      await core.dispose()
      core = createLocusCore({ dataDirectory: data })
      filesystem = createFilesystemService(core)
      git = createGitService(core, filesystem)
      remoteMachine = createRemoteMachineService(core, {
        run: async (args) => {
          if (args[0] === '-V') return { stdout: '', stderr: 'OpenSSH_9.5', error: null }
          if (args.at(-1) === 'hostname') return { stdout: 'remote-cli\n', stderr: '', error: null }
          return { stdout: '', stderr: '', error: { code: 'UNKNOWN' } }
        },
      })
      connectivity = createConnectivityService(core, remoteMachine, {
        run: async (args) => {
          if (args[0] === '-V') return { stdout: '', stderr: 'OpenSSH_9.5', error: null }
          if (args.includes('-G')) return { stdout: sshConfigOutput, stderr: '', error: null }
          return { stdout: 'remote-cli\n', stderr: '', error: null }
        },
      })
      gitea = createGiteaService(core, {
        fetch: giteaFetch,
        env: { GITEA_TOKEN: 'cli-token' },
      })
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

test('Gitea 仓库显式关联、Remote 候选、CI 查询与插件停用', async (t) => {
  const f = fixture(t)
  const workspace = await createWorkspace(f, 'Gitea')
  const other = await createWorkspace(f, 'GiteaShared')
  await invoke(f.services(), ['capability', 'configure', workspace.id, 'filesystem'])
  await invoke(f.services(), ['capability', 'configure', workspace.id, 'gitea'])
  await invoke(f.services(), ['capability', 'configure', workspace.id, 'git'])
  await invoke(f.services(), ['capability', 'configure', other.id, 'gitea'])

  const instance = (await invoke(f.services(), [
    'gitea', 'instance', 'add', 'Local', '--base-url', 'http://gitea.example',
    '--credential-ref', 'GITEA_TOKEN',
  ])).value
  assert.equal(instance.baseUrl, 'http://gitea.example')
  assert.equal(instance.credentialRef, 'GITEA_TOKEN')
  const verified = (await invoke(f.services(), ['gitea', 'instance', 'verify', instance.id])).value
  assert.equal(verified.state, 'ok')
  assert.equal(verified.login, 'acme')

  const inspected = (await invoke(f.services(), ['gitea', 'repo', 'inspect', instance.id, 'acme/repo'])).value
  assert.equal(inspected.state, 'available')
  assert.equal(inspected.repository.fullName, 'acme/repo')

  const repo = join(f.resources, 'gitea-repo')
  mkdirSync(repo)
  const native = (args) => {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 10000 })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  native(['init', '--initial-branch=main'])
  writeFileSync(join(repo, 'file.txt'), 'gitea\n')
  native(['add', 'file.txt'])
  native(['-c', 'user.name=CLI Test', '-c', 'user.email=cli@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'initial'])
  native(['remote', 'add', 'origin', 'http://gitea.example/acme/repo.git'])
  const location = (await invoke(f.services(), ['fs', 'register', workspace.id, repo])).value
  const suggestions = (await invoke(f.services(), ['gitea', 'repo', 'suggest', workspace.id, location.id])).value
  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].fullName, 'acme/repo')
  assert.equal((await invoke(f.services(), ['gitea', 'repos', workspace.id])).value.length, 0)

  const relation = (await invoke(f.services(), [
    'gitea', 'repo', 'link', workspace.id, instance.id, 'acme/repo',
  ])).value
  assert.equal(relation.target.namespace, 'locus.gitea.repository')
  assert.equal(relation.target.id, `${instance.id}:7`)
  const sharedRelation = (await invoke(f.services(), [
    'gitea', 'repo', 'link', other.id, instance.id, 'acme/repo',
  ])).value
  assert.deepEqual(sharedRelation.target, relation.target)
  assert.notEqual(sharedRelation.id, relation.id)

  const repos = (await invoke(f.services(), ['gitea', 'repos', workspace.id])).value
  assert.equal(repos.length, 1)
  assert.equal(repos[0].observation.repository.fullName, 'acme/repo')
  const status = (await invoke(f.services(), ['gitea', 'status', workspace.id])).value
  assert.equal(status[0].latestRun.outcome, 'success')
  const runs = (await invoke(f.services(), ['gitea', 'runs', workspace.id])).value
  assert.equal(runs[0].observation.runs[0].runNumber, 12)
  const run = (await invoke(f.services(), ['gitea', 'run', 'show', workspace.id, relation.id, '101'])).value
  assert.equal(run.run.outcome, 'success')
  assert.equal(run.run.workflowPath, 'ci.yaml@refs/heads/main')
  assert.equal(run.run.startedAt, '2026-07-16T15:15:45+08:00')

  const ci = (await invoke(f.services(), ['gitea', 'ci', workspace.id, location.id])).value
  assert.equal(ci[0].state, 'available')
  assert.equal(ci[0].runs[0].headSha, native(['rev-parse', 'HEAD']).toLowerCase())

  await invoke(f.services(), ['gitea', 'repo', 'unlink', workspace.id, relation.id, '--yes'])
  assert.equal((await invoke(f.services(), ['gitea', 'repos', other.id])).value.length, 1)

  const withoutGitea = {
    ...f.services(),
    gitea: undefined,
  }
  const retained = (await invoke(withoutGitea, ['gitea', 'repos', other.id])).value
  assert.equal(retained[0].state, 'unavailable')
  assert.equal((await invoke(withoutGitea, ['workspace', 'show', other.id])).value.relations.length, 1)
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

test('Remote Machine 登记、共享关联、地址修改与只读观察不依赖 SSH 连接', async (t) => {
  const f = fixture(t)
  const a = await createWorkspace(f, 'MachineA')
  const b = await createWorkspace(f, 'MachineB')
  assert.equal(a.relations.length, 0)

  const machine = (await invoke(f.services(), ['machine', 'register', 'Build Host', '--description', '离线登记'])).value
  assert.equal(machine.description, '离线登记')
  const withAddress = (await invoke(f.services(), [
    'machine', 'address', 'add', machine.id, '--kind', 'ssh', '--value', 'build.example', '--port', '2222', '--label', 'primary',
  ])).value
  const address = withAddress.addresses[0]
  assert.equal(address.kind, 'ssh')
  assert.equal(address.port, 2222)

  const other = (await invoke(f.services(), ['machine', 'register', 'Same Address'])).value
  const otherWithAddress = (await invoke(f.services(), [
    'machine', 'address', 'add', other.id, '--kind', 'ssh', '--value', 'build.example', '--port', '2222',
  ])).value
  assert.notEqual(otherWithAddress.id, machine.id)
  assert.equal(otherWithAddress.addresses[0].value, 'build.example')

  await assert.rejects(
    invoke(f.services(), ['machine', 'associate', a.id, machine.id]),
    /尚未启用能力 locus\.remote-machine/,
  )
  await invoke(f.services(), ['capability', 'configure', a.id, 'remote-machine'])
  await invoke(f.services(), ['capability', 'configure', b.id, 'remote-machine'])
  const relationA = (await invoke(f.services(), ['machine', 'associate', a.id, machine.id])).value
  const relationB = (await invoke(f.services(), ['machine', 'associate', b.id, machine.id])).value
  assert.equal(relationA.target.namespace, 'locus.remote-machine')
  assert.equal(relationA.target.id, machine.id)

  const listA = (await invoke(f.services(), ['machine', 'list', a.id])).value
  assert.equal(listA.length, 1)
  assert.equal(listA[0].machine.id, machine.id)
  assert.deepEqual(
    (await invoke(f.services(), ['machine', 'workspaces', machine.id])).value
      .map((item) => item.workspaceId).sort(),
    [a.id, b.id].sort(),
  )

  const renamed = (await invoke(f.services(), ['machine', 'update', machine.id, '--name', 'Renamed Host'])).value
  assert.equal(renamed.id, machine.id)
  assert.equal(renamed.addresses[0].id, address.id)
  const changedAddress = (await invoke(f.services(), [
    'machine', 'address', 'update', machine.id, address.id, '--value', 'build.example.internal',
  ])).value
  assert.equal(changedAddress.id, machine.id)
  assert.equal(changedAddress.addresses[0].id, address.id)
  assert.equal(changedAddress.addresses[0].value, 'build.example.internal')

  const observed = (await invoke(f.services(), ['machine', 'observe', machine.id])).value
  assert.equal(observed.state, 'observed')
  assert.equal(observed.scope, 'single-address')
  assert.equal(observed.source.endpoint, 'build.example.internal')
  assert.equal(observed.source.port, 2222)
  assert.equal(observed.host.hostname, 'remote-cli')
  assert.match(observed.observedAt, /^\d{4}-/)

  const noConfirm = await invoke(f.services(), ['machine', 'dissociate', a.id, relationA.id])
  assert.equal(noConfirm.exitCode, 1)
  await invoke(f.services(), ['machine', 'dissociate', a.id, relationA.id, '--yes'])
  assert.equal((await invoke(f.services(), ['workspace', 'show', a.id])).value.relations.length, 0)
  assert.equal((await invoke(f.services(), ['workspace', 'show', b.id])).value.relations.length, 1)
  assert.equal((await invoke(f.services(), ['machine', 'list'])).value.length, 2)

  await f.restart()
  const restored = (await invoke(f.services(), ['machine', 'show', machine.id])).value.machine
  assert.equal(restored.id, machine.id)
  assert.equal(restored.name, 'Renamed Host')
  assert.equal((await invoke(f.services(), ['machine', 'list', a.id])).value.length, 0)
  assert.equal((await invoke(f.services(), ['machine', 'list', b.id])).value.length, 1)

  const withoutMachine = { ...f.services(), remoteMachine: undefined }
  await assert.rejects(invoke(withoutMachine, ['machine', 'list']), /Remote Machine 能力不可用/)
  assert.equal((await invoke(withoutMachine, ['workspace', 'show', b.id])).value.relations.length, 1)
  await invoke(withoutMachine, ['machine', 'dissociate', b.id, relationB.id, '--yes'])
  assert.equal((await invoke(withoutMachine, ['workspace', 'show', b.id])).value.relations.length, 0)
  await assert.rejects(invoke(withoutMachine, ['machine', 'list', b.id]), /Remote Machine 能力不可用/)
})

test('Connectivity Profile 保存、检查、验证与原生入口不改变 Machine Identity', async (t) => {
  const f = fixture(t)
  const workspace = await createWorkspace(f, 'Connectivity')
  const machine = (await invoke(f.services(), ['machine', 'register', 'Connect Target'])).value
  await invoke(f.services(), ['capability', 'configure', workspace.id, 'remote-machine'])
  await invoke(f.services(), ['machine', 'associate', workspace.id, machine.id])

  const profile = (await invoke(f.services(), [
    'connect', 'profile', 'add', machine.id, 'alias', '--target', 'build-alias',
  ])).value
  assert.equal(profile.machineId, machine.id)
  assert.equal(profile.transport, 'direct')
  assert.equal(profile.target, 'build-alias')
  assert.equal((await invoke(f.services(), ['connect', 'profile', 'list', machine.id])).value.length, 1)
  assert.equal((await invoke(f.services(), ['connect', 'list', workspace.id])).value.length, 1)

  const inspected = (await invoke(f.services(), ['connect', 'inspect', profile.id])).value
  assert.equal(['ready', 'warning'].includes(inspected.state), true)
  assert.equal(inspected.resolved.hostname, '198.51.100.10')
  assert.equal(JSON.stringify(inspected).includes('C:\\Users\\test'), false)
  assert.equal((await invoke(f.services(), ['connect', 'inspect', profile.id])).exitCode, 0)

  const verified = (await invoke(f.services(), ['connect', 'verify', profile.id])).value
  assert.equal(verified.state, 'connected')
  assert.equal(verified.host.hostname, 'remote-cli')
  const opened = (await invoke(f.services(), ['connect', 'open', profile.id])).value
  assert.equal(opened.mode, 'native')
  assert.equal(opened.command[0], 'ssh')
  assert.equal(opened.command.at(-1), 'build-alias')

  const updated = (await invoke(f.services(), [
    'connect', 'profile', 'update', profile.id, '--target', 'build.internal',
  ])).value
  assert.equal(updated.id, profile.id)
  assert.equal(updated.machineId, machine.id)
  assert.equal(updated.target, 'build.internal')
  const shown = (await invoke(f.services(), ['connect', 'profile', 'show', profile.id])).value
  assert.equal(shown.machine.id, machine.id)
  const withSecretPath = (await invoke(f.services(), [
    'connect', 'profile', 'update', profile.id, '--identity-file', 'C:\\secret\\id_ed25519',
  ])).value
  assert.equal(withSecretPath.identityFile, '<configured>')
  assert.equal(JSON.stringify(withSecretPath).includes('C:\\secret'), false)

  const removed = (await invoke(f.services(), ['connect', 'profile', 'remove', profile.id, '--yes'])).value
  assert.equal(removed.removedProfileId, profile.id)
  assert.equal((await invoke(f.services(), ['connect', 'list'])).value.length, 0)
  assert.equal((await invoke(f.services(), ['machine', 'show', machine.id])).value.machine.id, machine.id)
})

test('Workspace Overview 默认只读关系，显式观察分离事实与未确认建议', async (t) => {
  const f = fixture(t)
  const workspace = await createWorkspace(f, 'Overview')
  for (const capability of ['filesystem', 'git', 'gitea', 'session', 'remote-machine', 'connectivity']) {
    await invoke(f.services(), ['capability', 'configure', workspace.id, capability])
  }
  const instance = (await invoke(f.services(), [
    'gitea', 'instance', 'add', 'Overview Gitea', '--base-url', 'http://gitea.example',
    '--credential-ref', 'GITEA_TOKEN',
  ])).value
  f.sessionRecords.push(sessionRecord('overview-session'))
  const sessionRelation = (await invoke(f.services(), [
    'session', 'associate', workspace.id, 'overview-session',
  ])).value

  const repo = join(f.resources, 'overview-repo')
  mkdirSync(repo)
  const native = (args) => {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 10000 })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  native(['init', '--initial-branch=main'])
  writeFileSync(join(repo, 'file.txt'), 'overview\n')
  native(['add', 'file.txt'])
  native(['-c', 'user.name=CLI Test', '-c', 'user.email=cli@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'initial'])
  native(['remote', 'add', 'origin', 'http://gitea.example/acme/repo.git'])
  native(['remote', 'add', 'other', 'http://gitea.example/acme/other.git'])
  const location = (await invoke(f.services(), ['fs', 'register', workspace.id, repo])).value
  await invoke(f.services(), ['git', 'confirm', workspace.id, location.id])
  const giteaRelation = (await invoke(f.services(), [
    'gitea', 'repo', 'link', workspace.id, instance.id, 'acme/repo',
  ])).value

  const machine = (await invoke(f.services(), ['machine', 'register', 'Overview Host'])).value
  const machineWithAddress = (await invoke(f.services(), [
    'machine', 'address', 'add', machine.id, '--kind', 'ssh', '--value', 'overview.example', '--port', '22',
  ])).value
  await invoke(f.services(), ['machine', 'associate', workspace.id, machine.id])
  const profile = (await invoke(f.services(), [
    'connect', 'profile', 'add', machine.id, 'overview-profile', '--target', 'overview.example',
  ])).value

  const minimal = await createWorkspace(f, 'OverviewMinimal')
  const minimalOverview = (await invoke(f.services(), ['workspace', 'overview', minimal.id])).value
  assert.equal(minimalOverview.mode, 'relations')
  assert.equal(minimalOverview.workspace.id, minimal.id)
  assert.equal(minimalOverview.workspace.capabilities.length, 0)
  assert.deepEqual(minimalOverview.filesystem.locations, [])
  assert.deepEqual(minimalOverview.gitea.repositories, [])
  assert.deepEqual(minimalOverview.sessions.links, [])
  assert.deepEqual(minimalOverview.machines.items, [])
  assert.equal(minimalOverview.attention.length, 0)
  assert.match(minimalOverview.next.join('\n'), /workspace show/)

  const relations = (await invoke(f.services(), ['workspace', 'overview', workspace.id])).value
  assert.equal(relations.mode, 'relations')
  assert.equal(relations.filesystem.locations[0].state, 'not-observed')
  assert.equal(relations.git.repositories[0].state, 'not-observed')
  assert.equal(relations.gitea.repositories[0].state, 'not-observed')
  assert.equal(relations.sessions.links[0].state, 'not-observed')
  assert.equal(relations.machines.items[0].machine.id, machine.id)
  assert.equal(relations.connectivity.profiles[0].state, 'not-observed')
  assert.equal(JSON.stringify(relations).includes('cli-token'), false)

  writeFileSync(join(repo, 'file.txt'), 'dirty\n')
  const observed = (await invoke(f.services(), [
    'workspace', 'overview', workspace.id, '--observe',
  ])).value
  assert.equal(observed.mode, 'observed')
  assert.equal(observed.filesystem.locations[0].observation.state, 'accessible')
  assert.equal(observed.git.repositories[0].observation.state, 'repository')
  assert.equal(observed.git.repositories[0].observation.dirty, true)
  assert.equal(observed.gitea.repositories[0].repository.fullName, 'acme/repo')
  assert.equal(observed.gitea.repositories[0].latestRun.outcome, 'success')
  assert.equal(observed.gitea.repositories[0].head.state, 'matched')
  assert.equal(observed.gitea.repositories[0].head.commit, native(['rev-parse', 'HEAD']).toLowerCase())
  assert.equal(observed.gitea.repositories[0].head.runsState, 'available')
  assert.equal(observed.sessions.links[0].summary.state, 'live')
  assert.equal(observed.machines.items[0].profileCount, 1)
  assert.ok(['ready', 'warning'].includes(observed.connectivity.profiles[0].state))
  assert.equal(observed.gitea.suggestions.length, 1)
  assert.equal(observed.gitea.suggestions[0].fullName, 'acme/other')
  assert.ok(observed.attention.some((item) => item.code === 'git-worktree-dirty'))
  assert.ok(observed.attention.some((item) => item.code === 'gitea-unconfirmed-suggestion'))
  assert.ok(observed.next.some((command) => command.includes('gitea run show')))
  assert.equal(JSON.stringify(observed).includes('cli-token'), false)
  assert.equal(JSON.stringify(observed).includes('C:\\\\Users\\\\test'), false)

  const failingGitea = createGiteaService(f.services().locus, {
    env: { GITEA_TOKEN: 'cli-token' },
    fetch: async () => new Response(JSON.stringify({ message: 'denied' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }),
  })
  try {
    const partial = (await invoke({
      ...f.services(),
      gitea: failingGitea,
    }, ['workspace', 'overview', workspace.id, '--observe'])).value
    assert.equal(partial.gitea.repositories[0].state, 'unauthorized')
    assert.equal(partial.filesystem.locations[0].observation.state, 'accessible')
    assert.equal(partial.git.repositories[0].observation.state, 'repository')
    assert.equal(partial.sessions.links[0].summary.state, 'live')
    assert.ok(partial.attention.some((item) => item.code === 'gitea-unauthorized'))
  } finally {
    await failingGitea.dispose()
  }

  const failureGitea = createGiteaService(f.services().locus, {
    env: { GITEA_TOKEN: 'cli-token' },
    fetch: async (input) => {
      const url = new URL(String(input))
      const repository = {
        id: 7,
        full_name: 'acme/repo',
        default_branch: 'main',
        private: true,
        archived: false,
        has_actions: true,
      }
      const run = {
        id: 202,
        run_number: 13,
        display_title: 'Failed CI',
        event: 'push',
        status: 'completed',
        conclusion: 'failure',
        head_sha: native(['rev-parse', 'HEAD']).toLowerCase(),
        head_branch: 'main',
      }
      if (url.pathname === '/api/v1/repositories/7') {
        return new Response(JSON.stringify(repository), {
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.pathname.endsWith('/actions/runs')) {
        return new Response(JSON.stringify({ total_count: 1, workflow_runs: [run] }), {
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ message: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  try {
    const failed = (await invoke({
      ...f.services(),
      gitea: failureGitea,
    }, ['workspace', 'overview', workspace.id, '--observe'])).value
    assert.equal(failed.gitea.repositories[0].latestRun.outcome, 'failure')
    assert.equal(failed.gitea.repositories[0].head.runs[0].outcome, 'failure')
    assert.ok(failed.attention.some((item) => item.code === 'gitea-ci-problem'))
    assert.ok(failed.attention.some((item) => item.code === 'gitea-head-ci-problem'))
  } finally {
    await failureGitea.dispose()
  }

  const retained = (await invoke({
    locus: f.services().locus,
    filesystem: undefined,
    git: undefined,
    gitea: undefined,
    session: undefined,
    remoteMachine: undefined,
    connectivity: undefined,
  }, ['workspace', 'overview', workspace.id])).value
  assert.equal(retained.workspace.id, workspace.id)
  assert.equal(retained.filesystem.state, 'unavailable')
  assert.equal(retained.git.state, 'unavailable')
  assert.equal(retained.gitea.state, 'unavailable')
  assert.equal(retained.sessions.state, 'unavailable')
  assert.equal(retained.machines.state, 'unavailable')
  assert.equal(retained.connectivity.state, 'unavailable')
  assert.equal(retained.gitea.repositories[0].relationId, giteaRelation.id)
  assert.equal(retained.sessions.links[0].relationId, sessionRelation.id)
  assert.equal(retained.machines.items[0].machineId, machine.id)
  assert.ok(retained.attention.some((item) => item.code === 'capability-provider-missing'))
})
