import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// 每个真实命令仍是一次独立 DSH 启动：这里只验证 launcher/profile、退出码、
// 跨进程恢复与插件停用。完整命令矩阵和领域边界由 `pnpm test` 使用真实资源覆盖，
// 不再为每个微场景重复启动完整 profile。
const pnpm = process.env.npm_execpath
if (!pnpm) throw new Error('请通过 pnpm smoke:workspace 运行，以使用项目内 DSH。')
const root = mkdtempSync(join(tmpdir(), 'locus-workspace-smoke-'))
const data = join(root, 'data')
const resources = join(root, 'resources')
const shared = join(resources, 'shared')
const missingFilesystem = join(root, 'without-filesystem.yml')
const missingGit = join(root, 'without-git.yml')
mkdirSync(join(shared, 'child'), { recursive: true })
writeFileSync(join(shared, 'note.txt'), 'Workspace Foundation: real file\n')
writeFileSync(missingFilesystem, "- id: locus-filesystem\n  name: '@locus/filesystem'\n  disabled: true\n")
writeFileSync(missingGit, "- id: locus-git\n  name: '@locus/git'\n  disabled: true\n")
let invocations = 0

function run(args, { directory = data, patch, json = true, code = 0 } = {}) {
  const command = ['exec', 'dsh', '--profile', 'locus']
  if (patch) command.push('--patch', patch)
  command.push(...args)
  if (json) command.push('--json')
  const result = spawnSync(process.execPath, [pnpm, ...command], {
    cwd: resolve('.'),
    env: { ...process.env, DSH_HOME: resolve('.dsh'), LOCUS_HOME: directory },
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  })
  invocations++
  assert.equal(result.error, undefined, `启动失败 ${JSON.stringify(command)}: ${result.error}`)
  assert.equal(result.status, code, `${JSON.stringify(command)}\nstdout=${result.stdout}\nstderr=${result.stderr}`)
  if (code !== 0) return result
  if (!json) return result.stdout
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(`stdout 不是独立 JSON：${JSON.stringify(command)}\n${result.stdout}\n${result.stderr}`, { cause: error })
  }
}

try {
  assert.equal(run(['version'], { json: false }), '0.0.0\n')
  assert.match(run(['bogus'], { json: false, code: 1 }).stderr, /未知命令：bogus/)

  const workspace = run(['workspace', 'create', 'Smoke'])
  const before = run(['capability', 'list', workspace.id]).find((item) => item.id === 'locus.filesystem')
  assert.equal(before.declared, true)
  assert.equal(before.configured, false)
  run(['capability', 'configure', workspace.id, 'filesystem'])
  const location = run(['fs', 'register', workspace.id, shared])
  const discovered = run(['fs', 'discover', workspace.id, location.id])
  assert.equal(discovered.root.state, 'accessible')
  assert.ok(discovered.entries.some((entry) => entry.path === join(shared, 'note.txt')))
  const member = run(['fs', 'confirm', workspace.id, location.id, 'note.txt'])

  const listed = run(['workspace', 'list'])
  assert.deepEqual(listed.map((item) => item.id), [workspace.id])
  const reopened = run(['workspace', 'show', workspace.id])
  assert.equal(reopened.id, workspace.id)
  assert.equal(reopened.relations[0].id, member.id)

  const offline = run(['workspace', 'show', workspace.id], { patch: missingFilesystem })
  assert.equal(offline.relations[0].id, member.id)
  const offlineCapability = run(['capability', 'list', workspace.id], { patch: missingFilesystem })
    .find((item) => item.id === 'locus.filesystem')
  assert.equal(offlineCapability.declared, false)
  assert.equal(offlineCapability.configured, true)
  assert.equal(offlineCapability.loaded, false)
  assert.equal(offlineCapability.available, false)
  assert.match(run(['fs', 'register', workspace.id, shared], { patch: missingFilesystem, json: false, code: 2 }).stderr, /Filesystem 能力不可用/)

  const restoredData = join(root, 'restored')
  cpSync(data, restoredData, { recursive: true })
  assert.deepEqual(run(['workspace', 'list'], { directory: restoredData }), listed)
  assert.deepEqual(run(['fs', 'locations', workspace.id], { directory: restoredData }), run(['fs', 'locations', workspace.id]))

  const native = (args) => {
    const result = spawnSync('git', ['-C', shared, ...args], { encoding: 'utf8', timeout: 10000 })
    assert.equal(result.status, 0, `${JSON.stringify(args)}\n${result.stdout}\n${result.stderr}`)
    return result.stdout.trim()
  }
  native(['init', '--initial-branch=main'])
  writeFileSync(join(shared, 'repository.txt'), 'real Git fixture\n')
  native(['add', 'repository.txt'])
  native(['-c', 'user.name=Locus Smoke', '-c', 'user.email=locus@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'initial'])
  native(['remote', 'add', 'origin', 'https://smoke-user:smoke-secret@example.invalid/team/repo.git?token=secret-query'])
  const head = native(['rev-parse', 'HEAD'])
  const index = readFileSync(join(shared, '.git', 'index'))
  run(['capability', 'configure', workspace.id, 'git'])
  const repository = run(['git', 'inspect', workspace.id, location.id])
  assert.equal(repository.state, 'repository')
  assert.equal(repository.commit, head)
  assert.equal(repository.filesystem.path, shared)
  assert.equal(JSON.stringify(repository).includes('smoke-secret'), false)
  assert.equal(JSON.stringify(repository).includes('secret-query'), false)
  assert.deepEqual(readFileSync(join(shared, '.git', 'index')), index)
  const gitRelation = run(['git', 'confirm', workspace.id, location.id])
  assert.deepEqual(gitRelation.target, repository.reference)

  const missingGitCapability = run(['capability', 'list', workspace.id], { patch: missingGit })
    .find((item) => item.id === 'locus.git')
  assert.equal(missingGitCapability.declared, false)
  assert.equal(missingGitCapability.configured, true)
  assert.ok(run(['workspace', 'show', workspace.id], { patch: missingGit }).relations.some((item) => item.id === gitRelation.id))

  console.log('PASS profile: 真实命令、跨进程恢复、备份、插件停用与只读 Git 组合均符合断言。')
  console.log(`Workspace profile smoke: PASS (${invocations} independent DSH processes)`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
