import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// 真实构建产物层：只验证跨进程恢复、完整命令链、退出码与 pnpm 入口，
// 领域矩阵与单条命令细节由 `pnpm test` / `pnpm test:all` 覆盖。
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CLI = join(REPO, 'apps', 'cli', 'lib', 'index.js')
const root = mkdtempSync(join(tmpdir(), 'locus-cli-e2e-'))
const data = join(root, 'data')
let invocations = 0

if (!existsSync(CLI)) {
  rmSync(root, { recursive: true, force: true })
  throw new Error('缺少 apps/cli/lib/index.js：请先运行 `pnpm build`。')
}

function run(args, { code = 0, environment = {} } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO,
    env: { ...process.env, LOCUS_HOME: data, ...environment },
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  })
  invocations++
  assert.equal(result.error, undefined, `启动失败：${JSON.stringify(args)} ${result.error}`)
  assert.equal(
    result.status,
    code,
    `${JSON.stringify(args)}\nstdout=${result.stdout}\nstderr=${result.stderr}`,
  )
  return result
}

function json(args, options) {
  return JSON.parse(run(args, options).stdout)
}

function text(args, options) {
  return run(args, options).stdout.trim()
}

try {
  const version = text(['version'])
  assert.equal(version, '0.0.0')
  assert.match(text(['--help']), /workspace/)
  assert.equal(existsSync(data), false, 'version/help 不应创建数据目录')

  const alpha = json(['--json', 'workspace', 'create', '研究'])
  const beta = json(['--json', 'workspace', 'create', '子工作区'])
  for (const workspace of [alpha, beta]) {
    assert.match(workspace.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    assert.deepEqual(workspace.relations, [])
  }

  const listed = json(['--json', 'workspace', 'list'])
  assert.deepEqual(listed.map((workspace) => workspace.name), ['研究', '子工作区'])
  assert.match(text(['workspace', 'show', alpha.id]), new RegExp(`Identity: ${alpha.id}`))

  const renamed = json(['--json', 'workspace', 'rename', alpha.id, '研究二'])
  assert.equal(renamed.name, '研究二')
  assert.equal(renamed.id, alpha.id)

  const association = json([
    '--json', 'workspace', 'link', alpha.id, 'locus.workspace', beta.id,
  ])
  assert.equal(association.kind, 'association')
  assert.deepEqual(association.target, { namespace: 'locus.workspace', id: beta.id })

  const repeated = json([
    '--json', 'workspace', 'link', alpha.id, 'locus.workspace', beta.id,
  ])
  assert.equal(repeated.id, association.id)

  const member = json([
    '--json', 'workspace', 'link', alpha.id, 'example.resource', 'external', '--kind', 'member',
  ])
  assert.equal(member.kind, 'member')
  assert.deepEqual(member.source, { kind: 'manual', detail: 'CLI 显式输入' })

  const selfLink = run(['workspace', 'link', alpha.id, 'locus.workspace', alpha.id], { code: 2 })
  assert.match(selfLink.stderr, /不能把自身/)
  assert.equal(selfLink.stdout, '')

  const beforeUnlink = json(['--json', 'workspace', 'show', alpha.id])
  assert.equal(beforeUnlink.relations.length, 2)

  const unconfirmed = run(['workspace', 'unlink', alpha.id, association.id], { code: 1 })
  assert.equal(unconfirmed.stdout, '')
  run(['workspace', 'unlink', alpha.id, association.id, '--yes'])
  const afterUnlink = json(['--json', 'workspace', 'show', alpha.id])
  assert.deepEqual(afterUnlink.relations.map((relation) => relation.id), [member.id])

  assert.equal(json(['--json', 'workspace', 'list']).length, 2)
  assert.ok(statSync(join(data, 'core.sqlite')).size > 0)

  const noCommand = run([], { code: 1 })
  assert.equal(noCommand.stdout, '')
  const unknown = run(['bogus'], { code: 1 })
  assert.match(unknown.stderr, /未知命令：bogus/)
  const relativeHome = run(['version'], {
    code: 2,
    environment: { LOCUS_HOME: 'relative-data' },
  })
  assert.match(relativeHome.stderr, /LOCUS_HOME 必须是非空绝对路径/)

  const pnpm = process.env.npm_execpath
  if (pnpm) {
    const wrapper = spawnSync(process.execPath, [pnpm, 'locus', 'version'], {
      cwd: REPO,
      env: { ...process.env, LOCUS_HOME: data },
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
    })
    invocations++
    assert.equal(wrapper.error, undefined)
    assert.equal(wrapper.status, 0, wrapper.stderr)
    const lastLine = wrapper.stdout.trim().split(/\r?\n/).at(-1)
    assert.equal(lastLine, '0.0.0')
  }

  console.log(`CLI e2e 通过：${invocations} 次调用，数据目录 ${data}`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
