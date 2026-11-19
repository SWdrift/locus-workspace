import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createLocusCore } from '@locus/core'
import { defineComponent } from '@locus/core/components'
import { defineOperation } from '@locus/core/invocation'
import { createMemoryCredentialProvider, createMemorySecurityStore, SecurityFailure } from '@locus/core/security'
import { component as postgresComponent, operations as postgresOperations } from '@locus/postgres'
import { component as remoteTargetsComponent, operations as remoteTargetsOperations } from '@locus/remote-targets'
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

async function fixture(t, components = [], { persistent = false } = {}) {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'locus-cli-security-'))
  let host
  const core = createLocusCore({
    dataDirectory,
    components: [{ component: postgresComponent, operations: postgresOperations }, ...components],
    security: {
      ...(persistent ? {} : { store: createMemorySecurityStore() }),
      provider: createMemoryCredentialProvider(),
      receiveHost(value) { host = value },
    },
  })
  t.after(async () => {
    await core.dispose()
    rmSync(dataDirectory, { recursive: true, force: true })
  })
  return { core, dataDirectory, host, secrets: [] }
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
  for (const value of [ROOT_PASSWORD, NEW_PASSWORD, SECRET, ...setup.secrets]) {
    assert.equal(stdout.includes(value), false)
    assert.equal(stderr.includes(value), false)
  }
  return { stdout, stderr, error, code: process.exitCode }
}

function success(result) {
  assert.equal(result.error, undefined, result.stderr)
  assert.ok(result.code === undefined || result.code === 0, result.stdout)
  return JSON.parse(result.stdout)
}

function temporaryComponent() {
  let calls = 0
  const stringOutput = {
    parse(value) {
      assert.equal(typeof value, 'string')
      return value
    },
  }
  const read = defineOperation({
    id: 'temporary.read',
    summary: '读取路径 id 指定的临时项目；无 Body。',
    method: 'GET', scheme: 'temporary', authority: 'items', path: '/:id', auth: 'user',
    input: {
      parse(value) {
        assert.equal(value, undefined)
        return undefined
      },
    },
    output: stringOutput,
    run: (_query, _input, context) => {
      calls += 1
      return `临时项目：${context.url.pathParams.id}`
    },
  })
  const write = defineOperation({
    id: 'temporary.write',
    summary: '写入路径 id 指定的临时项目；Body 必填 label，可信输入必填 token，可选 extra。',
    method: 'POST', scheme: 'temporary', authority: 'items', path: '/:id', auth: 'user',
    input: {
      parse(value) {
        assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value))
        assert.equal(typeof value.label, 'string')
        assert.equal(typeof value.token, 'string')
        assert.ok(value.extra === undefined || typeof value.extra === 'string')
        return { label: value.label, token: value.token, extra: value.extra }
      },
    },
    output: stringOutput,
    fields: {
      label: { description: '公开标签', required: true },
      token: { description: '必需令牌', secret: true, tty: true, file: true, required: true },
      extra: { description: '可选令牌', secret: true, tty: true, file: true, required: false },
    },
    run: (_query, input) => {
      calls += 1
      return `${input.label}:${createHash('sha256').update(`${input.token}:${input.extra ?? ''}`).digest('hex')}`
    },
  })
  return {
    definition: defineComponent({
      id: 'temporary', version: '1', name: '临时组件', summary: '验证声明即接入 CLI', kind: 'locus',
      operations: [read, write],
    }),
    calls: () => calls,
  }
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
    const help = run(['help', 'locus://security/actions/change-root-password'])
    assert.equal(help.status, 0, help.stderr)
    assert.match(help.stdout, /locus\.security\.change-root-password/)
    assert.equal(existsSync(join(root, 'data')), false)
    const init = run(['init'])
    assert.equal(init.status, 2)
    assert.match(init.stderr, /authentication-unavailable/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('init 保留两次隐藏密码交互，安全状态改由 URL 在非交互路径读取', async (t) => {
  const setup = await fixture(t)
  const ui = scriptedUI([ROOT_PASSWORD, ROOT_PASSWORD])
  const initialized = await invoke(t, setup, ['--json', 'init'], ui)
  assert.deepEqual(success(initialized), { initialized: true })
  assert.deepEqual(ui.prompts, ['新 Root 密码：', '再次输入新 Root 密码：'])

  const status = success(await invoke(
    t, setup, ['--json', 'get', 'locus://security'], scriptedUI([], true, false),
  )).data
  assert.equal(status.initialized, true)
  assert.equal(status.profile, 'production')
})

test('URL 动词由可信 Host 收集 tty 字段并完成 init', async (t) => {
  const setup = await fixture(t)
  const ui = scriptedUI([ROOT_PASSWORD, ROOT_PASSWORD])
  const result = await invoke(t, setup, ['--json', 'post', 'locus://security/actions/init'], ui)
  const payload = success(result)
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.data, { initialized: true })
  assert.equal(ui.prompts.length, 2)
  assert.match(ui.prompts[0], /密码/)
  assert.match(ui.prompts[1], /确认|再次/)

  const status = success(await invoke(t, setup, ['--json', 'get', 'locus://security'], scriptedUI())).data
  assert.equal(status.initialized, true)
})

