import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { createLocusCore } from '../packages/core/lib/index.js'
import { createFilesystemService } from '../plugins/filesystem/lib/index.js'
import { createGitService } from '../plugins/git/lib/index.js'
import { createCommands } from '../plugins/cli/lib/commands.js'
import { runShell, splitCommandLine } from '../plugins/cli/lib/shell.js'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-shell-'))
  const data = join(root, 'data')
  const resources = join(root, 'resources')
  mkdirSync(resources)
  const core = createLocusCore({ dataDirectory: data })
  const filesystem = createFilesystemService(core)
  const git = createGitService(core, filesystem)
  t.after(async () => {
    await git.dispose()
    await filesystem.dispose()
    await core.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  return {
    resources,
    core,
    create: () => ({ commands: createCommands(core, filesystem, git), current: () => true }),
  }
}

function capture(stream) {
  let text = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => { text += chunk })
  return () => text
}

async function shellSession(f, inputLines) {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const readOut = capture(stdout)
  const readErr = capture(stderr)
  let exitCode
  const pending = runShell(f.create, (code) => { exitCode = code }, () => {}, { stdin, stdout, stderr })
  stdin.end(`${inputLines.join('\n')}\n`)
  await pending
  return { stdout: readOut(), stderr: readErr(), exitCode }
}

test('一行命令拆分保留引号内空白、Windows 路径和转义', () => {
  assert.deepEqual(splitCommandLine('workspace create "Two Words"'), ['workspace', 'create', 'Two Words'])
  assert.deepEqual(splitCommandLine("fs register id 'C:\\space dir\\file'"), ['fs', 'register', 'id', 'C:\\space dir\\file'])
  assert.deepEqual(splitCommandLine('workspace create C:\\Users\\name'), ['workspace', 'create', 'C:\\Users\\name'])
  assert.deepEqual(splitCommandLine('workspace create "a \\"quoted\\" name"'), ['workspace', 'create', 'a "quoted" name'])
  assert.throws(() => splitCommandLine('workspace create "unterminated'), /引号未闭合/)
})

test('shell 连续执行真实命令，失败不终止且退出码取最后一条', async (t) => {
  const f = fixture(t)
  const result = await shellSession(f, [
    'workspace create Shell',
    '--json workspace list',
    'bogus',
    'version',
    'exit',
  ])
  assert.match(result.stdout, /Workspace: Shell/)
  assert.match(result.stdout, /"name":"Shell"/)
  assert.match(result.stderr, /未知命令：bogus/)
  assert.equal(result.stdout.trimEnd().endsWith('0.0.0'), true)
  assert.equal(result.exitCode, 0)

  const failed = await shellSession(f, ['bogus', 'exit'])
  assert.equal(failed.exitCode, 1)
})

test('shell 注册含空格的路径并在失败后继续使用真实服务', async (t) => {
  const f = fixture(t)
  const workspace = f.core.workspaces.create('Paths')
  const directory = join(f.resources, 'space dir')
  mkdirSync(directory)
  const result = await shellSession(f, [
    `capability configure ${workspace.id} filesystem`,
    `fs register ${workspace.id} "${directory}"`,
    `fs register ${workspace.id} "${join(f.resources, 'missing')}"`,
    `--json fs locations ${workspace.id}`,
    'exit',
  ])
  assert.match(result.stdout, /space dir/)
  assert.match(result.stdout, /missing/)
  assert.equal(result.exitCode, 0)
})

test('插件卸载关闭 shell 但不请求进程退出，在途结果不写成成功', async (t) => {
  const f = fixture(t)
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const readOut = capture(stdout)
  let dispose
  let exited = false
  let resolveOperation
  const pending = runShell(
    () => ({
      commands: {
        program: createCommands(f.core, undefined, undefined).program,
        parse() {},
        execute: () => new Promise((resolve) => { resolveOperation = resolve }),
        json: () => false,
        shell: () => false,
      },
      current: () => true,
    }),
    () => { exited = true },
    (callback) => { dispose = callback },
    { stdin, stdout, stderr },
  )
  stdin.write('slow\n')
  await new Promise((resolve) => setImmediate(resolve))
  dispose()
  resolveOperation({ value: {}, text: '不应输出' })
  await pending
  assert.equal(exited, false)
  assert.equal(readOut().includes('不应输出'), false)
})

test('服务在操作期间重载时丢弃旧结果并继续 shell', async (t) => {
  const f = fixture(t)
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const readOut = capture(stdout)
  const readErr = capture(stderr)
  let created = 0
  const pending = runShell(
    () => {
      created++
      return {
        commands: {
          program: createCommands(f.core, undefined, undefined).program,
          parse() {},
          execute: () => Promise.resolve({ value: {}, text: '旧结果' }),
          json: () => false,
          shell: () => false,
        },
        current: () => false,
      }
    },
    () => {},
    () => {},
    { stdin, stdout, stderr },
  )
  stdin.end('show\nexit\n')
  await pending
  assert.equal(created, 1)
  assert.equal(readOut().includes('旧结果'), false)
  assert.match(readErr(), /能力已重载/)
})
