import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// 真实 launcher/profile 层：只验证无法由进程内测试覆盖的装配、退出码、
// 跨进程恢复、插件停用与 stdin shell。领域矩阵与备份恢复由 `pnpm test:all` 覆盖。
const pnpm = process.env.npm_execpath
if (!pnpm) throw new Error('请通过 pnpm verify:full 或 node tests/e2e/workspace-smoke.mjs 运行，以使用项目内 DSH。')
const root = mkdtempSync(join(tmpdir(), 'locus-workspace-smoke-'))
const dshHome = join(root, 'dsh')
const data = join(root, 'data')
const resources = join(root, 'resources')
const shared = join(resources, 'shared')
const missingFilesystem = join(root, 'without-filesystem.yml')
mkdirSync(shared, { recursive: true })
writeFileSync(join(shared, 'note.txt'), 'Workspace Foundation: real file\n')
writeFileSync(missingFilesystem, [
  "- id: locus-filesystem",
  "  name: '@locus/filesystem'",
  '  disabled: true',
  '- id: locus-session',
  "  name: '@locus/session'",
  '  disabled: true',
  '',
].join('\n'))
let invocations = 0

function prepareProfile() {
  mkdirSync(dshHome, { recursive: true })
  const links = [
    join(resolve('.'), 'packages/host-dsh'),
    join(resolve('.'), 'plugins/filesystem'),
    join(resolve('.'), 'plugins/git'),
    join(resolve('.'), 'plugins/session'),
    join(resolve('.'), 'plugins/cli'),
  ]
  const result = spawnSync(process.execPath, [
    pnpm,
    'exec',
    'dsh',
    'plugin',
    '--profile',
    'locus',
    'add',
    ...links.map((link) => `link:${link}`),
  ], {
    cwd: resolve('.'),
    env: { ...process.env, DSH_HOME: dshHome },
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
  })
  assert.equal(result.status, 0, `profile 初始化失败：${result.stdout}\n${result.stderr}`)
  writeFileSync(join(dshHome, 'profiles/locus/cordis.patch.yml'), [
    '- insert:',
    "    - id: locus-host",
    "      name: '@locus/host-dsh'",
    "    - id: locus-filesystem",
    "      name: '@locus/filesystem'",
    "    - id: locus-git",
    "      name: '@locus/git'",
    "    - id: locus-session",
    "      name: '@locus/session'",
    "    - id: locus-cli",
    "      name: '@locus/cli'",
    '',
  ].join('\n'))
}

function createFixtureSessions() {
  copyFileSync(resolve('tests/e2e/fixtures/session-fixture.mjs'), join(root, 'session-fixture.mjs'))
  const patch = join(root, 'session-fixture.patch.yml')
  writeFileSync(patch, [
    '- id: locus-cli',
    '  disabled: true',
    '- id: hmr',
    '  disabled: true',
    '- id: session-title-llm',
    '  disabled: true',
    '- insert:',
    '    - id: locus-session-fixture',
    "      name: './session-fixture.mjs'",
    '',
  ].join('\n'))
  const result = spawnSync(process.execPath, [
    pnpm,
    'exec',
    'dsh',
    '--profile',
    'locus',
    '--patch',
    patch,
  ], {
    cwd: resolve('.'),
    env: {
      ...process.env,
      DSH_HOME: dshHome,
      LOCUS_FIXTURE_CWD: resolve('.'),
      LOCUS_FIXTURE_RESULT: join(root, 'session-fixture-result.json'),
    },
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
  })
  invocations++
  assert.equal(result.status, 0, `Session fixture 失败：${result.stdout}\n${result.stderr}`)
  const fixture = JSON.parse(readFileSync(join(root, 'session-fixture-result.json'), 'utf8'))
  assert.deepEqual(fixture.ids, ['e2e-session-a', 'e2e-session-b', 'e2e-session-no-cwd'])
  assert.equal(fixture.live, 'live')
}

