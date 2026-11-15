import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createLocusCore, createMemoryCredentialProvider, createMemorySecurityStore } from '@locus/core'
import { component as remoteTargetsComponent } from '../lib/index.js'
import { createProgram } from '../../../apps/cli/lib/commands.js'

const CLI = fileURLToPath(new URL('../../../apps/cli/lib/index.js', import.meta.url))
const ROOT_PASSWORD = 'Root-RemoteTargets-CLI-2026'
const LEGACY_SECRET = 'legacy-password-secret-不得输出'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-remote-target-cli-'))
  const data = join(root, 'data')
  const run = (args, options = {}) => {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      cwd: options.cwd ?? root,
      ...(options.input === undefined ? {} : { input: options.input }),
      env: { ...process.env, LOCUS_FOLDER_NAME: undefined, LOCUS_HOME: data },
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
    identity: { login: 'Administrator', auth: { method: 'private-key', credential: 'credential:test-key' } },
    connectivity: { via: 'frp', host: '127.0.0.1', port: 6001 },
  })
}

function passwordSpec(credential = 'credential:pw-target') {
  return JSON.stringify({
    resource: { kind: 'server' },
    identity: { login: 'root', auth: { method: 'password', credential } },
    connectivity: { host: '10.0.0.1', port: 22, trust: { fingerprint: 'SHA256:pw' } },
  })
}

function targetYaml(id) {
  return `  - id: ${id}
    resource:
      kind: windows-device
    identity:
      login: Administrator
      auth:
        method: private-key
        credential: credential:test-key
    connectivity:
      via: frp
      host: 127.0.0.1
      port: 6001
`
}

/** add 现在需要 Root 与秘密；不需要凭据的用例直接写目标配置。 */
function writeTargets(data, ids) {
  const root = join(data, 'remote-targets')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'targets.yaml'), `version: 1\ntargets:\n${ids.map(targetYaml).join('')}`, 'utf8')
}

const LEGACY_TARGETS = `version: 1
targets:
  - id: legacy
    resource:
      kind: server
    identity:
      login: root
      auth:
        method: password
        path: credentials/legacy/password
    connectivity:
      host: 127.0.0.1
      port: 22
`

/** 进程内可信 UI：秘密只由测试注入，不经过 argv、环境变量或 stdin。 */
function trustedUI(values) {
  const prompts = []
  let index = 0
  return {
    interactive: true,
    prompts,
    async readSecret(prompt) {
      prompts.push(prompt)
      if (index >= values.length) throw new Error('不应出现额外秘密输入')
      return values[index++]
    },
    async confirmLocalTakeover() {
      throw new Error('不应触发本机接管确认')
    },
  }
}

/** 与真实入口共用命令树；Host/UI 由组合根注入，不伪造 Root 身份。 */
async function invoke(core, args, options) {
  let stdout = ''
  let stderr = ''
  const program = createProgram(core, options)
  const configure = (command) => {
    command.exitOverride().configureOutput({
      writeOut(value) { stdout += value },
      writeErr(value) { stderr += value },
    })
    for (const child of command.commands) configure(child)
  }
  configure(program)
  try {
    await program.parseAsync(args, { from: 'user' })
    return { stdout, stderr }
  } catch (error) {
    return { stdout, stderr, error }
  }
}

function bindingNames(bindings) {
  return bindings.map((binding) => (
    `${binding.capability}:${binding.slot}:${binding.resource.type}/${binding.resource.id}:${binding.reference}`
  )).sort()
}

function bindingSnapshot(bindings) {
  return bindings.map((binding) => ({
    capability: binding.capability,
    slot: binding.slot,
    resource: binding.resource,
    reference: binding.reference,
    createdAt: binding.createdAt,
  })).sort((left, right) => left.capability.localeCompare(right.capability))
}

