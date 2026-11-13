import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const CLI = fileURLToPath(new URL('../apps/cli/lib/index.js', import.meta.url))

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-cli-'))
  const data = join(root, 'data')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  /** 每个命令都是独立进程，跨进程恢复由文件系统与 SQLite 真实承担。 */
  const run = (args, environment = {}) => {
    const result = spawnSync(process.execPath, [CLI, ...args], {
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

test('无参数、未知命令与相对数据目录给出稳定失败', (t) => {
  const f = fixture(t)
  const noCommand = f.run([])
  assert.equal(noCommand.code, 1)
  assert.equal(noCommand.stdout, '')

  const unknown = f.run(['bogus'])
  assert.equal(unknown.code, 1)
  assert.equal(unknown.stdout, '')
  assert.match(unknown.stderr, /未知命令：bogus/)

  const relative = f.run(['version'], { LOCUS_HOME: 'relative-data' })
  assert.equal(relative.code, 2)
  assert.equal(relative.stdout, '')
  assert.match(relative.stderr, /LOCUS_HOME 必须是非空绝对路径/)
})
