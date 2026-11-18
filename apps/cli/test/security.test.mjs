import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createLocusCore } from '@locus/core'
import { createMemoryCredentialProvider, createMemorySecurityStore, SecurityFailure } from '@locus/core/security'
import { component as postgresComponent, operations as postgresOperations } from '@locus/postgres'
import { createProgram } from '../lib/program.js'
import { createTerminalSecurityUI } from '../lib/host/terminal.js'

const ROOT_PASSWORD = 'Root-CLI隔离测试-2026'
const NEW_PASSWORD = 'Root-CLI替换测试-2026'
const SECRET = 'credential-CLI-sentinel-不得输出'

function failure(code) {
  return (error) => error instanceof SecurityFailure && error.code === code
}

function scriptedUI(values = [], confirmation = true, interactive = true) {
  const inputs = [...values]
  const prompts = []
  const warnings = []
  return {
    interactive,
    prompts,
    warnings,
    async readSecret(prompt) {
      prompts.push(prompt)
      assert.ok(inputs.length > 0, '可信 UI 不应出现额外秘密输入')
      const value = inputs.shift()
      if (value instanceof Error) throw value
      return typeof value === 'function' ? await value() : value
    },
    async confirmLocalTakeover(warning) { warnings.push(warning); return confirmation },
  }
}

async function fixture(t) {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'locus-cli-security-'))
  let host
  const core = createLocusCore({
    dataDirectory,
    components: [{ component: postgresComponent, operations: postgresOperations }],
    security: {
      store: createMemorySecurityStore(),
      provider: createMemoryCredentialProvider(),
      receiveHost(value) { host = value },
    },
  })
  t.after(async () => {
    await core.dispose()
    rmSync(dataDirectory, { recursive: true, force: true })
  })
  return { core, dataDirectory, host }
}

async function invoke(t, setup, args, ui) {
  process.exitCode = undefined
  let stdout = ''
  let stderr = ''
  const program = createProgram(setup.core, { host: setup.host, ui })
  function configure(command) {
    command.exitOverride().configureOutput({
      writeOut(value) { stdout += value },
      writeErr(value) { stderr += value },
    })
    for (const child of command.commands) configure(child)
  }
  configure(program)
  let error
  try {
    await program.parseAsync(args, { from: 'user' })
  } catch (caught) {
    error = caught
  }
  for (const value of [ROOT_PASSWORD, NEW_PASSWORD, SECRET]) {
    assert.equal(stdout.includes(value), false)
    assert.equal(stderr.includes(value), false)
  }
  return { stdout, stderr, error, code: process.exitCode }
}

function success(result) {
  assert.equal(result.error, undefined, result.stderr)
  return JSON.parse(result.stdout)
}