test('add --dry-run 校验 spec 且不落盘，list/show 输出稳定', (t) => {
  const f = fixture(t)
  const keyPath = join(f.root, 'user-key')
  const stdin = f.run(['remote-targets', 'add', 'win-x', '--spec', '-', '--file', keyPath, '--dry-run'], { input: spec() })
  assert.equal(stdin.code, 0)
  assert.match(stdin.stdout, /将登记目标 win-x/)
  assert.equal(existsSync(join(f.data, 'remote-targets', 'targets.yaml')), false)

  const file = join(f.root, 'target.json')
  writeFileSync(file, spec(), 'utf8')
  const fromFile = f.run(['rt', 'add', 'file-target', '--spec', file, '--file', keyPath, '--dry-run'])
  assert.equal(fromFile.code, 0)
  assert.match(fromFile.stdout, /将登记目标 file-target/)

  const secretless = f.run(['remote-targets', 'add', 'win-x', '--spec', '-', '--dry-run'], { input: spec() })
  assert.equal(secretless.code, 1)
  assert.equal(secretless.stdout, '')
  assert.equal(existsSync(join(f.data, 'remote-targets', 'targets.yaml')), false)

  writeTargets(f.data, ['win-x', 'file-target'])
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
  writeTargets(f.data, ['win-x'])

  const rejected = f.run(['remote-targets', 'remove', 'win-x'])
  assert.equal(rejected.code, 1)
  assert.equal(JSON.parse(f.run(['--json', 'remote-targets', 'list']).stdout).length, 1)

  const removed = f.run(['remote-targets', 'remove', 'win-x', '--yes'])
  assert.equal(removed.code, 0)
  assert.match(removed.stdout, /已移除目标 win-x/)
  assert.equal(JSON.parse(f.run(['--json', 'remote-targets', 'list']).stdout).length, 0)
})

test('未初始化安全身份时 exec 与 probe 在启动客户端前失败，JSON 错误含可判 code', (t) => {
  const f = fixture(t)
  writeTargets(f.data, ['win-x'])

  const gated = f.run(['remote-targets', 'exec', 'win-x', '--', 'whoami'])
  assert.equal(gated.code, 2)
  assert.equal(gated.stdout, '')

  for (const command of [['exec', 'win-x', '--', 'whoami'], ['probe', 'win-x']]) {
    const result = f.run(['--json', 'remote-targets', ...command])
    assert.equal(result.code, 2)
    assert.equal(JSON.parse(result.stdout).code, 'security-uninitialized')
  }
  assert.equal(existsSync(join(f.data, 'remote-targets', 'state.sqlite')), false)
})

test('add 经 Root 一次写入配置与密码凭据，update-credential 只更新秘密', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'locus-remote-target-credential-'))
  const data = join(root, 'data')
  const specFile = join(root, 'password-target.json')
  writeFileSync(specFile, passwordSpec(), 'utf8')

  let host
  const provider = createMemoryCredentialProvider()
  const core = createLocusCore({
    dataDirectory: data,
    components: [remoteTargetsComponent],
    security: { store: createMemorySecurityStore(), provider, receiveHost(value) { host = value } },
  })
  t.after(async () => {
    await core.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  await host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD)

  const addUI = trustedUI([ROOT_PASSWORD, 'password-one'])
  const added = await invoke(core, ['remote-targets', 'add', 'pw-target', '--spec', specFile], { host, ui: addUI })
  assert.equal(added.error, undefined, added.stderr)
  assert.match(added.stdout, /已登记目标 pw-target（配置与凭证）/)
  assert.equal(addUI.prompts.length, 2)
  assert.equal(addUI.prompts[0], 'Root 密码：')
  assert.match(addUI.prompts[1], /SSH 密码/)
  for (const output of [added.stdout, added.stderr]) {
    assert.equal(output.includes('password-one'), false)
    assert.equal(output.includes(ROOT_PASSWORD), false)
  }

  const targetsPath = join(data, 'remote-targets', 'targets.yaml')
  const config = readFileSync(targetsPath, 'utf8')
  assert.match(config, /id: pw-target/)
  assert.match(config, /credential:pw-target/)
  assert.equal(existsSync(join(data, 'remote-targets', 'credentials', 'pw-target')), true)

  const installation = await core.security.status()
  const key = { service: `locus:${installation.installationId}:production`, account: 'pw-target' }
  assert.deepEqual(JSON.parse(await provider.get(key)), { password: 'password-one' })

  const session = host.createSession('human')
  const management = host.forSession(session)
  const bindingsAfterAdd = await management.listBindings()
  const metadataAfterAdd = await management.listCredentials()
  host.endSession(session)
  assert.deepEqual(bindingNames(bindingsAfterAdd), [
    'password-access:ssh-password:remote-target/pw-target:credential:pw-target',
    'register-password:ssh-password:remote-target/pw-target:credential:pw-target',
  ])
  assert.equal(metadataAfterAdd.length, 1)
  assert.equal(metadataAfterAdd[0].reference, 'credential:pw-target')
  assert.deepEqual(Object.keys(metadataAfterAdd[0].fields), [])

  const updateUI = trustedUI([ROOT_PASSWORD, 'password-two'])
  const updated = await invoke(core, [
    '--json', 'remote-targets', 'update-credential', 'pw-target',
    '--credential', 'credential:pw-target', '--method', 'password',
  ], { host, ui: updateUI })
  assert.equal(updated.error, undefined, updated.stderr)
  assert.deepEqual(JSON.parse(updated.stdout), { target: 'pw-target', credential: 'credential:pw-target', method: 'password' })
  assert.equal(updateUI.prompts.length, 2)
  assert.equal(updated.stdout.includes('password-two'), false)
  assert.equal(updated.stderr.includes('password-two'), false)
  assert.equal(readFileSync(targetsPath, 'utf8'), config)
  assert.deepEqual(JSON.parse(await provider.get(key)), { password: 'password-two' })

  const after = host.createSession('human')
  const port = host.forSession(after)
  const bindingsAfterUpdate = await port.listBindings()
  const metadataAfterUpdate = await port.listCredentials()
  host.endSession(after)
  assert.deepEqual(bindingSnapshot(bindingsAfterUpdate), bindingSnapshot(bindingsAfterAdd))
  assert.equal(metadataAfterUpdate.length, 1)
  assert.equal(metadataAfterUpdate[0].reference, 'credential:pw-target')
  assert.deepEqual(Object.keys(metadataAfterUpdate[0].fields), [])
})

