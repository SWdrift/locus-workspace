import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// 真实 launcher/profile 层：只验证无法由进程内测试覆盖的装配、退出码、
// 跨进程恢复、插件停用与 stdin shell。领域矩阵由 `pnpm test:all` 覆盖。
const pnpm = process.env.npm_execpath
if (!pnpm) throw new Error('请通过 pnpm verify:full 或 node tests/e2e/workspace-smoke.mjs 运行，以使用项目内 DSH。')
const root = mkdtempSync(join(tmpdir(), 'locus-workspace-smoke-'))
const dshHome = join(root, 'dsh')
const data = join(root, 'data')
const resources = join(root, 'resources')
const shared = join(resources, 'shared')
const withoutFilesystem = join(root, 'without-filesystem.yml')
mkdirSync(shared, { recursive: true })
writeFileSync(join(shared, 'note.txt'), 'Workspace Foundation: real file\n')
writeFileSync(withoutFilesystem, [
  '- id: locus-filesystem',
  "  name: '@locus/filesystem'",
  '  disabled: true',
  '',
].join('\n'))
let invocations = 0

function prepareProfile() {
  mkdirSync(dshHome, { recursive: true })
  const links = [
    join(resolve('.'), 'packages/host-dsh'),
    join(resolve('.'), 'plugins/filesystem'),
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
    "    - id: locus-cli",
    "      name: '@locus/cli'",
    '',
  ].join('\n'))
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
  assert.equal(run(['version'], { json: false }), '0.0.0\n')
  assert.match(run(['bogus'], { json: false, code: 1 }).stderr, /未知命令：bogus/)

  const workspace = run(['workspace', 'create', 'Smoke'])
  const secondWorkspace = run(['workspace', 'create', 'SmokeB'])
  assert.equal(run(['workspace', 'list']).length, 2)
  const location = run(['fs', 'register', workspace.id, shared])
  assert.equal(location.path, shared)

  const shell = runShell([
    `--json fs discover ${workspace.id} ${location.id}`,
    `--json fs read ${workspace.id} ${location.id} note.txt`,
    `--json fs confirm ${workspace.id} ${location.id} note.txt`,
    `--json workspace show ${workspace.id}`,
    `--json workspace link ${workspace.id} locus.workspace ${secondWorkspace.id}`,
  ])
  const outputs = shell.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line))
  assert.equal(outputs[0].root.state, 'accessible')
  assert.equal(outputs[1].text, 'Workspace Foundation: real file\n')
  assert.equal(outputs[2].kind, 'member')
  assert.equal(outputs[3].relations.length, 1)
  assert.equal(outputs[4].target.id, secondWorkspace.id)
  assert.equal(shell.stderr, '')

  const reopened = run(['workspace', 'show', workspace.id])
  assert.equal(reopened.id, workspace.id)
  assert.equal(reopened.relations.length, 2)
  assert.equal(run(['fs', 'locations', workspace.id]).length, 1)
  assert.equal(run(['fs', 'read', workspace.id, location.id, 'note.txt'], { json: false }), `${join(shared, 'note.txt')}\nWorkspace Foundation: real file\n\n`)

  const offline = runShell([
    `--json workspace show ${workspace.id}`,
    `fs register ${workspace.id} ${shared}`,
  ], { patch: withoutFilesystem, code: 2 })
  const offlineOutputs = offline.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line))
  assert.equal(offlineOutputs[0].relations.length, 2)
  assert.match(offline.stderr, /Filesystem 能力不可用/)

  const missing = run(['fs', 'register', workspace.id, join(resources, 'missing')])
  assert.equal(missing.path, join(resources, 'missing'))

  console.log(`Workspace profile smoke: PASS (${invocations} independent DSH processes)`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