test('pg PUT 先收集 tty 密码再完成 Root 授权；URL 凭据查询不包含秘密', async (t) => {
  const setup = await fixture(t)
  await success(await invoke(t, setup, ['--json', 'init'], scriptedUI([ROOT_PASSWORD, ROOT_PASSWORD])))
  const ui = scriptedUI([SECRET, ROOT_PASSWORD])
  const registered = success(await invoke(t, setup, [
    '--json', 'put', 'pg://databases/app', '--data',
    '{"host":"localhost","database":"app","username":"u"}',
  ], ui)).data
  assert.equal(registered.registered, true)
  assert.match(registered.reference, /^credential:/)
  assert.equal(ui.prompts.length, 2)
  assert.match(ui.prompts[0], /密码/)
  assert.equal(ui.prompts[1], 'Root 密码（授权 postgres:pg.database.register）：')

  const list = success(await invoke(t, setup, [
    '--json', 'get', 'locus://credentials',
  ], scriptedUI([ROOT_PASSWORD]))).data
  assert.equal(list.credentials.length, 1)
  assert.deepEqual(list.credentials[0].fields, { host: 'localhost', database: 'app', username: 'u' })
  assert.equal(JSON.stringify(list).includes(SECRET), false)

  const bindings = success(await invoke(t, setup, [
    '--json', 'get', 'locus://credentials/postgres',
  ], scriptedUI([ROOT_PASSWORD]))).data.bindings
  assert.equal(bindings[0].componentId, 'postgres')
  assert.equal(bindings[0].slot, 'database-auth')
  assert.equal(bindings[0].resourceKey, 'app')

  const binding = success(await invoke(t, setup, [
    '--json', 'get', 'locus://credentials/postgres/database-auth/app',
  ], scriptedUI([ROOT_PASSWORD]))).data
  assert.equal(binding.credential.reference, registered.reference)
  assert.equal(binding.binding.reference, registered.reference)

  const status = success(await invoke(t, setup, [
    '--json', 'post', 'locus://credentials/actions/status', '--data',
    JSON.stringify({ reference: registered.reference }),
  ], scriptedUI([ROOT_PASSWORD]))).data
  assert.equal(status.metadata.reference, registered.reference)
  assert.equal(status.present, true)
})

