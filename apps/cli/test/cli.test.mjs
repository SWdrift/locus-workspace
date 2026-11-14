import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const CLI = fileURLToPath(new URL('../lib/index.js', import.meta.url))

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-cli-'))
  const data = join(root, 'data')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  /** 每个命令都是独立进程，跨进程恢复由文件系统与 SQLite 真实承担。 */
  const run = (args, environment = {}) => {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, LOCUS_HOME: data, ...environment },
    })
    return {
      code: result.status,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    }
  }
  return { root, data, run }
}

function parseJson(value) {
  return JSON.parse(value)
}

test('version 与 help 不创建数据目录，退出码为 0', (t) => {
  const f = fixture(t)
  const version = f.run(['version'])
  assert.equal(version.code, 0)
  assert.equal(version.stdout, '0.0.0')
  assert.equal(version.stderr, '')
  assert.equal(existsSync(f.data), false)

  const help = f.run(['--help'])
  assert.equal(help.code, 0)
  assert.match(help.stdout, /workspace/)
  assert.equal(existsSync(f.data), false)
})

test('Workspace 创建、列举、打开、改名与 JSON 输出跨进程保持身份', (t) => {
  const f = fixture(t)
  const created = f.run(['workspace', 'create', '研究'])
  assert.equal(created.code, 0)
  assert.match(created.stdout, /Workspace: 研究/)
  const idMatch = /Identity: ([0-9a-f-]+)/.exec(created.stdout)
  assert.ok(idMatch)
  const id = idMatch[1]

  const listed = f.run(['--json', 'workspace', 'list'])
  assert.equal(listed.code, 0)
  const workspaces = parseJson(listed.stdout)
  assert.equal(workspaces.length, 1)
  assert.equal(workspaces[0].name, '研究')
  assert.equal(workspaces[0].id, id)

  const opened = f.run(['workspace', 'open', id])
  assert.equal(opened.code, 0)
  assert.match(opened.stdout, new RegExp(`Identity: ${id}`))

  const renamed = f.run(['--json', 'workspace', 'rename', id, '研究二'])
  assert.equal(renamed.code, 0)
  assert.equal(parseJson(renamed.stdout).name, '研究二')
  assert.equal(parseJson(renamed.stdout).id, id)
})

test('显式关系幂等、拒绝自引用，解除必须确认且只移除关系', (t) => {
  const f = fixture(t)
  const created = parseJson(f.run(['--json', 'workspace', 'create', '关系']).stdout)
  const id = created.id

  const linked = parseJson(
    f.run(['--json', 'workspace', 'link', id, 'example.resource', 'abc']).stdout,
  )
  assert.equal(linked.kind, 'association')
  assert.deepEqual(linked.target, { namespace: 'example.resource', id: 'abc' })
  assert.deepEqual(linked.source, { kind: 'manual', detail: 'CLI 显式输入' })

  const repeated = parseJson(
    f.run(['--json', 'workspace', 'link', id, 'example.resource', 'abc']).stdout,
  )
  assert.equal(repeated.id, linked.id)

  const selfLink = f.run(['workspace', 'link', id, 'locus.workspace', id])
  assert.equal(selfLink.code, 2)
  assert.equal(selfLink.stdout, '')
  assert.match(selfLink.stderr, /不能把自身/)

  const missingConfirmation = f.run(['workspace', 'unlink', id, linked.id])
  assert.equal(missingConfirmation.code, 1)
  assert.equal(missingConfirmation.stdout, '')

  const unlinked = f.run(['workspace', 'unlink', id, linked.id, '--yes'])
  assert.equal(unlinked.code, 0)
  assert.match(unlinked.stdout, /外部资源未删除/)
  assert.deepEqual(parseJson(f.run(['--json', 'workspace', 'show', id]).stdout).relations, [])
})

test('无参数与未知命令给出稳定失败，相对数据目录按工作目录解析', (t) => {
  const f = fixture(t)
  const noCommand = f.run([])
  assert.equal(noCommand.code, 1)
  assert.equal(noCommand.stdout, '')

  const unknown = f.run(['bogus'])
  assert.equal(unknown.code, 1)
  assert.equal(unknown.stdout, '')
  assert.match(unknown.stderr, /未知命令：bogus/)

  const relative = f.run(['--json', 'workspace', 'create', '相对数据目录'], {
    LOCUS_HOME: 'relative-data',
  })
  assert.equal(relative.code, 0)
  assert.equal(existsSync(join(f.root, 'relative-data', 'core.sqlite')), true)
})

