import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  createLocusCore,
  createMemoryCredentialProvider,
  createMemorySecurityStore,
  SecurityFailure,
} from '../../../packages/core/lib/index.js'
import { component as postgresComponent } from '@locus/postgres'
import { component as remoteTargetsComponent } from '@locus/remote-targets'
import { createProgram } from '../lib/commands.js'
import { createCliSecurityHost, createTerminalSecurityUI } from '../lib/security-host.js'

const CLI = fileURLToPath(new URL('../lib/index.js', import.meta.url))
const ROOT_PASSWORD = 'Root-CLI隔离测试-2026'
const NEW_PASSWORD = 'Root-CLI替换测试-2026'
const SECRET = 'credential-CLI-sentinel-不得输出'
const PG_TARGET = ['--host', '127.0.0.1', '--database', 'example']

function pgRegisterArgs(resource, credential) {
  return ['pg', 'register', resource, ...PG_TARGET, '--username', 'tester', '--credential', credential]
}

function failure(code) {
  return (error) => {
    assert.ok(error instanceof SecurityFailure)
    assert.equal(error.code, code)
    return true
  }
}

function directory(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-cli-security-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

/** 子进程只运行无秘密交互的入口；密码仅由进程内可信 UI 注入。 */
function executable(t) {
  const root = directory(t)
  const data = join(root, 'data')
  return {
    root,
    data,
    run(args, environment = {}, input) {
      const result = spawnSync(process.execPath, [CLI, ...args], {
        cwd: root,
        encoding: 'utf8',
        timeout: 15_000,
        env: { ...process.env, LOCUS_FOLDER_NAME: undefined, LOCUS_HOME: data, ...environment },
        ...(input === undefined ? {} : { input }),
      })
      assert.equal(result.error, undefined)
      return { code: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() }
    },
  }
}

/** 显式内存 Provider/Store，测试绝不装配或访问真实 Keyring。 */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-cli-security-'))
  const store = createMemorySecurityStore()
  const memory = createMemoryCredentialProvider()
  const events = []
  const sessions = []
  const challenges = []
  const authentications = []
  const provider = {
    id: memory.id,
    get(key) { events.push('provider:get'); return memory.get(key) },
    set(key, value) { events.push('provider:set'); return memory.set(key, value) },
    delete(key) { events.push('provider:delete'); return memory.delete(key) },
    list(service) { events.push('provider:list'); return memory.list(service) },
    dispose() { return memory.dispose() },
  }
  let host
  const core = createLocusCore({
    dataDirectory: join(root, 'data'),
    components: [postgresComponent, remoteTargetsComponent],
    security: { store, provider, profile: 'development', receiveHost(value) { host = value } },
  })
  t.after(async () => {
    await core.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  function record(name, operation) {
    return async (...args) => {
      events.push(name)
      try {
        return await operation(...args)
      } catch (error) {
        if (error instanceof SecurityFailure && error.challenge !== undefined) challenges.push(error.challenge)
        throw error
      }
    }
  }
  const observedHost = {
    ...host,
    createSession(source) {
      const session = host.createSession(source)
      sessions.push(session)
      return session
    },
    bindComponent(session, definition) {
      events.push('request:bind')
      const port = host.bindComponent(session, definition)
      return {
        ...port,
        execute: record('request:execute', port.execute),
      }
    },
    forSession(session) {
      const port = host.forSession(session)
      return {
        ...port,
        execute: record('request:execute', port.execute),
        deleteCredential: record('request:delete', port.deleteCredential),
        changeRootPassword: record('request:change', port.changeRootPassword),
        credentialStatus: record('request:status', port.credentialStatus),
        cleanupCredentialOrphans: record('request:cleanup', port.cleanupCredentialOrphans),
        setCapabilityLevel: record('request:set-level', port.setCapabilityLevel),
        clearCapabilityLevel: record('request:clear-level', port.clearCapabilityLevel),
        unbindCredential: record('request:unbind', port.unbindCredential),
      }
    },
    authenticate(challenge, password, scope) {
      events.push('authenticate')
      authentications.push(scope)
      return host.authenticate(challenge, password, scope)
    },
    resume(grant) { events.push('resume'); return host.resume(grant) },
    cancelChallenge(challenge) { events.push('cancel'); return host.cancelChallenge(challenge) },
  }
  return {
    root, core, host, observedHost, store, provider, memory, events, sessions, challenges, authentications,
    initialize: () => host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD),
    key(reference) {
      const installation = store.transaction((transaction) => transaction.getInstallation())
      return { service: `locus:${installation.installationId}:development`, account: reference.slice('credential:'.length) }
    },
  }
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

async function invoke(t, setup, args, ui, withHost = true) {
  let stdout = ''
  let stderr = ''
  const program = createProgram(setup.core, {
    profile: 'development',
    ...(withHost ? { host: setup.observedHost } : {}),
    ...(ui === undefined ? {} : { ui }),
  })
  function configure(command) {
    command.exitOverride().configureOutput({ writeOut(value) { stdout += value }, writeErr(value) { stderr += value } })
    for (const child of command.commands) configure(child)
  }
  configure(program)
  let error
  try {
    await program.parseAsync(args, { from: 'user' })
  } catch (caught) {
    error = caught
  }
  assert.equal(stdout.includes(ROOT_PASSWORD), false)
  assert.equal(stdout.includes(NEW_PASSWORD), false)
  assert.equal(stdout.includes(SECRET), false)
  assert.equal(stderr.includes(SECRET), false)
  return { stdout, stderr, error }
}

function success(result) {
  assert.equal(result.error, undefined)
  assert.equal(result.stderr, '')
  return JSON.parse(result.stdout)
}

test('真实入口的安全帮助、version、未知命令与空 status 均保持惰性', (t) => {
  const f = executable(t)
  for (const args of [
    ['--help'],
    ['security', '--help'],
    ['credential', 'provider-status', '--help'],
    ['credential', 'cleanup', '--help'],
    ['security', 'capability', '--help'],
    ['--profile', 'development', 'version'],
  ]) {
    const result = f.run(args)
    assert.equal(result.code, 0, result.stderr)
    assert.equal(existsSync(f.data), false)
  }
  const unknown = f.run(['not-a-command'])
  assert.equal(unknown.code, 1)
  assert.equal(existsSync(f.data), false)
  for (const profile of ['production', 'development']) {
    const result = f.run(['--profile', profile, '--json', 'security', 'status'])
    assert.equal(result.code, 0, result.stderr)
    const status = JSON.parse(result.stdout)
    assert.equal(status.profile, profile)
    assert.equal(status.initialized, false)
    assert.equal('installationId' in status, false)
    assert.equal('verifier' in status, false)
    assert.equal(result.stderr, '')
    assert.equal(existsSync(f.data), false)
  }
})

test('真实非TTY写入明确失败，JSON stdout仅含安全code，不能用stdin或--yes跳过认证', (t) => {
  const f = executable(t)
  const operations = [
    ['init'],
    ['security', 'reset-root'],
    ['security', 'change-root-password'],
    ['credential', 'remove', 'credential:cli-test'],
    ['credential', 'cleanup'],
    ['security', 'capability', 'set', 'postgres:register', 'root'],
  ]
  for (const operation of operations) {
    const result = f.run(['--json', ...operation], {}, 'ignored non-secret stdin\n')
    assert.equal(result.code, 2)
    assert.deepEqual(JSON.parse(result.stdout), { code: 'authentication-unavailable' })
    assert.match(result.stderr, /\[authentication-unavailable\]/)
    assert.equal(existsSync(f.data), false)
  }
  const plain = f.run(['init'])
  assert.equal(plain.code, 2)
  assert.equal(plain.stdout, '')
  const bypass = f.run(['security', 'reset-root', '--yes'])
  assert.equal(bypass.code, 1)
  assert.equal(bypass.stdout, '')
  assert.equal(existsSync(f.data), false)
  const metadata = f.run(['--json', 'credential', 'list'])
  assert.equal(metadata.code, 2)
  assert.deepEqual(JSON.parse(metadata.stdout), { code: 'security-uninitialized' })
  assert.equal(existsSync(f.data), false)
})

test('真实Profile按原production目录隔离development，空status不初始化安装身份', (t) => {
  const f = executable(t)
  const environment = { LOCUS_HOME: 'relative-home', LOCUS_FOLDER_NAME: '.locus' }
  const production = f.run(['--json', 'workspace', 'create', 'production-only'], environment)
  assert.equal(production.code, 0, production.stderr)
  const base = join(f.root, 'relative-home', '.locus')
  assert.equal(existsSync(join(base, 'core.sqlite')), true)
  assert.equal(existsSync(join(base, 'profiles')), false)
  const emptyDevelopment = f.run(['--profile=development', '--json', 'security', 'status'], environment)
  assert.equal(emptyDevelopment.code, 0, emptyDevelopment.stderr)
  assert.equal(JSON.parse(emptyDevelopment.stdout).initialized, false)
  assert.equal(existsSync(join(base, 'profiles')), false)
  const development = f.run(['workspace', 'list', '--json', '--profile', 'development'], environment)
  assert.equal(development.code, 0, development.stderr)
  assert.deepEqual(JSON.parse(development.stdout), [])
  assert.equal(existsSync(join(base, 'profiles', 'development', 'core.sqlite')), true)
  const restored = f.run(['--json', 'workspace', 'list'], environment)
  assert.deepEqual(JSON.parse(restored.stdout).map((workspace) => workspace.name), ['production-only'])
  const status = f.run(['--json', 'security', 'status'], environment)
  assert.equal(status.code, 0, status.stderr)
  assert.equal(JSON.parse(status.stdout).initialized, false)
  assert.equal('installationId' in JSON.parse(status.stdout), false)
  assert.equal(existsSync(join(base, 'components')), false)
  const invalid = f.run(['--profile', 'unexpected', 'security', 'status'])
  assert.equal(invalid.code, 1)
  assert.equal(existsSync(f.data), false)
})

test('createProgram通过receiveHost闭包编排真实scrypt，初始化、登记元数据与删除不泄密', async (t) => {
  const f = fixture(t)
  const status = success(await invoke(t, f, ['--json', 'security', 'status'], undefined, false))
  assert.equal(status.initialized, false)
  const initUI = scriptedUI([ROOT_PASSWORD, ROOT_PASSWORD])
  assert.deepEqual(success(await invoke(t, f, ['--json', 'init'], initUI)), { initialized: true })
  assert.equal(initUI.prompts.length, 2)
  const root = f.store.transaction((transaction) => transaction.getRoot())
  assert.equal(root.verifier.algorithm, 'scrypt')
  assert.equal(root.verifier.N, 32768)
  assert.equal(JSON.stringify(root).includes(ROOT_PASSWORD), false)
  assert.equal(f.events.length, 0)

  const registerUI = scriptedUI([ROOT_PASSWORD, SECRET])
  const stored = success(await invoke(t, f, [
    '--json', ...pgRegisterArgs('local', 'credential:cli-test'),
  ], registerUI))
  assert.deepEqual(stored, { resource: 'local', credential: 'credential:cli-test', host: '127.0.0.1', database: 'example', registered: true })
  assert.deepEqual(registerUI.prompts, ['Root 密码（授权 postgres:register database/local）：', 'PostgreSQL 密码（隐藏输入）：'])
  assert.deepEqual(f.events, ['request:bind', 'request:execute', 'authenticate', 'resume', 'provider:set', 'provider:get'])
  assert.deepEqual(JSON.parse(await f.memory.get(f.key('credential:cli-test'))), { password: SECRET })
  assert.equal(f.sessions.every((session) => !session.active), true)

  const beforeList = [...f.events]
  const listed = success(await invoke(t, f, ['--json', 'credential', 'list'], scriptedUI([], true, false)))
  assert.equal(listed.length, 1)
  assert.equal(listed[0].reference, 'credential:cli-test')
  assert.equal(listed[0].providerId, f.memory.id)
  assert.deepEqual(listed[0].fields, { host: '127.0.0.1', database: 'example', username: 'tester' })
  assert.equal('kind' in listed[0], false)
  assert.equal('secret' in listed[0], false)
  assert.deepEqual(f.events, beforeList)

  const providerStatus = success(await invoke(t, f, ['--json', 'credential', 'provider-status'], scriptedUI([], true, false)))
  assert.equal(providerStatus.id, f.memory.id)
  assert.equal(providerStatus.state, 'unverified')
  assert.equal(f.events.length, beforeList.length)

  assert.deepEqual(
    success(await invoke(t, f, ['--json', 'credential', 'remove', 'credential:cli-test'], scriptedUI([ROOT_PASSWORD]))),
    { reference: 'credential:cli-test', removed: true },
  )
  assert.equal(await f.memory.get(f.key('credential:cli-test')), undefined)
  assert.deepEqual(success(await invoke(t, f, ['--json', 'credential', 'list'], scriptedUI([], true, false))), [])
  assert.equal(Object.values(process.env).includes(ROOT_PASSWORD), false)
  assert.equal(Object.values(process.env).includes(SECRET), false)
})

test('初始化拒绝不一致、重复与取消；非交互UI不被调用', async (t) => {
  const f = fixture(t)
  const mismatched = await invoke(t, f, ['init'], scriptedUI([ROOT_PASSWORD, NEW_PASSWORD]))
  failure('authentication-failed')(mismatched.error)
  assert.equal((await f.core.security.status()).initialized, false)
  const cancelled = await invoke(t, f, ['init'], scriptedUI([new SecurityFailure('authentication-cancelled')]))
  failure('authentication-cancelled')(cancelled.error)
  assert.equal((await f.core.security.status()).initialized, false)
  const unavailable = scriptedUI([], true, false)
  failure('authentication-unavailable')((await invoke(t, f, ['init'], unavailable)).error)
  assert.equal(unavailable.prompts.length, 0)
  await f.initialize()
  const original = f.store.transaction((transaction) => transaction.getRoot())
  failure('security-already-initialized')((await invoke(t, f, ['init'], scriptedUI([NEW_PASSWORD, NEW_PASSWORD]))).error)
  assert.deepEqual(f.store.transaction((transaction) => transaction.getRoot()), original)
})

test('Root认证取消和错误均不执行写删，取消挑战且结束会话', async (t) => {
  const f = fixture(t)
  await f.initialize()
  const result = await invoke(t, f, ['credential', 'remove', 'credential:cancelled'], scriptedUI([new SecurityFailure('authentication-cancelled')]))
  failure('authentication-cancelled')(result.error)
  assert.equal(result.stdout, '')
  assert.deepEqual(f.events, ['request:delete', 'cancel'])
  assert.equal(f.store.transaction((transaction) => transaction.getRoot()).failedAttempts, 0)
  assert.equal(f.sessions[0].active, false)
  await assert.rejects(() => f.host.authenticate(f.challenges[0], ROOT_PASSWORD), failure('authentication-cancelled'))
  const wrong = await invoke(t, f, ['credential', 'remove', 'credential:cancelled'], scriptedUI(['wrong-test-password']))
  failure('authentication-failed')(wrong.error)
  assert.equal(f.events.includes('provider:delete'), false)
  assert.equal(f.store.transaction((transaction) => transaction.getRoot()).failedAttempts, 1)
  assert.equal(f.sessions.every((session) => !session.active), true)
})

test('change-root-password只恢复原密码变更，必须以旧Root认证，后续写入改用新密码', async (t) => {
  const f = fixture(t)
  await f.initialize()
  const original = f.store.transaction((transaction) => transaction.getRoot())
  const rejected = await invoke(t, f, ['security', 'change-root-password'], scriptedUI([NEW_PASSWORD, NEW_PASSWORD, 'wrong-test-password']))
  failure('authentication-failed')(rejected.error)
  assert.deepEqual(f.store.transaction((transaction) => transaction.getRoot()).verifier, original.verifier)
  const changed = await invoke(t, f, ['--json', 'security', 'change-root-password'], scriptedUI([NEW_PASSWORD, NEW_PASSWORD, ROOT_PASSWORD]))
  assert.deepEqual(success(changed), { changed: true })
  assert.equal(f.store.transaction((transaction) => transaction.getRoot()).generation, original.generation + 1)
  const old = await invoke(t, f, ['credential', 'remove', 'credential:absent'], scriptedUI([ROOT_PASSWORD]))
  failure('authentication-failed')(old.error)
  assert.equal(f.events.includes('provider:delete'), false)
  success(await invoke(t, f, [
    '--json', ...pgRegisterArgs('local', 'credential:new-root'),
  ], scriptedUI([NEW_PASSWORD, SECRET])))
  assert.deepEqual(JSON.parse(await f.memory.get(f.key('credential:new-root'))), { password: SECRET })
})

test('reset-root必须明确确认本机接管，保留Workspace/凭据并使既有Grant失效', async (t) => {
  const f = fixture(t)
  await f.initialize()
  success(await invoke(t, f, [
    '--json', ...pgRegisterArgs('local', 'credential:retained'),
  ], scriptedUI([ROOT_PASSWORD, SECRET])))
  const workspace = f.core.workspaces.create('重置后仍保留')
  const session = f.host.createSession('human')
  let challenge
  await assert.rejects(() => f.host.forSession(session).deleteCredential('credential:retained'), (error) => {
    failure('authentication-required')(error)
    challenge = error.challenge
    return true
  })
  const grant = await f.host.authenticate(challenge, ROOT_PASSWORD)
  const generation = f.store.transaction((transaction) => transaction.getRoot()).generation
  const declined = scriptedUI([], false)
  failure('authentication-cancelled')((await invoke(t, f, ['security', 'reset-root'], declined)).error)
  assert.equal(declined.prompts.length, 0)
  assert.match(declined.warnings[0], /本机管理接管/)
  assert.match(declined.warnings[0], /Workspace/)
  assert.match(declined.warnings[0], /资源凭据/)
  assert.match(declined.warnings[0], /同一 OS 用户/)
  assert.equal(f.store.transaction((transaction) => transaction.getRoot()).generation, generation)
  const confirmed = scriptedUI([NEW_PASSWORD, NEW_PASSWORD])
  assert.deepEqual(success(await invoke(t, f, ['--json', 'security', 'reset-root'], confirmed)), { reset: true })
  assert.equal(confirmed.prompts.length, 2)
  const root = f.store.transaction((transaction) => transaction.getRoot())
  assert.equal(root.generation, generation + 1)
  assert.equal(root.failedAttempts, 0)
  assert.equal(root.lockedUntil, undefined)
  assert.equal(f.core.workspaces.list()[0].id, workspace.id)
  assert.deepEqual(JSON.parse(await f.memory.get(f.key('credential:retained'))), { password: SECRET })
  await assert.rejects(() => f.host.resume(grant), failure('grant-revoked'))
  success(await invoke(t, f, ['--json', 'credential', 'remove', 'credential:retained'], scriptedUI([NEW_PASSWORD])))
  f.host.endSession(session)
})

test('命令参数先验证ref与capability且不提供秘密导出或reset --yes；Core回读失败不报成功', async (t) => {
  const f = fixture(t)
  await f.initialize()
  for (const args of [
    ['credential', 'remove'],
    ['security', 'reset-root', '--yes'],
    ['security', 'capability', 'set', 'postgres', 'user'],
    ['security', 'capability', 'set', 'postgres:register'],
    ['security', 'capability', 'set', 'postgres:register', 'admin'],
    ['pg', 'register', 'local'],
    ['pg', 'register', 'local', '--username', 'tester', '--credential', 'not-a-ref'],
    ['credential', 'get', 'credential:cli-test'],
  ]) {
    const result = await invoke(t, f, args, scriptedUI([]))
    assert.equal(result.error.exitCode, 1)
    assert.equal(result.stdout, '')
  }
  failure('access-denied')((await invoke(t, f, ['credential', 'remove', 'credential:INVALID'], scriptedUI([]))).error)
  assert.equal(f.events.length, 0)
  f.provider.get = async () => 'different-test-readback'
  const result = await invoke(t, f, [
    '--json', ...pgRegisterArgs('local', 'credential:unverified'),
  ], scriptedUI([ROOT_PASSWORD, SECRET]))
  failure('provider-unavailable')(result.error)
  assert.equal(result.stdout, '')
  assert.deepEqual(f.store.transaction((transaction) => transaction.listCredentials('development')), [])
  assert.deepEqual(f.store.transaction((transaction) => transaction.listBindings('development')), [])
})

test('pg register 建立共享槽绑定，credential list/bindings/status 只输出公开字段', async (t) => {
  const f = fixture(t)
  await f.initialize()
  const missing = await invoke(t, f, [
    '--json', 'pg', 'list', 'local',
  ], scriptedUI([], true, false))
  assert.equal(missing.error.code, 'access-denied')
  assert.equal(missing.error.reason, 'credential-binding-mismatch')
  assert.deepEqual(success(await invoke(t, f, [
    '--json', ...pgRegisterArgs('local', 'credential:postgres-local'),
  ], scriptedUI([ROOT_PASSWORD, SECRET]))), {
    resource: 'local', credential: 'credential:postgres-local', host: '127.0.0.1', database: 'example', registered: true,
  })
  const listed = success(await invoke(t, f, ['--json', 'credential', 'list'], scriptedUI([], true, false)))
  assert.equal(listed.length, 1)
  assert.deepEqual(listed[0].fields, { host: '127.0.0.1', database: 'example', username: 'tester' })
  assert.equal('kind' in listed[0], false)
  const bindings = success(await invoke(t, f, ['--json', 'credential', 'bindings'], scriptedUI([], true, false)))
  assert.deepEqual(bindings.map((item) => `${item.componentId}:${item.capability}`), ['postgres:list', 'postgres:register'])
  assert.deepEqual(bindings.map((item) => item.slot), ['database-auth', 'database-auth'])
  assert.deepEqual(bindings[0].resource, { type: 'database', id: 'local' })
  assert.equal(bindings.every((item) => item.reference === 'credential:postgres-local'), true)
  const status = success(await invoke(t, f, ['--json', 'credential', 'status', 'credential:postgres-local'], scriptedUI([ROOT_PASSWORD])))
  assert.equal(status.present, true)
  assert.deepEqual(status.metadata.fields, { host: '127.0.0.1', database: 'example', username: 'tester' })
  assert.equal('kind' in status.metadata, false)
  assert.deepEqual(
    success(await invoke(t, f, ['--json', 'credential', 'remove', 'credential:postgres-local'], scriptedUI([ROOT_PASSWORD]))),
    { reference: 'credential:postgres-local', removed: true },
  )
  assert.deepEqual(success(await invoke(t, f, ['--json', 'credential', 'bindings'], scriptedUI([], true, false))), [])
  assert.deepEqual(success(await invoke(t, f, ['--json', 'credential', 'list'], scriptedUI([], true, false))), [])
})

test('CLI 将 grant-scope 传给可信 Host，默认 operation', async (t) => {
  const f = fixture(t)
  await f.initialize()
  success(await invoke(t, f, [
    '--grant-scope', 'session', '--json', ...pgRegisterArgs('local', 'credential:session-scope'),
  ], scriptedUI([ROOT_PASSWORD, SECRET])))
  assert.equal(f.authentications.at(-1), 'session')
  success(await invoke(t, f, [
    '--json', ...pgRegisterArgs('local', 'credential:operation-scope'),
  ], scriptedUI([ROOT_PASSWORD, SECRET])))
  assert.equal(f.authentications.at(-1), 'operation')
})

test('credential cleanup 只删除当前 service 的孤立条目，--yes 才执行', async (t) => {
  const f = fixture(t)
  await f.initialize()
  success(await invoke(t, f, [
    '--json', ...pgRegisterArgs('local', 'credential:known'),
  ], scriptedUI([ROOT_PASSWORD, SECRET])))
  const key = f.key('credential:known')
  await f.memory.set({ service: key.service, account: 'orphan-cli' }, 'orphan-secret')
  const audit = success(await invoke(t, f, ['--json', 'credential', 'cleanup'], scriptedUI([ROOT_PASSWORD])))
  assert.equal(audit.service, key.service)
  assert.deepEqual(audit.orphans, ['orphan-cli'])
  assert.equal(audit.removed, 0)
  assert.equal(await f.memory.get({ service: key.service, account: 'orphan-cli' }), 'orphan-secret')
  const cleaned = success(await invoke(t, f, ['--json', 'credential', 'cleanup', '--yes'], scriptedUI([ROOT_PASSWORD])))
  assert.equal(cleaned.removed, 1)
  assert.equal(cleaned.remaining, 0)
  assert.equal(await f.memory.get({ service: key.service, account: 'orphan-cli' }), undefined)
  assert.equal(await f.memory.get(key), JSON.stringify({ password: SECRET }))
  assert.equal((await f.store.transaction((transaction) => transaction.listCredentials('development'))).length, 1)
})

test('security capability list/set/reset 管理默认与Root覆盖等级', async (t) => {
  const f = fixture(t)
  await f.initialize()
  const listed = success(await invoke(t, f, ['--json', 'security', 'capability', 'list'], scriptedUI([], true, false)))
  const authorities = new Map(listed.map((item) => [`${item.componentId}:${item.capability}`, item]))
  assert.deepEqual(authorities.get('postgres:register'), {
    componentId: 'postgres', capability: 'register', defaultAuthLevel: 'root', effectiveAuthLevel: 'root', source: 'component',
  })
  assert.deepEqual(authorities.get('postgres:list'), {
    componentId: 'postgres', capability: 'list', defaultAuthLevel: 'user', effectiveAuthLevel: 'user', source: 'component',
  })
  assert.equal(authorities.get('remote-targets:private-key-access').effectiveAuthLevel, 'user')
  assert.deepEqual(
    success(await invoke(t, f, [
      '--json', 'security', 'capability', 'set', 'postgres:register', 'user',
    ], scriptedUI([ROOT_PASSWORD]))),
    { componentId: 'postgres', capability: 'register', defaultAuthLevel: 'root', effectiveAuthLevel: 'user', source: 'override' },
  )
  const userUI = scriptedUI([SECRET])
  success(await invoke(t, f, [
    '--json', ...pgRegisterArgs('local', 'credential:override'),
  ], userUI))
  assert.deepEqual(userUI.prompts, ['PostgreSQL 密码（隐藏输入）：'])
  assert.deepEqual(
    success(await invoke(t, f, ['--json', 'security', 'capability', 'reset', 'postgres:register'], scriptedUI([ROOT_PASSWORD]))),
    { componentId: 'postgres', capability: 'register', defaultAuthLevel: 'root', effectiveAuthLevel: 'root', source: 'component' },
  )
  const rootUI = scriptedUI([ROOT_PASSWORD, SECRET])
  success(await invoke(t, f, [
    '--json', ...pgRegisterArgs('local', 'credential:override-2'),
  ], rootUI))
  assert.deepEqual(rootUI.prompts, ['Root 密码（授权 postgres:register database/local）：', 'PostgreSQL 密码（隐藏输入）：'])
})

test('remote-targets migrate 显式导入旧私钥、回读后改写配置且保留原文件', async (t) => {
  const f = fixture(t)
  await f.initialize()
  const key = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey
  const targetRoot = join(f.core.dataDirectory, 'remote-targets')
  const credentialFile = join(targetRoot, 'credentials', 'legacy', 'id_ed25519')
  mkdirSync(join(targetRoot, 'credentials', 'legacy'), { recursive: true })
  writeFileSync(credentialFile, key, 'utf8')
  writeFileSync(join(targetRoot, 'targets.yaml'), `version: 1
targets:
  - id: legacy
    resource:
      kind: server
    identity:
      login: root
      auth:
        method: key
        path: credentials/legacy/id_ed25519
    access:
      capabilities: [exec, shell]
    connectivity:
      transport: ssh
      via: direct
      host: 127.0.0.1
      port: 22
      remoteShell: posix
`, 'utf8')
  const result = success(await invoke(t, f, [
    '--json', 'remote-targets', 'migrate', 'legacy', '--credential', 'credential:legacy-key', '--yes',
  ], scriptedUI([ROOT_PASSWORD])))
  assert.equal(result.target.id, 'legacy')
  assert.equal(result.target.identity.auth.method, 'private-key')
  assert.equal(result.target.identity.auth.credential, 'credential:legacy-key')
  assert.equal(result.credential, 'credential:legacy-key')
  assert.equal(result.capability, 'register-private-key')
  assert.equal(readFileSync(credentialFile, 'utf8'), key)
  assert.match(readFileSync(join(targetRoot, 'targets.yaml'), 'utf8'), /credential: credential:legacy-key/)
  assert.deepEqual(JSON.parse(await f.memory.get(f.key('credential:legacy-key'))), { privateKey: key })
  assert.equal(JSON.stringify(result).includes(key), false)
  const bindings = success(await invoke(t, f, ['--json', 'credential', 'bindings'], scriptedUI([], true, false)))
  assert.deepEqual(
    bindings.map((item) => `${item.componentId}:${item.capability}`),
    ['remote-targets:private-key-access', 'remote-targets:register-private-key'],
  )
  assert.deepEqual(bindings.map((item) => item.slot), ['ssh-private-key', 'ssh-private-key'])
  assert.deepEqual(bindings[0].resource, { type: 'remote-target', id: 'legacy' })
})

test('带口令私钥迁移明确阻塞，不自动去口令也不改写配置', async (t) => {
  const f = fixture(t)
  await f.initialize()
  const encrypted = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'isolated-passphrase' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey
  const targetRoot = join(f.core.dataDirectory, 'remote-targets')
  const credentialFile = join(targetRoot, 'credentials', 'legacy', 'id_ed25519')
  mkdirSync(join(targetRoot, 'credentials', 'legacy'), { recursive: true })
  writeFileSync(credentialFile, encrypted, 'utf8')
  const before = `version: 1
targets:
  - id: legacy
    resource:
      kind: server
    identity:
      login: root
      auth:
        method: key
        path: credentials/legacy/id_ed25519
    access:
      capabilities: [exec, shell]
    connectivity:
      transport: ssh
      via: direct
      host: 127.0.0.1
      port: 22
      remoteShell: posix
`
  writeFileSync(join(targetRoot, 'targets.yaml'), before, 'utf8')
  const result = await invoke(t, f, [
    '--json', 'remote-targets', 'migrate', 'legacy', '--credential', 'credential:legacy-key', '--yes',
  ], scriptedUI([ROOT_PASSWORD]))
  assert.equal(result.error?.name, 'RemoteTargetsFailure')
  assert.equal(result.error?.code, 'encrypted-key-unsupported')
  assert.equal(result.stdout, '')
  assert.equal(readFileSync(join(targetRoot, 'targets.yaml'), 'utf8'), before)
  assert.equal(await f.memory.get(f.key('credential:legacy-key')), undefined)
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

test('非TTY Host写入不调用UI或创建Session，元数据读取仍可供非交互使用', async (t) => {
  const f = fixture(t)
  await f.initialize()
  const ui = scriptedUI([], true, false)
  const commands = createCliSecurityHost(f.observedHost, ui)
  for (const action of [
    () => commands.initializeRoot(),
    () => commands.resetRoot(),
    () => commands.changeRootPassword(),
    () => commands.removeCredential('credential:blocked'),
    () => commands.credentialStatus('credential:blocked'),
    () => commands.cleanupCredentialOrphans(false),
    () => commands.setCapabilityLevel({ componentId: 'postgres', capability: 'register', level: 'user' }),
    () => commands.clearCapabilityLevel({ componentId: 'postgres', capability: 'register' }),
    () => commands.unbindCredential('postgres', 'register', { type: 'database', id: 'local' }, 'database-auth'),
  ]) await assert.rejects(action, failure('authentication-unavailable'))
  assert.equal(f.sessions.length, 0)
  assert.equal(ui.prompts.length, 0)
  assert.equal(ui.warnings.length, 0)
  assert.deepEqual(await commands.listCredentials(), [])
  assert.equal(f.sessions.length, 1)
  assert.equal(f.sessions[0].active, false)
  assert.equal(f.events.length, 0)
})