test('真实入口的 version、help 与非 TTY init 保持惰性', () => {
  const root = mkdtempSync(join(tmpdir(), 'locus-cli-entry-'))
  try {
    const cli = fileURLToPath(new URL('../lib/index.js', import.meta.url))
    const run = (args) => spawnSync(process.execPath, [cli, ...args], {
        encoding: 'utf8',
        env: { ...process.env, LOCUS_HOME: join(root, 'data'), LOCUS_FOLDER_NAME: undefined },
      })
    const version = run(['version'])
    assert.equal(version.status, 0)
    assert.equal(existsSync(join(root, 'data')), false)
    const init = run(['init'])
    assert.equal(init.status, 2)
    assert.match(init.stderr, /authentication-unavailable/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('init 提示两次隐藏密码，status 可在非交互路径读取', async (t) => {
  const setup = await fixture(t)
  const ui = scriptedUI([ROOT_PASSWORD, ROOT_PASSWORD])
  const initialized = await invoke(t, setup, ['--json', 'init'], ui)
  assert.deepEqual(success(initialized), { initialized: true })
  assert.deepEqual(ui.prompts, ['新 Root 密码：', '再次输入新 Root 密码：'])

  const status = success(await invoke(t, setup, ['--json', 'security', 'status'], scriptedUI()))
  assert.equal(status.initialized, true)
  assert.equal(status.profile, 'production')
})

test('URL 动词由可信 Host 收集 tty 字段并完成 init', async (t) => {
  const setup = await fixture(t)
  const ui = scriptedUI([ROOT_PASSWORD, ROOT_PASSWORD])
  const result = await invoke(t, setup, ['--json', 'post', 'locus://security/actions/init'], ui)
  const payload = success(result)
  assert.equal(payload.ok, true)
  assert.deepEqual(ui.prompts, ['password（隐藏输入）：', 'confirmation（隐藏输入）：'])

  const status = success(await invoke(t, setup, ['--json', 'security', 'status'], scriptedUI()))
  assert.equal(status.initialized, true)
})

test('pg register 先收集密码再完成 Root 授权；元数据不包含秘密', async (t) => {
  const setup = await fixture(t)
  await success(await invoke(t, setup, ['--json', 'init'], scriptedUI([ROOT_PASSWORD, ROOT_PASSWORD])))
  const ui = scriptedUI([SECRET, ROOT_PASSWORD])
  const registered = success(await invoke(t, setup, [
    '--json', 'pg', 'register', 'app', '--host', 'localhost', '--database', 'app', '--username', 'u',
  ], ui))
  assert.equal(registered.registered, true)
  assert.match(registered.reference, /^credential:/)
  assert.deepEqual(ui.prompts, ['PostgreSQL 密码（隐藏输入）：', 'Root 密码（授权 postgres:pg.database.register）：'])

  const list = success(await invoke(t, setup, ['--json', 'credential', 'list'], scriptedUI([ROOT_PASSWORD])))
  assert.equal(list.length, 1)
  assert.deepEqual(list[0].fields, { host: 'localhost', database: 'app', username: 'u' })
  assert.equal(JSON.stringify(list).includes(SECRET), false)

  const bindings = success(await invoke(t, setup, ['--json', 'credential', 'bindings'], scriptedUI([ROOT_PASSWORD])))
  assert.equal(bindings[0].componentId, 'postgres')
  assert.equal(bindings[0].slot, 'database-auth')
  assert.equal(bindings[0].resourceKey, 'app')

  const status = success(await invoke(t, setup, ['--json', 'credential', 'status', registered.reference], scriptedUI([ROOT_PASSWORD])))
  assert.equal(status.metadata.reference, registered.reference)
  assert.equal(status.present, true)
})

test('security operation list/set/reset 改变授权等级', async (t) => {
  const setup = await fixture(t)
  await success(await invoke(t, setup, ['--json', 'init'], scriptedUI([ROOT_PASSWORD, ROOT_PASSWORD])))

  const listed = success(await invoke(t, setup, ['--json', 'security', 'operation', 'list'], scriptedUI([ROOT_PASSWORD])))
  const register = listed.find((item) => item.operation === 'pg.database.register')
  assert.equal(register.effectiveAuthLevel, 'root')

  const set = success(await invoke(
    t, setup, ['--json', 'security', 'operation', 'set', 'postgres:pg.database.register', 'user'],
    scriptedUI([ROOT_PASSWORD]),
  ))
  assert.equal(set.effectiveAuthLevel, 'user')
  assert.equal(set.source, 'override')

  const reset = success(await invoke(
    t, setup, ['--json', 'security', 'operation', 'reset', 'postgres:pg.database.register'],
    scriptedUI([ROOT_PASSWORD]),
  ))
  assert.equal(reset.effectiveAuthLevel, 'root')
  assert.equal(reset.source, 'operation')
})

test('shell 读取 Workspace 经过 Root 覆盖路由：非交互拒绝，交互授权后才输出含挂载的上下文', async (t) => {
  const setup = await fixture(t)
  success(await invoke(t, setup, ['--json', 'init'], scriptedUI([ROOT_PASSWORD, ROOT_PASSWORD])))
  const workspace = success(await invoke(t, setup, ['--json', 'workspace', 'create', '受控 Shell'], scriptedUI()))
  const mount = success(await invoke(t, setup, [
    '--json', 'workspace', 'mount', workspace.id, setup.dataDirectory, '--name', 'data',
  ], scriptedUI()))
  success(await invoke(t, setup, [
    '--json', 'security', 'operation', 'set', 'locus:locus.workspaces.get', 'root',
  ], scriptedUI([ROOT_PASSWORD])))

  const unavailable = scriptedUI([], true, false)
  const denied = await invoke(t, setup, ['shell', workspace.id, '--print-env'], unavailable)
  assert.ok(denied.error instanceof SecurityFailure)
  assert.equal(denied.error.code, 'authentication-unavailable')
  assert.equal(denied.stdout, '')
  assert.deepEqual(unavailable.prompts, [])

  const ui = scriptedUI([ROOT_PASSWORD])
  const context = success(await invoke(t, setup, ['--pretty', 'shell', workspace.id, '--print-env'], ui))
  assert.deepEqual(ui.prompts, ['Root 密码（授权 locus:locus.workspaces.get）：'])
  assert.equal(context.environment.LOCUS_WORKSPACE_ID, workspace.id)
  assert.equal(context.cwd, setup.dataDirectory)
  assert.deepEqual(context.mounts.map((item) => item.id), [mount.id])
})

test('change-root-password 先收集新密码，再以旧 Root 认证；旧密码失效', async (t) => {
  const setup = await fixture(t)
  await success(await invoke(t, setup, ['--json', 'init'], scriptedUI([ROOT_PASSWORD, ROOT_PASSWORD])))
  const ui = scriptedUI([NEW_PASSWORD, NEW_PASSWORD, ROOT_PASSWORD])
  const changed = success(await invoke(t, setup, ['--json', 'security', 'change-root-password'], ui))
  assert.deepEqual(changed, { changed: true })

  const old = await invoke(t, setup, ['--json', 'credential', 'list'], scriptedUI([ROOT_PASSWORD]))
  assert.ok(old.error instanceof SecurityFailure)
  assert.equal(old.error.code, 'authentication-failed')
  const current = success(await invoke(t, setup, ['--json', 'credential', 'list'], scriptedUI([NEW_PASSWORD])))
  assert.deepEqual(current, [])
})

test('reset-root 必须确认本机接管，不需要旧密码，并撤销既有授权', async (t) => {
  const setup = await fixture(t)
  await success(await invoke(t, setup, ['--json', 'init'], scriptedUI([ROOT_PASSWORD, ROOT_PASSWORD])))
  const rejected = scriptedUI([], false)
  const cancelled = await invoke(t, setup, ['--json', 'security', 'reset-root'], rejected)
  assert.ok(cancelled.error)
  assert.equal(cancelled.error.exitCode, 2)
  assert.equal(rejected.prompts.length, 0)

  const ui = scriptedUI([NEW_PASSWORD, NEW_PASSWORD], true)
  const reset = success(await invoke(t, setup, ['--json', 'security', 'reset-root'], ui))
  assert.deepEqual(reset, { reset: true })
  assert.equal(ui.warnings.length, 1)
  await success(await invoke(t, setup, ['--json', 'credential', 'list'], scriptedUI([NEW_PASSWORD])))
})

test('URL 动词输出信封；批量 GET 保留部分失败并按协议返回退出码', async (t) => {
  const setup = await fixture(t)
  const info = await invoke(t, setup, ['--json', 'get', 'locus://info'], scriptedUI())
  const payload = success(info)
  assert.equal(payload.ok, true)
  assert.equal(payload.data.version, '0.0.0')

  const created = success(await invoke(t, setup, [
    '--json', 'post', 'locus://workspaces', '--data', '{"name":"URL 工作区"}',
  ], scriptedUI()))
  assert.equal(created.ok, true)
  assert.equal(created.data.name, 'URL 工作区')

  const batch = await invoke(t, setup, ['--json', 'get', 'locus://info', 'locus://missing'], scriptedUI())
  assert.equal(batch.code, 3)
  const results = JSON.parse(batch.stdout)
  assert.equal(results.length, 2)
  assert.equal(results[0].ok, true)
  assert.equal(results[1].error.code, 'not-found')

  const invalidBody = await invoke(t, setup, [
    '--json', 'post', 'locus://workspaces', '--data', '{"name":"x"}', '--content-type', 'text/plain',
  ], scriptedUI())
  assert.ok(invalidBody.error)
  assert.equal(invalidBody.error.exitCode, 1)
})

test('events list 查询请求事件', async (t) => {
  const setup = await fixture(t)
  await success(await invoke(t, setup, ['--json', 'workspace', 'create', '事件'], scriptedUI()))
  await success(await invoke(t, setup, ['--json', 'get', 'locus://info'], scriptedUI()))
  const events = success(await invoke(t, setup, ['--json', 'events', 'list', '--type', 'locus.request.succeeded'], scriptedUI()))
  assert.ok(events.length >= 1)
  assert.equal(events.every((event) => event.type === 'locus.request.succeeded'), true)
})

test('隐藏TTY输入不回显，支持Unicode退格/CtrlU并恢复raw和流动状态', async (t) => {
  const f = terminal(t)
  const first = f.ui.readSecret('隐藏：')
  f.input.write(`${SECRET}😀\u007f\r`)
  assert.equal(await first, SECRET)
  assert.equal(f.text(), '隐藏：\n')
  assert.equal(f.input.isRaw, false)
  assert.equal(f.input.readableFlowing, false)
  assert.deepEqual(f.modes, [true, false])
  const second = f.ui.readSecret('再次隐藏：')
  f.input.write(`discarded\u0015${NEW_PASSWORD}\r`)
  assert.equal(await second, NEW_PASSWORD)
  assert.equal(f.text().includes(NEW_PASSWORD), false)
  const prior = terminal(t, true, true)
  const preserved = prior.ui.readSecret('已有raw：')
  prior.input.write('value\r')
  assert.equal(await preserved, 'value')
  assert.equal(prior.input.isRaw, true)
  assert.equal(prior.input.readableFlowing, true)
})

test('TTY CtrlC、流错误与并发输入均安全终止，移除进程signal监听并恢复终端', async (t) => {
  const f = terminal(t)
  const sigint = process.listenerCount('SIGINT')
  const pending = f.ui.readSecret('隐藏：')
  await assert.rejects(() => f.ui.readSecret('禁止并发：'), failure('authentication-unavailable'))
  const cancelled = assert.rejects(pending, failure('authentication-cancelled'))
  f.input.write(`${SECRET}\u0003`)
  await cancelled
  assert.equal(f.input.isRaw, false)
  assert.equal(f.input.readableFlowing, false)
  assert.equal(f.text().includes(SECRET), false)
  assert.equal(process.listenerCount('SIGINT'), sigint)
  assert.equal(f.input.listenerCount('keypress'), 0)
  const broken = f.ui.readSecret('流错误：')
  const rejected = assert.rejects(broken, failure('authentication-unavailable'))
  f.input.emit('error', new Error(SECRET))
  await rejected
  assert.equal(f.input.isRaw, false)
  assert.equal(f.text().includes(SECRET), false)
  f.input.isTTY = false
  await assert.rejects(() => f.ui.readSecret('非TTY：'), failure('authentication-unavailable'))
})

test('TTY本机接管确认必须输入固定确认语，拒绝和CtrlC不读取新密码', async (t) => {
  const f = terminal(t)
  const no = f.ui.confirmLocalTakeover('本机管理接管警告')
  f.input.write('yes\r')
  assert.equal(await no, false)
  const yes = f.ui.confirmLocalTakeover('本机管理接管警告')
  f.input.write('RESET ROOT\r')
  assert.equal(await yes, true)
  assert.equal(f.text().includes('RESET ROOT\n'), false)
  const cancelled = f.ui.confirmLocalTakeover('本机管理接管警告')
  const rejected = assert.rejects(cancelled, failure('authentication-cancelled'))
  f.input.write('\u0003')
  await rejected
  assert.equal(f.input.isRaw, false)
})

function terminal(t, raw = false, flowing = false) {
  const input = new PassThrough()
  const output = new PassThrough()
  const modes = []
  let written = ''
  input.isTTY = true
  input.isRaw = raw
  input.setRawMode = (enabled) => { input.isRaw = enabled; modes.push(enabled); return input }
  output.isTTY = true
  output.on('data', (chunk) => { written += chunk.toString() })
  if (flowing) input.resume()
  t.after(() => { input.destroy(); output.destroy() })
  return { input, output, modes, ui: createTerminalSecurityUI(input, output), text: () => written }
}
