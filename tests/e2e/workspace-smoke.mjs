import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// 真实 launcher/profile 层：只验证无法由进程内测试覆盖的装配、退出码、
// 跨进程恢复、插件停用与 stdin shell。领域矩阵与备份恢复由 `pnpm test:all` 覆盖。
const pnpm = process.env.npm_execpath
if (!pnpm) throw new Error('请通过 pnpm verify:full 或 node tests/e2e/workspace-smoke.mjs 运行，以使用项目内 DSH。')
const root = mkdtempSync(join(tmpdir(), 'locus-workspace-smoke-'))
const data = join(root, 'data')
const resources = join(root, 'resources')
const shared = join(resources, 'shared')
const missingFilesystem = join(root, 'without-filesystem.yml')
mkdirSync(shared, { recursive: true })
writeFileSync(join(shared, 'note.txt'), 'Workspace Foundation: real file\n')
writeFileSync(missingFilesystem, "- id: locus-filesystem\n  name: '@locus/filesystem'\n  disabled: true\n")
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

function runShell(lines, { directory = data, patch, code = 0 } = {}) {
  const command = ['exec', 'dsh', '--profile', 'locus']
  if (patch) command.push('--patch', patch)
  command.push('shell')
  const result = spawnSync(process.execPath, [pnpm, ...command], {
    cwd: resolve('.'),
    env: { ...process.env, DSH_HOME: resolve('.dsh'), LOCUS_HOME: directory },
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
  assert.equal(run(['version'], { json: false }), '0.0.0\n')
  assert.match(run(['bogus'], { json: false, code: 1 }).stderr, /未知命令：bogus/)

  const workspace = run(['workspace', 'create', 'Smoke'])
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
  ])
  assert.match(shell.stdout, /"state":"accessible"/)
  assert.match(shell.stdout, /"state":"repository"/)
  assert.match(shell.stdout, new RegExp(head))
  assert.equal(shell.stdout.includes('smoke-secret'), false)
  assert.equal(shell.stderr, '')
  assert.deepEqual(readFileSync(join(shared, '.git', 'index')), index)

  const reopened = run(['workspace', 'show', workspace.id])
  assert.equal(reopened.id, workspace.id)
  assert.equal(reopened.relations.length, 2)
  assert.deepEqual(reopened.relations.map((relation) => relation.kind).sort(), ['association', 'member'])

  const offline = runShell([
    `--json workspace show ${workspace.id}`,
    `--json capability list ${workspace.id}`,
    `fs register ${workspace.id} ${shared}`,
  ], { patch: missingFilesystem, code: 2 })
  assert.match(offline.stdout, new RegExp(workspace.id))
  assert.match(offline.stdout, /"declared":false/)
  assert.match(offline.stdout, /"configured":true/)
  assert.match(offline.stderr, /Filesystem 能力不可用/)

  console.log('PASS profile: launcher、退出码、跨进程恢复、插件停用与 shell 组合符合断言。')
  console.log(`Workspace profile smoke: PASS (${invocations} independent DSH processes)`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