test('migrate 经真实 Root 授权登记密码、建立绑定并改写目标，秘密不进入输出', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'locus-remote-target-migrate-'))
  const data = join(root, 'data')
  const targetsRoot = join(data, 'remote-targets')
  const legacyPath = join(targetsRoot, 'credentials', 'legacy', 'password')
  mkdirSync(dirname(legacyPath), { recursive: true })
  writeFileSync(legacyPath, LEGACY_SECRET, 'utf8')
  writeFileSync(join(targetsRoot, 'targets.yaml'), LEGACY_TARGETS, 'utf8')

  let host
  const core = createLocusCore({
    dataDirectory: data,
    components: [remoteTargetsComponent],
    security: { store: createMemorySecurityStore(), provider: createMemoryCredentialProvider(), receiveHost(value) { host = value } },
  })
  t.after(async () => {
    await core.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  await host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD)

  const ui = trustedUI([ROOT_PASSWORD])
  const migrated = await invoke(core, ['--json', 'remote-targets', 'migrate', 'legacy', '--credential', 'credential:legacy-password', '--yes'], { host, ui })
  assert.equal(migrated.error, undefined, migrated.stderr)
  const payload = JSON.parse(migrated.stdout)
  assert.equal(payload.capability, 'register-password')
  assert.equal(payload.credential, 'credential:legacy-password')
  assert.equal(payload.target.identity.auth.method, 'password')
  assert.equal(payload.target.identity.auth.credential, 'credential:legacy-password')
  assert.equal(payload.target.identity.auth.path, undefined)
  assert.equal(ui.prompts.length, 1)
  assert.equal(migrated.stdout.includes(LEGACY_SECRET), false)
  assert.equal(migrated.stderr.includes(LEGACY_SECRET), false)
  assert.equal(readFileSync(legacyPath, 'utf8'), LEGACY_SECRET)

  const session = host.createSession('human')
  const management = host.forSession(session)
  const bindings = await management.listBindings()
  const credentials = await management.listCredentials()
  host.endSession(session)
  assert.deepEqual(bindingNames(bindings), [
    'password-access:ssh-password:remote-target/legacy:credential:legacy-password',
    'register-password:ssh-password:remote-target/legacy:credential:legacy-password',
  ])
  assert.equal(credentials.length, 1)
  assert.equal(credentials[0].reference, 'credential:legacy-password')
  assert.deepEqual(Object.keys(credentials[0].fields), [])

  const shown = await invoke(core, ['--json', 'remote-targets', 'show', 'legacy'], { host })
  assert.equal(shown.error, undefined, shown.stderr)
  assert.equal(JSON.parse(shown.stdout).identity.auth.credential, 'credential:legacy-password')
})