test('读取工作目录 .env，显式环境变量优先', (t) => {
  const f = fixture(t)
  writeFileSync(join(f.root, '.env'), 'LOCUS_HOME=env-data\nLOCUS_FOLDER_NAME=.locus\n')
  const base = { ...process.env }
  delete base.LOCUS_HOME
  delete base.LOCUS_FOLDER_NAME
  const run = (args, overrides = {}) =>
    spawnSync(process.execPath, [CLI, ...args], {
      cwd: f.root,
      encoding: 'utf8',
      env: { ...base, ...overrides },
    })

  const created = run(['--json', 'workspace', 'create', '环境数据'])
  assert.equal(created.status, 0, created.stderr)
  assert.equal(existsSync(join(f.root, 'env-data', '.locus', 'core.sqlite')), true)

  const explicit = run(['--json', 'workspace', 'list'], { LOCUS_HOME: f.data })
  assert.equal(explicit.status, 0, explicit.stderr)
  assert.deepEqual(JSON.parse(explicit.stdout), [])
  assert.equal(existsSync(join(f.data, '.locus', 'core.sqlite')), true)
})

test('挂载目录、注入 shell 上下文，并在删除 Workspace 时清理自有记录', (t) => {
  const f = fixture(t)
  const workspace = parseJson(f.run(['--json', 'workspace', 'create', '挂载语境']).stdout)
  const appPath = join(f.root, 'app')
  const dataPath = join(f.root, 'data-folder')
  mkdirSync(appPath)
  mkdirSync(dataPath)

  const app = parseJson(
    f.run(['--json', 'workspace', 'mount', workspace.id, appPath, '--name', 'app']).stdout,
  )
  assert.equal(app.name, 'app')
  assert.equal(app.path, appPath)

  const data = parseJson(
    f.run(['--json', 'workspace', 'mount', workspace.id, dataPath]).stdout,
  )
  assert.equal(data.name, 'data-folder')

  const duplicate = f.run(['workspace', 'mount', workspace.id, appPath])
  assert.equal(duplicate.code, 2)
  assert.match(duplicate.stderr, /路径已挂载/)

  const mounted = parseJson(f.run(['--json', 'workspace', 'mounts', workspace.id]).stdout)
  assert.deepEqual(mounted.map((mount) => mount.name), ['app', 'data-folder'])
  assert.equal(parseJson(f.run(['--json', 'workspace', 'show', '挂载语境']).stdout).mounts.length, 2)

  const context = parseJson(f.run(['shell', '挂载语境', '--print-env']).stdout)
  assert.equal(context.cwd, appPath)
  assert.equal(context.environment.LOCUS_WORKSPACE_ID, workspace.id)
  assert.equal(context.environment.LOCUS_WORKSPACE_NAME, '挂载语境')
  assert.equal(context.environment.LOCUS_WORKSPACE_ROOT, appPath)
  assert.equal(context.environment.LOCUS_MOUNT_APP, appPath)
  assert.equal(parseJson(context.environment.LOCUS_MOUNTS).length, 2)
  const pathValue = Object.entries(context.environment)
    .find(([key]) => key.toLowerCase() === 'path')?.[1] ?? ''
  assert.match(pathValue, /locus-shell-/)
  assert.match(context.environment.LOCUS_CLI, /index\.js$/)
  assert.deepEqual(context.missing, [])

  const shellVersion = f.run(['shell', workspace.id, '--command', 'locus version'])
  assert.equal(shellVersion.code, 0)
  assert.equal(shellVersion.stdout, '0.0.0')
  const shellExit = f.run(['shell', workspace.id, '--command', 'exit 7'])
  assert.equal(shellExit.code, 7)

  const unconfirmed = f.run(['workspace', 'unmount', workspace.id, 'app'])
  assert.equal(unconfirmed.code, 1)
  const unmounted = f.run(['workspace', 'unmount', workspace.id, 'app', '--yes'])
  assert.equal(unmounted.code, 0)
  assert.deepEqual(
    parseJson(f.run(['--json', 'workspace', 'mounts', workspace.id]).stdout).map((mount) => mount.name),
    ['data-folder'],
  )

  const removeUnconfirmed = f.run(['workspace', 'remove', workspace.id])
  assert.equal(removeUnconfirmed.code, 1)
  const removed = f.run(['workspace', 'remove', workspace.id, '--yes'])
  assert.equal(removed.code, 0)
  assert.deepEqual(parseJson(f.run(['--json', 'workspace', 'list']).stdout), [])
  assert.equal(existsSync(appPath), true)
  assert.equal(existsSync(dataPath), true)
})