function run(args, { directory = data, patch, json = true, code = 0 } = {}) {
  const command = ['exec', 'dsh', '--profile', 'locus']
  if (patch) command.push('--patch', patch)
  command.push(...args)
  if (json) command.push('--json')
  const result = spawnSync(process.execPath, [pnpm, ...command], {
    cwd: resolve('.'),
    env: { ...process.env, DSH_HOME: dshHome, LOCUS_HOME: directory },
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

function runShell(lines, { directory = data, patch, code = 0 } = {}) {
  const command = ['exec', 'dsh', '--profile', 'locus']
  if (patch) command.push('--patch', patch)
  command.push('shell')
  const result = spawnSync(process.execPath, [pnpm, ...command], {
    cwd: resolve('.'),
    env: { ...process.env, DSH_HOME: dshHome, LOCUS_HOME: directory },
    input: `${lines.join('\n')}\nexit\n`,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  })
  invocations++
  assert.equal(result.error, undefined, `shell 启动失败: ${result.error}`)
  assert.equal(result.status, code, `shell\nstdout=${result.stdout}\nstderr=${result.stderr}`)
  return result
}

try {
  prepareProfile()
  createFixtureSessions()
  assert.equal(run(['version'], { json: false }), '0.0.0\n')
  assert.match(run(['bogus'], { json: false, code: 1 }).stderr, /未知命令：bogus/)

  const workspace = run(['workspace', 'create', 'Smoke'])
  const secondWorkspace = run(['workspace', 'create', 'SmokeB'])
  run(['capability', 'configure', workspace.id, 'filesystem'])
  const location = run(['fs', 'register', workspace.id, shared])

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

  const shell = runShell([
    `--json capability configure ${workspace.id} git`,
    `--json fs discover ${workspace.id} ${location.id}`,
    `--json fs confirm ${workspace.id} ${location.id} note.txt`,
    `--json workspace show ${workspace.id}`,
    `--json git inspect ${workspace.id} ${location.id}`,
    `--json git confirm ${workspace.id} ${location.id}`,
    `--json capability configure ${workspace.id} session`,
    `--json capability configure ${secondWorkspace.id} session`,
    '--json session list',
    `--json session associate ${workspace.id} e2e-session-a`,
    `--json session associate ${secondWorkspace.id} e2e-session-a`,
    `--json session links ${workspace.id}`,
    '--json session open e2e-session-a',
  ])
  const outputs = shell.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line))
  assert.match(shell.stdout, /"state":"accessible"/)
  assert.match(shell.stdout, /"state":"repository"/)
  assert.match(shell.stdout, new RegExp(head))
  assert.equal(shell.stdout.includes('smoke-secret'), false)
  assert.equal(shell.stdout.includes('Fixture session A'), false)
  assert.equal(outputs[8].length, 3)
  assert.equal(outputs[9].target.id, 'e2e-session-a')
  assert.equal(outputs[10].target.id, 'e2e-session-a')
  assert.equal(outputs[11].length, 1)
  assert.equal(outputs[11][0].summary.state, 'persisted')
  assert.equal(outputs[12].mode, 'native')
  assert.deepEqual(outputs[12].command, ['dsh', '--profile', 'headless', '--session-id', 'e2e-session-a'])
  assert.equal(shell.stderr, '')
  assert.deepEqual(readFileSync(join(shared, '.git', 'index')), index)

  const reopened = run(['workspace', 'show', workspace.id])
  assert.equal(reopened.id, workspace.id)
  assert.equal(reopened.relations.length, 3)
  assert.equal(reopened.relations.some((relation) =>
    relation.target.namespace.startsWith('dsh.session.') && relation.target.id === 'e2e-session-a'), true)
  assert.equal(run(['session', 'list']).length, 3)
  const noCwd = run(['session', 'open', 'e2e-session-no-cwd'], { code: 2 })
  assert.equal(JSON.parse(noCwd.stdout).mode, 'unavailable')

  const dissociated = run(['session', 'dissociate', secondWorkspace.id, outputs[10].id, '--yes'])
  assert.equal(dissociated.removedRelationId, outputs[10].id)
  assert.equal(run(['workspace', 'show', secondWorkspace.id]).relations.length, 0)
  assert.equal(run(['session', 'list']).length, 3)

  const offline = runShell([
    `--json workspace show ${workspace.id}`,
    `--json capability list ${workspace.id}`,
    `--json session links ${workspace.id}`,
    `fs register ${workspace.id} ${shared}`,
  ], { patch: missingFilesystem, code: 2 })
  assert.match(offline.stdout, new RegExp(workspace.id))
  assert.match(offline.stdout, /"declared":false/)
  assert.match(offline.stdout, /"configured":true/)
  assert.match(offline.stdout, /"state":"unavailable"/)
  assert.match(offline.stdout, /"removedRelationId"|dsh\.session\./)
  assert.match(offline.stderr, /Filesystem 能力不可用/)

  console.log('PASS profile: launcher、退出码、跨进程恢复、插件停用与 shell 组合符合断言。')
  console.log(`Workspace profile smoke: PASS (${invocations} independent DSH processes)`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
