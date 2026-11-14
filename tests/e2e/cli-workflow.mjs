import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// 真实构建产物层：只验证跨进程恢复、完整命令链、退出码与 pnpm 入口，
// 领域矩阵与单条命令细节由 `pnpm test` / `pnpm test:all` 覆盖。
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CLI = join(REPO, 'apps', 'cli', 'lib', 'index.js')
const PRODUCT_VERSION = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version
const root = mkdtempSync(join(tmpdir(), 'locus-cli-e2e-'))
const data = join(root, 'data')
let invocations = 0

if (!existsSync(CLI)) {
  rmSync(root, { recursive: true, force: true })
  throw new Error('缺少 apps/cli/lib/index.js：请先运行 `pnpm build`。')
}

function run(args, { code = 0, environment = {} } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
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
  assert.equal(version, PRODUCT_VERSION)
  assert.match(text(['--help']), /workspace/)
  assert.equal(existsSync(data), false, 'version/help 不应创建数据目录')

  const alpha = json(['--json', 'workspace', 'create', '研究'])
  const beta = json(['--json', 'workspace', 'create', '子工作区'])
  for (const workspace of [alpha, beta]) {
    assert.match(workspace.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    assert.deepEqual(workspace.relations, [])
    assert.deepEqual(workspace.mounts, [])
  }

  const listed = json(['--json', 'workspace', 'list'])
  assert.deepEqual(listed.map((workspace) => workspace.name), ['研究', '子工作区'])
  assert.match(text(['workspace', 'show', alpha.id]), new RegExp(`Identity: ${alpha.id}`))

  const renamed = json(['--json', 'workspace', 'rename', alpha.id, '研究二'])
  assert.equal(renamed.name, '研究二')
  assert.equal(renamed.id, alpha.id)

  const mountPath = join(root, 'files')
  mkdirSync(mountPath)
  const mounted = json([
    '--json', 'workspace', 'mount', alpha.id, mountPath, '--name', 'files',
  ])
  assert.equal(mounted.name, 'files')
  assert.equal(mounted.path, mountPath)
  assert.equal(json(['--json', 'workspace', 'mounts', alpha.id]).length, 1)

  const context = json(['shell', alpha.id, '--print-env'])
  assert.equal(context.cwd, mountPath)
  assert.equal(context.environment.LOCUS_WORKSPACE_ID, alpha.id)
  assert.equal(context.environment.LOCUS_MOUNT_FILES, mountPath)
  assert.equal(JSON.parse(context.environment.LOCUS_MOUNTS).length, 1)
  assert.equal(text(['shell', alpha.id, '--command', 'locus version']), PRODUCT_VERSION)

  const generatedPath = join(mountPath, 'generated')
  const generated = json(['--json', 'template', 'create', 'minimal', generatedPath])
  assert.equal(generated.template.id, 'minimal')
  assert.equal(existsSync(join(generatedPath, '.template.json')), true)
  assert.equal(existsSync(join(generatedPath, 'template.json')), false)

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
  assert.equal(beforeUnlink.mounts.length, 1)

  const unconfirmed = run(['workspace', 'unlink', alpha.id, association.id], { code: 1 })
  assert.equal(unconfirmed.stdout, '')
  run(['workspace', 'unlink', alpha.id, association.id, '--yes'])
  const afterUnlink = json(['--json', 'workspace', 'show', alpha.id])
  assert.deepEqual(afterUnlink.relations.map((relation) => relation.id), [member.id])

  assert.equal(json(['--json', 'workspace', 'list']).length, 2)
  assert.ok(statSync(join(data, 'core.sqlite')).size > 0)

  run(['workspace', 'remove', beta.id, '--yes'])
  assert.deepEqual(
    json(['--json', 'workspace', 'list']).map((workspace) => workspace.id),
    [alpha.id],
  )

  const noCommand = run([], { code: 1 })
  assert.equal(noCommand.stdout, '')
  const unknown = run(['bogus'], { code: 1 })
  assert.match(unknown.stderr, /未知命令：bogus/)
  run(['workspace', 'create', '相对数据目录'], {
    environment: { LOCUS_HOME: 'relative-data' },
  })
  assert.ok(statSync(join(root, 'relative-data', 'core.sqlite')).size > 0)
  const emptyHome = run(['version'], {
    code: 2,
    environment: { LOCUS_HOME: '   ' },
  })
  assert.match(emptyHome.stderr, /LOCUS_HOME 必须是非空路径/)

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
    assert.equal(lastLine, PRODUCT_VERSION)
  }

  console.log(`CLI e2e 通过：${invocations} 次调用，数据目录 ${data}`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