test('pg 的公开 Body 文件与可信密码文件分离，文件输入不重复提示、不进入事件或 SQLite', async (t) => {
  const setup = await fixture(t, [], { persistent: true })
  success(await invoke(t, setup, ['--json', 'init'], scriptedUI([ROOT_PASSWORD, ROOT_PASSWORD])))
  const bodyFile = join(setup.dataDirectory, 'postgres-body.json')
  const passwordFile = join(setup.dataDirectory, 'postgres-password.txt')
  writeFileSync(bodyFile, '{"host":"localhost","database":"app","username":"u"}', 'utf8')
  writeFileSync(passwordFile, SECRET, 'utf8')
  const ui = scriptedUI([ROOT_PASSWORD])
  const registered = success(await invoke(t, setup, [
    '--json', 'put', 'pg://databases/app', '--file', bodyFile,
    '--field-file', `password=${passwordFile}`,
  ], ui)).data
  assert.equal(registered.registered, true)
  assert.deepEqual(ui.prompts, ['Root 密码（授权 postgres:pg.database.register）：'])
  const status = success(await invoke(t, setup, [
    '--json', 'post', 'locus://credentials/actions/status', '--data',
    JSON.stringify({ reference: registered.reference }),
  ], scriptedUI([ROOT_PASSWORD]))).data
  assert.equal(status.present, true)
  assert.deepEqual(status.metadata.fields, { host: 'localhost', database: 'app', username: 'u' })
  assert.equal(JSON.stringify(setup.core.events.list()).includes(SECRET), false)
  assert.equal(readFileSync(join(setup.dataDirectory, 'core.sqlite')).includes(Buffer.from(SECRET)), false)
  assert.equal(Object.values(process.env).includes(SECRET), false)
})

test('远程目标使用 Nodecrypto 私钥文件或显式 password 提示，不盲目采集另一种凭据', async (t) => {
  const setup = await fixture(t, [{ component: remoteTargetsComponent, operations: remoteTargetsOperations }])
  success(await invoke(t, setup, ['--json', 'init'], scriptedUI([ROOT_PASSWORD, ROOT_PASSWORD])))
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  setup.secrets.push(privateKey.trim(), 'BEGIN RSA PRIVATE KEY')
  const keyFile = join(setup.dataDirectory, '私钥=测试.pem')
  writeFileSync(keyFile, privateKey, 'utf8')
  const keySpec = JSON.stringify({
    resource: { kind: 'server', label: '文件私钥目标' },
    identity: { login: 'operator', auth: { method: 'private-key' } },
    access: { capabilities: ['exec'] },
    connectivity: {
      transport: 'ssh', via: 'direct', host: '192.0.2.50', port: 22, remoteShell: 'posix',
    },
  })
  const keyUI = scriptedUI([ROOT_PASSWORD])
  const registered = success(await invoke(t, setup, [
    '--json', 'put', 'rt://targets/key-file', '--data', JSON.stringify({ spec: keySpec }),
    '--field-file', `privateKey=${keyFile}`,
  ], keyUI)).data
  assert.equal(registered.id, 'key-file')
  assert.deepEqual(registered.identity.auth, { method: 'private-key' })
  assert.deepEqual(keyUI.prompts, ['Root 密码（授权 remote-targets:rt.target.register）：'])

  const passwordSpec = JSON.stringify({
    resource: { kind: 'server', label: 'TTY 密码目标' },
    identity: { login: 'operator', auth: { method: 'password' } },
    access: { capabilities: ['exec'] },
    connectivity: {
      transport: 'ssh', via: 'direct', host: '192.0.2.51', port: 22, remoteShell: 'posix',
    },
  })
  const passwordUI = scriptedUI([SECRET, ROOT_PASSWORD])
  const passwordTarget = success(await invoke(t, setup, [
    '--json', 'put', 'rt://targets/password-prompt', '--data', JSON.stringify({ spec: passwordSpec }),
    '--prompt', 'password',
  ], passwordUI)).data
  assert.equal(passwordTarget.id, 'password-prompt')
  assert.equal(passwordUI.prompts.length, 2)
  assert.match(passwordUI.prompts[0], /密码/)
  assert.equal(passwordUI.prompts[1], 'Root 密码（授权 remote-targets:rt.target.register）：')
  const credentials = success(await invoke(t, setup, [
    '--json', 'get', 'locus://credentials/remote-targets',
  ], scriptedUI([ROOT_PASSWORD]))).data
  assert.equal(credentials.credentials.length, 2)
  assert.deepEqual(credentials.bindings.map((binding) => binding.slot).sort(), ['ssh-password', 'ssh-private-key'])
  assert.equal(JSON.stringify(credentials).includes(SECRET), false)
  assert.equal(JSON.stringify(credentials).includes('BEGIN RSA PRIVATE KEY'), false)
  assert.equal(JSON.stringify(setup.core.events.list()).includes(SECRET), false)
  assert.equal(JSON.stringify(setup.core.events.list()).includes('BEGIN RSA PRIVATE KEY'), false)
  assert.equal(readFileSync(join(setup.dataDirectory, 'remote-targets', 'targets.yaml'), 'utf8').includes(privateKey.trim()), false)
})

