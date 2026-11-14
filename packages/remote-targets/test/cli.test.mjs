import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const CLI = fileURLToPath(new URL('../../../apps/cli/lib/index.js', import.meta.url))

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-remote-target-cli-'))
  const data = join(root, 'data')
  const run = (args, options = {}) => {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      cwd: options.cwd ?? root,
      ...(options.input === undefined ? {} : { input: options.input }),
      env: { ...process.env, LOCUS_HOME: data },
      timeout: 30000,
      windowsHide: true,
    })
    return {
      code: result.status,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    }
  }
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, data, run }
}

function spec() {
  return JSON.stringify({
    resource: { kind: 'windows-device', label: 'smoke' },
    identity: { login: 'Administrator', auth: { method: 'key' } },
    connectivity: { via: 'frp', host: '127.0.0.1', port: 6001 },
  })
}

test('add 从 stdin 与文件读取 spec，JSON 与人类输出各自稳定', (t) => {
  const f = fixture(t)
  const stdin = f.run(['remote-targets', 'add', 'win-x', '--spec', '-'], { input: spec() })
  assert.equal(stdin.code, 0)
  assert.match(stdin.stdout, /已登记目标 win-x/)
  assert.equal(existsSync(join(f.data, 'remote-targets', 'credentials', 'win-x')), true)

  const file = join(f.root, 'target.json')
  writeFileSync(file, spec(), 'utf8')
  const fromFile = f.run(['rt', 'add', 'file-target', '--spec', file])
  assert.equal(fromFile.code, 0)

  const listed = f.run(['--json', 'remote-targets', 'list'])
  assert.equal(listed.code, 0)
  assert.deepEqual(JSON.parse(listed.stdout).map((target) => target.id), ['win-x', 'file-target'])

  const shown = f.run(['remote-targets', 'show', 'win'])
  assert.equal(shown.code, 0)
  assert.match(shown.stdout, /目标：win-x/)
  assert.match(shown.stdout, /身份：Administrator/)
})

test('remove 必须显式确认', (t) => {
  const f = fixture(t)
  assert.equal(f.run(['remote-targets', 'add', 'win-x', '--spec', '-'], { input: spec() }).code, 0)

  const rejected = f.run(['remote-targets', 'remove', 'win-x'])
  assert.equal(rejected.code, 1)
  assert.equal(JSON.parse(f.run(['--json', 'remote-targets', 'list']).stdout).length, 1)

  const removed = f.run(['remote-targets', 'remove', 'win-x', '--yes'])
  assert.equal(removed.code, 0)
  assert.equal(JSON.parse(f.run(['--json', 'remote-targets', 'list']).stdout).length, 0)
})

test('服务错误映射为退出码 2，诊断只写 stderr', (t) => {
  const f = fixture(t)
  assert.equal(f.run(['remote-targets', 'add', 'win-x', '--spec', '-'], { input: spec() }).code, 0)

  const gated = f.run(['remote-targets', 'exec', 'win-x', '--', 'whoami'])
  assert.equal(gated.code, 2)
  assert.equal(gated.stdout, '')
  assert.match(gated.stderr, /组件 openssh/)

  const openssh = `id: openssh
version: '1'
name: openssh
summary: 测试用组件
kind: external
probe:
  argv: [node, --version]
`
  assert.equal(f.run(['component', 'add', '-'], { input: openssh }).code, 0)
  assert.equal(f.run(['component', 'probe', 'openssh']).code, 0)

  const exec = f.run(['remote-targets', 'exec', 'win-x', '--', 'whoami'])
  assert.equal(exec.code, 2)
  assert.equal(exec.stdout, '')
  assert.match(exec.stderr, /缺少凭据文件/)
  assert.equal(existsSync(join(f.data, 'remote-targets', 'state.sqlite')), false)
})

