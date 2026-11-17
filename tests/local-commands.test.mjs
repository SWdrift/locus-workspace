import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const LOCAL = fileURLToPath(new URL('../scripts/local.mjs', import.meta.url))
const BACKUP = fileURLToPath(new URL('../scripts/backup.mjs', import.meta.url))

function run(script, args, environment = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: undefined,
      LOCUS_CLI: undefined,
      LOCUS_HOME: undefined,
      LOCUS_FOLDER_NAME: undefined,
      ...environment,
    },
  })
  return { code: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() }
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-local-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const data = join(root, 'data')
  const envFile = join(root, 'env')
  mkdirSync(join(data, 'components'), { recursive: true })
  writeFileSync(join(data, 'state.txt'), 'sqlite-fixture')
  writeFileSync(join(data, 'components', 'template.yaml'), 'id: template\n')
  writeFileSync(envFile, `LOCUS_HOME=${data}\n_LOCUS_ROOT_PASSWORD=test\n`)
  return {
    root,
    data,
    envFile,
    agent: join(root, 'agent'),
    bin: join(root, 'bin'),
    dest: join(root, 'backups'),
  }
}

test('备份按时间戳复制整个数据目录并拒绝重叠目标', (t) => {
  const f = fixture(t)
  const first = run(BACKUP, ['--env', f.envFile, '--dest', f.dest])
  assert.equal(first.code, 0, first.stderr)
  const names = readdirSync(f.dest)
  assert.equal(names.length, 1)
  const copy = join(f.dest, names[0])
  assert.match(names[0], /^\d{8}-\d{6}(?:-\d+)?$/)
  assert.equal(readFileSync(join(copy, 'state.txt'), 'utf8'), 'sqlite-fixture')
  assert.equal(readFileSync(join(copy, 'components', 'template.yaml'), 'utf8'), 'id: template\n')

  const second = run(BACKUP, ['--env', f.envFile, '--dest', f.dest])
  assert.equal(second.code, 0, second.stderr)
  assert.equal(readdirSync(f.dest).length, 2)

  const overlap = run(BACKUP, ['--env', f.envFile, '--dest', join(f.data, 'backup')])
  assert.equal(overlap.code, 1)
  assert.match(overlap.stderr, /不能与数据目录重叠/)

  const same = run(BACKUP, ['--env', f.envFile, '--dest', f.data])
  assert.equal(same.code, 1)
  assert.match(same.stderr, /不能与数据目录重叠/)
})

test('环境文件缺失时提示创建', (t) => {
  const f = fixture(t)
  const result = run(BACKUP, ['--env', join(f.root, 'missing.env')])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /未找到环境文件/)
  assert.match(result.stderr, /LOCUS_HOME=~\/\.locus/)
})

test('注册安装 Skill 与启动器，取消注册保留数据', (t) => {
  const f = fixture(t)
  const registered = run(LOCAL, [
    'register',
    '--env',
    f.envFile,
    '--agent-dir',
    f.agent,
    '--bin-dir',
    f.bin,
  ])
  assert.equal(registered.code, 0, registered.stderr)
  const skill = join(f.agent, 'skills', 'locus')
  const marker = JSON.parse(readFileSync(join(skill, '.locus-install.json'), 'utf8'))
  assert.equal(marker.dataDirectory, f.data)
  assert.match(marker.cli, /apps[\\/]cli[\\/]lib[\\/]index\.js$/)
  const launcher = join(f.bin, process.platform === 'win32' ? 'locus.cmd' : 'locus')
  assert.equal(existsSync(launcher), true)
  assert.match(readFileSync(launcher, 'utf8'), /locus-registered/)

  const listed = run(join(skill, 'scripts', 'workspace-pick.mjs'), [])
  assert.equal(listed.code, 0, listed.stderr)
  assert.equal(listed.stdout, '')

  const unregistered = run(LOCAL, ['unregister', '--agent-dir', f.agent, '--bin-dir', f.bin])
  assert.equal(unregistered.code, 0, unregistered.stderr)
  assert.equal(existsSync(skill), false)
  assert.equal(existsSync(launcher), false)
  assert.equal(existsSync(join(f.data, 'state.txt')), true)
})

test('本机删除需要 --yes，确认后删除数据目录与注册', (t) => {
  const f = fixture(t)
  const args = ['--env', f.envFile, '--agent-dir', f.agent, '--bin-dir', f.bin]
  const registered = run(LOCAL, ['register', ...args])
  assert.equal(registered.code, 0, registered.stderr)
  const skill = join(f.agent, 'skills', 'locus')
  const launcher = join(f.bin, process.platform === 'win32' ? 'locus.cmd' : 'locus')

  const refused = run(LOCAL, ['purge', ...args])
  assert.equal(refused.code, 1)
  assert.match(refused.stderr, /--yes/)
  assert.equal(existsSync(f.data), true)
  assert.equal(existsSync(skill), true)

  const purged = run(LOCAL, ['purge', '--yes', ...args])
  assert.equal(purged.code, 0, purged.stderr)
  assert.equal(existsSync(f.data), false)
  assert.equal(existsSync(skill), false)
  assert.equal(existsSync(launcher), false)
})