test('安全 operation 的 GET、PUT Body 与 DELETE 改变授权等级', async (t) => {
  const setup = await fixture(t)
  await success(await invoke(t, setup, ['--json', 'init'], scriptedUI([ROOT_PASSWORD, ROOT_PASSWORD])))

  const listed = success(await invoke(t, setup, [
    '--json', 'get', 'locus://security/operations',
  ], scriptedUI([ROOT_PASSWORD]))).data
  const register = listed.find((item) => item.operation === 'pg.database.register')
  assert.equal(register.effectiveAuthLevel, 'root')

  const set = success(await invoke(
    t, setup, ['--json', 'put', 'locus://security/operations/postgres/pg.database.register', '--data', '{"level":"user"}'],
    scriptedUI([ROOT_PASSWORD]),
  )).data
  assert.equal(set.effectiveAuthLevel, 'user')
  assert.equal(set.source, 'override')

  const reset = success(await invoke(
    t, setup, ['--json', 'delete', 'locus://security/operations/postgres/pg.database.register'],
    scriptedUI([ROOT_PASSWORD]),
  )).data
  assert.equal(reset.effectiveAuthLevel, 'root')
  assert.equal(reset.source, 'operation')
})

test('shell 读取 Workspace 经过 Root 覆盖路由：非交互拒绝，交互授权后才输出含挂载的上下文', async (t) => {
  const setup = await fixture(t)
  success(await invoke(t, setup, ['--json', 'init'], scriptedUI([ROOT_PASSWORD, ROOT_PASSWORD])))
  const workspace = success(await invoke(t, setup, [
    '--json', 'post', 'locus://workspaces', '--data', '{"name":"受控 Shell"}',
  ], scriptedUI())).data
  const mount = success(await invoke(t, setup, [
    '--json', 'post', `locus://workspaces/${workspace.id}/mounts`, '--data',
    JSON.stringify({ path: setup.dataDirectory, name: 'data' }),
  ], scriptedUI())).data
  success(await invoke(t, setup, [
    '--json', 'put', 'locus://security/operations/locus/locus.workspaces.get', '--data', '{"level":"root"}',
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

test('密码变更 URL 先收集新 tty 字段再以旧 Root 认证，旧密码失效', async (t) => {
  const setup = await fixture(t)
  await success(await invoke(t, setup, ['--json', 'init'], scriptedUI([ROOT_PASSWORD, ROOT_PASSWORD])))
  const ui = scriptedUI([NEW_PASSWORD, NEW_PASSWORD, ROOT_PASSWORD])
  const changed = success(await invoke(t, setup, [
    '--json', 'post', 'locus://security/actions/change-root-password',
  ], ui)).data
  assert.deepEqual(changed, { changed: true })
  assert.equal(ui.prompts.length, 3)
  assert.match(ui.prompts[0], /密码/)
  assert.match(ui.prompts[1], /确认|再次/)
  assert.equal(ui.prompts[2], 'Root 密码（授权 locus:locus.security.change-root-password）：')

  const old = await invoke(t, setup, ['--json', 'get', 'locus://credentials'], scriptedUI([ROOT_PASSWORD]))
  assert.ok(old.error instanceof SecurityFailure)
  assert.equal(old.error.code, 'authentication-failed')
  const current = success(await invoke(t, setup, [
    '--json', 'get', 'locus://credentials',
  ], scriptedUI([NEW_PASSWORD]))).data
  assert.deepEqual(current, { credentials: [], bindings: [] })
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
  const old = await invoke(t, setup, ['--json', 'get', 'locus://credentials'], scriptedUI([ROOT_PASSWORD]))
  assert.ok(old.error instanceof SecurityFailure)
  assert.equal(old.error.code, 'authentication-failed')
  const current = success(await invoke(t, setup, [
    '--json', 'get', 'locus://credentials',
  ], scriptedUI([NEW_PASSWORD]))).data
  assert.deepEqual(current, { credentials: [], bindings: [] })
})

test('URL 动词输出信封；批量 GET 保留部分失败并按协议返回退出码', async (t) => {
  const setup = await fixture(t)
  const info = await invoke(t, setup, ['--json', 'get', 'locus://info'], scriptedUI())
  const payload = success(info)
  assert.equal(payload.ok, true)
  assert.equal(payload.data.version, '0.0.0')
  const bare = success(await invoke(t, setup, ['--json', 'locus://info'], scriptedUI()))
  assert.equal(bare.ok, true)
  assert.deepEqual(bare.data, payload.data)
  assert.equal(bare.uri, 'locus://info')
  assert.equal(typeof bare.requestId, 'string')

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

test('events URL query 按类型筛选请求事件', async (t) => {
  const setup = await fixture(t)
  await success(await invoke(t, setup, [
    '--json', 'post', 'locus://workspaces', '--data', '{"name":"事件"}',
  ], scriptedUI()))
  await success(await invoke(t, setup, ['--json', 'get', 'locus://info'], scriptedUI()))
  const events = success(await invoke(t, setup, [
    '--json', 'get', 'locus://events?type=locus.request.succeeded&limit=100',
  ], scriptedUI())).data
  assert.ok(events.length >= 1)
  assert.equal(events.every((event) => event.type === 'locus.request.succeeded'), true)
})

test('临时组件仅凭 operation 声明接入 URL 与帮助，帮助展示字段但不执行或落盘', async (t) => {
  const temporary = temporaryComponent()
  const setup = await fixture(t, [temporary.definition])
  const ui = scriptedUI()
  for (const args of [['--help'], ['help']]) {
    const help = await invoke(t, setup, args, ui)
    assert.ok(help.error === undefined || help.error.exitCode === 0, help.stderr)
    assert.doesNotMatch(help.stdout, /temporary\.read/)
    assert.doesNotMatch(help.stdout, /temporary\.write/)
    assert.equal(temporary.calls(), 0)
    assert.deepEqual(ui.prompts, [])
    assert.equal(existsSync(join(setup.dataDirectory, 'core.sqlite')), false)
  }
  for (const args of [
    ['help', 'temporary://'],
    ['help', 'temporary://items/new'],
  ]) {
    const help = await invoke(t, setup, args, ui)
    assert.ok(help.error === undefined || help.error.exitCode === 0, help.stderr)
    assert.match(help.stdout, /temporary\.read/)
    assert.match(help.stdout, /temporary\.write/)
    assert.match(help.stdout, /读取路径 id 指定的临时项目/)
    assert.match(help.stdout, /必需令牌/)
    assert.match(help.stdout, /可选令牌/)
    assert.equal(temporary.calls(), 0)
    assert.deepEqual(ui.prompts, [])
    assert.equal(existsSync(join(setup.dataDirectory, 'core.sqlite')), false)
    assert.equal(existsSync(join(setup.dataDirectory, 'components')), false)
  }

  const declared = success(await invoke(t, setup, [
    '--json', 'get', 'locus://operations',
  ], scriptedUI())).data
  const write = declared.find((operation) => operation.id === 'temporary.write')
  assert.match(write.summary, /Body 必填 label/)
  assert.deepEqual(write.fields.token, {
    description: '必需令牌', secret: true, tty: true, file: true, required: true,
  })
  const component = success(await invoke(t, setup, [
    '--json', 'get', 'locus://components/temporary',
  ], scriptedUI())).data
  assert.deepEqual(component.operations.find((operation) => operation.id === 'temporary.write').fields, write.fields)
  assert.equal(temporary.calls(), 0)

  const read = success(await invoke(t, setup, [
    '--json', 'get', 'temporary://items/new',
  ], scriptedUI()))
  assert.equal(read.ok, true)
  assert.equal(read.data, '临时项目：new')
  const bare = success(await invoke(t, setup, [
    '--json', 'temporary://items/bare',
  ], scriptedUI()))
  assert.equal(bare.ok, true)
  assert.equal(bare.data, '临时项目：bare')
  const human = await invoke(t, setup, [
    '--json', '--pretty', '--human', 'temporary://items/human',
  ], scriptedUI())
  assert.equal(human.error, undefined)
  assert.equal(human.stdout, '临时项目：human\n')
  assert.equal(temporary.calls(), 3)
})

test('field-file 保持 UTF-8 原文与多字段选择，optional tty 只在 prompt 选中时采集', async (t) => {
  const temporary = temporaryComponent()
  const setup = await fixture(t, [temporary.definition])
  const token = `${SECRET}\n中文末行\n`
  const extra = 'optional-secret-sentinel-不得输出'
  setup.secrets.push(extra)
  const tokenFile = join(setup.dataDirectory, '令牌=输入.txt')
  const extraFile = join(setup.dataDirectory, '额外输入.txt')
  writeFileSync(tokenFile, token, 'utf8')
  writeFileSync(extraFile, extra, 'utf8')
  const nonTTY = scriptedUI([], true, false)
  const first = success(await invoke(t, setup, [
    '--json', 'post', 'temporary://items/file', '--data', '{"label":"文件"}',
    '--field-file', `token=${tokenFile}`,
  ], nonTTY)).data
  assert.equal(first, `文件:${createHash('sha256').update(`${token}:`).digest('hex')}`)
  assert.deepEqual(nonTTY.prompts, [])

  const both = success(await invoke(t, setup, [
    '--json', 'post', 'temporary://items/files', '--data', '{"label":"双文件"}',
    '--field-file', `extra=${extraFile}`, '--field-file', `token=${tokenFile}`,
  ], scriptedUI([], true, false))).data
  assert.equal(both, `双文件:${createHash('sha256').update(`${token}:${extra}`).digest('hex')}`)

  const promptedUI = scriptedUI([extra])
  const prompted = success(await invoke(t, setup, [
    '--json', 'post', 'temporary://items/prompt', '--data', '{"label":"选择提示"}',
    '--field-file', `token=${tokenFile}`, '--prompt', 'extra',
  ], promptedUI)).data
  assert.equal(prompted, `选择提示:${createHash('sha256').update(`${token}:${extra}`).digest('hex')}`)
  assert.equal(promptedUI.prompts.length, 1)
  assert.match(promptedUI.prompts[0], /可选令牌/)

  const automaticUI = scriptedUI([token])
  const automatic = success(await invoke(t, setup, [
    '--json', 'post', 'temporary://items/required', '--data', '{"label":"必需提示"}',
  ], automaticUI)).data
  assert.equal(automatic, `必需提示:${createHash('sha256').update(`${token}:`).digest('hex')}`)
  assert.equal(automaticUI.prompts.length, 1)
  assert.match(automaticUI.prompts[0], /必需令牌/)
  assert.equal(temporary.calls(), 4)
  assert.equal(JSON.stringify(setup.core.events.list()).includes(SECRET), false)
  assert.equal(JSON.stringify(setup.core.events.list()).includes(extra), false)
  assert.equal(existsSync(join(setup.dataDirectory, 'core.sqlite')), false)
  assert.equal(Object.values(process.env).includes(token), false)
  assert.equal(Object.values(process.env).includes(extra), false)
})

test('未知、非 tty、重复或混合来源的 field-file 与 prompt 在输入前拒绝', async (t) => {
  const temporary = temporaryComponent()
  const setup = await fixture(t, [temporary.definition])
  const file = join(setup.dataDirectory, 'secret.txt')
  writeFileSync(file, SECRET, 'utf8')
  for (const options of [
    ['--field-file', `unknown=${file}`],
    ['--field-file', `label=${file}`],
    ['--field-file', `token=${file}`, '--field-file', `token=${file}`],
    ['--prompt', 'unknown'],
    ['--prompt', 'label'],
    ['--prompt', 'extra', '--prompt', 'extra'],
    ['--field-file', `token=${file}`, '--prompt', 'token'],
  ]) {
    const ui = scriptedUI()
    const rejected = await invoke(t, setup, [
      '--json', 'post', 'temporary://items/rejected', '--data', '{"label":"拒绝"}', ...options,
    ], ui)
    assert.equal(rejected.error?.exitCode, 1, rejected.stderr)
    assert.deepEqual(ui.prompts, [])
    assert.equal(rejected.stdout, '')
  }
  const body = await invoke(t, setup, [
    '--json', 'post', 'temporary://items/rejected', '--data',
    JSON.stringify({ label: '拒绝', token: SECRET }),
    '--field-file', `token=${file}`,
  ], scriptedUI())
  assert.equal(body.error?.exitCode, 1, body.stderr)
  assert.equal(body.stdout, '')
  assert.equal(temporary.calls(), 0)
  assert.equal(existsSync(join(setup.dataDirectory, 'core.sqlite')), false)
})

test('Root 密码与接管确认不接受 field-file 绕过可信本地 TTY', async (t) => {
  const setup = await fixture(t)
  const file = join(setup.dataDirectory, 'root.txt')
  writeFileSync(file, ROOT_PASSWORD, 'utf8')
  for (const [uri, field] of [
    ['locus://security/actions/init', 'password'],
    ['locus://security/actions/init', 'confirmation'],
    ['locus://security/actions/change-root-password', 'password'],
    ['locus://security/actions/reset-root', 'password'],
    ['locus://security/actions/reset-root', 'confirmation'],
    ['locus://security/actions/reset-root', 'confirm'],
  ]) {
    const ui = scriptedUI()
    const rejected = await invoke(t, setup, [
      '--json', 'post', uri, '--field-file', `${field}=${file}`,
    ], ui)
    assert.equal(rejected.error?.exitCode, 1, rejected.stderr)
    assert.equal(rejected.stdout, '')
    assert.deepEqual(ui.prompts, [])
  }
  assert.equal(existsSync(join(setup.dataDirectory, 'core.sqlite')), false)
})

test('field-file 只读取至多 1 MiB 的普通 UTF-8 文件', async (t) => {
  const temporary = temporaryComponent()
  const setup = await fixture(t, [temporary.definition])
  const maximum = join(setup.dataDirectory, 'maximum.txt')
  const oversized = join(setup.dataDirectory, 'oversized.txt')
  const invalidUTF8 = join(setup.dataDirectory, 'invalid-utf8.txt')
  writeFileSync(maximum, 'x'.repeat(1024 * 1024), 'utf8')
  writeFileSync(oversized, 'x'.repeat(1024 * 1024 + 1), 'utf8')
  writeFileSync(invalidUTF8, Buffer.from([0xc3, 0x28]))
  const accepted = success(await invoke(t, setup, [
    '--json', 'post', 'temporary://items/maximum', '--data', '{"label":"边界"}',
    '--field-file', `token=${maximum}`,
  ], scriptedUI([], true, false))).data
  assert.equal(accepted, `边界:${createHash('sha256').update(`${'x'.repeat(1024 * 1024)}:`).digest('hex')}`)
  for (const file of [oversized, invalidUTF8, setup.dataDirectory, join(setup.dataDirectory, 'missing.txt')]) {
    const ui = scriptedUI()
    const rejected = await invoke(t, setup, [
      '--json', 'post', 'temporary://items/rejected', '--data', '{"label":"拒绝"}',
      '--field-file', `token=${file}`,
    ], ui)
    assert.equal(rejected.error?.exitCode, 1, rejected.stderr)
    assert.equal(rejected.stdout, '')
    assert.deepEqual(ui.prompts, [])
  }
  assert.equal(temporary.calls(), 1)

  await t.test('符号链接不能作为可信文件', async (subtest) => {
    const linked = join(setup.dataDirectory, 'linked.txt')
    try {
      symlinkSync(maximum, linked, 'file')
    } catch (error) {
      subtest.skip(`当前环境不能创建符号链接：${error.message}`)
      return
    }
    const rejected = await invoke(subtest, setup, [
      '--json', 'post', 'temporary://items/linked', '--data', '{"label":"拒绝"}',
      '--field-file', `token=${linked}`,
    ], scriptedUI())
    assert.equal(rejected.error?.exitCode, 1, rejected.stderr)
    assert.equal(temporary.calls(), 1)
  })
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
