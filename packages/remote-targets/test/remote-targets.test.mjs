import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { createRemoteTargetsService, RemoteTargetsFailure } from '../lib/index.js'
import {
  buildSshInvocation,
  createProcessRunner,
  joinRemoteCommand,
  quoteCmd,
  quotePosix,
} from '../lib/ssh.js'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-remote-target-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function writeLegacyCredential(root, relative) {
  const path = join(root, ...relative.split('/'))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, 'placeholder', 'utf8')
  return path
}

function spec(connectivity = {}, overrides = {}) {
  return {
    resource: { kind: 'windows-device' },
    identity: { login: 'Administrator', auth: { method: 'private-key', credential: 'credential:test-key' } },
    connectivity: { via: 'frp', host: '127.0.0.1', port: 6001, ...connectivity },
    ...overrides,
  }
}

function passwordSpec(connectivity = {}) {
  return spec(
    { client: 'plink.exe', host: '10.0.0.1', port: 22, trust: { fingerprint: 'SHA256:abc' }, ...connectivity },
    {
      identity: { login: 'root', auth: { method: 'password', credential: 'credential:test-password' } },
      resource: { kind: 'server' },
    },
  )
}

function fakeRunner(result = { exitCode: 0, stdout: 'whoami-ok', stderr: '' }) {
  const calls = []
  return {
    calls,
    async run(command, args, options) {
      calls.push({ command, args, options })
      return result
    },
    async interactive(command, args) {
      calls.push({ command, args })
      return 0
    },
  }
}

/** 模拟 Core 注入的 RemoteSecurity：记录精确目标、slot 与操作，再交付合并后的字段。 */
function approved(overrides = {}) {
  const calls = []
  return {
    calls,
    async withCredential(targetId, slot, credential, operation, consume) {
      calls.push({ targetId, slot, credential, operation })
      if (credential === 'credential:missing') throw new RemoteTargetsFailure('credential-missing', '测试用缺失凭据')
      const defaults = slot === 'ssh-password' ? { password: 'password-value' } : { privateKey: 'key-value' }
      return consume({ ...defaults, ...overrides })
    },
  }
}

function expectCode(code) {
  return (error) => error instanceof RemoteTargetsFailure && error.code === code
}

const LEGACY_TARGET = `version: 1
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

test('登记、列举、按前缀查看与移除目标，默认值可预测', (t) => {
  const root = fixture(t)
  const service = createRemoteTargetsService({ root })

  const added = service.add('win-x', spec())
  assert.equal(added.id, 'win-x')
  assert.equal(added.identity.auth.credential, 'credential:test-key')
  assert.equal('path' in added.identity.auth, false)
  assert.equal(added.connectivity.remoteShell, 'cmd')
  assert.deepEqual(added.access.capabilities, ['exec', 'shell'])
  assert.equal(existsSync(join(root, 'targets.yaml')), true)
  assert.equal(existsSync(join(root, 'credentials', 'win-x')), true)
  assert.equal(existsSync(join(root, 'credentials', 'win-x', 'id_ed25519')), false)

  assert.equal(service.list().length, 1)
  assert.equal(service.show('win').id, 'win-x')
  assert.throws(() => service.add('win-x', spec()), expectCode('target-exists'))

  service.remove('win')
  assert.equal(service.list().length, 0)
  assert.throws(() => service.show('win-x'), expectCode('target-not-found'))
  service.dispose()
})

test('拒绝未知字段、非法引用与 id 不一致，dry-run 不落盘', (t) => {
  const root = fixture(t)
  const service = createRemoteTargetsService({ root })

  assert.throws(() => service.add('bad', { ...spec(), extra: true }), expectCode('invalid-spec'))
  assert.throws(() => service.add('bad', spec({}, {
    identity: { login: 'root', auth: { method: 'private-key', credential: '/etc/key' } },
  })), expectCode('invalid-spec'))
  assert.throws(() => service.add('bad', spec({}, {
    identity: { login: 'root', auth: { method: 'private-key', credential: 'credential:test-key', path: '../key' } },
  })), expectCode('invalid-spec'))
  assert.throws(() => service.add('bad', spec({}, { id: 'other' })), expectCode('invalid-spec'))
  assert.throws(() => service.add('legacy', spec({}, {
    identity: { login: 'root', auth: { method: 'key', path: 'id_ed25519' } },
  })), expectCode('migration-required'))

  const dry = service.add('dry', spec(), { dryRun: true })
  assert.equal(dry.id, 'dry')
  assert.equal(service.list().length, 0)
  assert.equal(existsSync(join(root, 'targets.yaml')), false)
  assert.equal(existsSync(join(root, 'credentials', 'dry')), false)
  service.dispose()
})

test('引号与远端命令拼接区分 POSIX 与 cmd', () => {
  assert.equal(quotePosix("a'b"), `'a'\\''b'`)
  assert.equal(quotePosix('whoami'), `'whoami'`)
  assert.equal(joinRemoteCommand(['whoami', 'a b'], 'posix'), `'whoami' 'a b'`)
  assert.equal(quoteCmd('whoami'), 'whoami')
  assert.equal(quoteCmd('a b'), '"a b"')
  assert.equal(joinRemoteCommand(['whoami', 'a b'], 'cmd'), 'whoami "a b"')
})

test('命令执行器返回输出、退出码与超时', async () => {
  const runner = createProcessRunner()
  const ok = await runner.run(process.execPath, ['-e', 'console.log("ok")'])
  assert.equal(ok.exitCode, 0)
  assert.equal(ok.stdout, 'ok\n')

  const failed = await runner.run(process.execPath, ['-e', 'process.stderr.write("bad");process.exit(7)'])
  assert.equal(failed.exitCode, 7)
  assert.equal(failed.stderr, 'bad')

  const timed = await runner.run(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 100 })
  assert.equal(timed.exitCode, 124)
  assert.match(timed.stderr, /命令超时/)
})

test('密钥认证使用 OpenSSH 参数，显式 known_hosts 开启严格校验', (t) => {
  const root = fixture(t)
  const service = createRemoteTargetsService({ root })
  const target = service.add('win-x', spec())
  const path = join(root, 'temp-key')

  const invocation = buildSshInvocation(target, root, ['whoami'], path)
  assert.equal(invocation.command, 'ssh')
  assert.deepEqual(invocation.args.slice(0, 6), ['-p', '6001', '-l', 'Administrator', '-i', path])
  assert.ok(invocation.args.includes('IdentitiesOnly=yes'))
  assert.ok(invocation.args.includes('IdentityAgent=none'))
  assert.ok(invocation.args.includes('StrictHostKeyChecking=accept-new'))
  assert.equal(invocation.args.at(-1), 'whoami')

  const strict = service.add('strict', spec({ trust: { knownHosts: 'credentials/strict/known_hosts' } }))
  const strictInvocation = buildSshInvocation(strict, root, [], path)
  assert.ok(strictInvocation.args.includes('StrictHostKeyChecking=yes'))
  assert.equal(strictInvocation.args.at(-1), '127.0.0.1')
  service.dispose()
})

test('密码认证使用 Plink，缺少主机指纹时拒绝', (t) => {
  const root = fixture(t)
  const service = createRemoteTargetsService({ root })
  const target = service.add('dev', passwordSpec())
  const path = join(root, 'temp-password')

  const invocation = buildSshInvocation(target, root, ['uname', '-a'], path)
  assert.equal(invocation.command, 'plink.exe')
  assert.ok(invocation.args.includes('-pwfile'))
  assert.ok(invocation.args.includes('SHA256:abc'))
  assert.equal(invocation.args.at(-1), `'uname' '-a'`)

  const unsafe = service.add('unsafe', passwordSpec({ host: '10.0.0.2', trust: undefined }))
  assert.throws(() => buildSshInvocation(unsafe, root, ['whoami'], path), expectCode('invalid-spec'))
  service.dispose()
})

test('exec 通过 Core 交付临时凭据并在结束后清理，退出码与输出原样返回', async (t) => {
  const root = fixture(t)
  const runner = fakeRunner({ exitCode: 7, stdout: 'out', stderr: 'err' })
  const security = approved()
  const service = createRemoteTargetsService({ root, runner, security })
  service.add('win-x', spec())

  const result = await service.exec('win-x', ['whoami'])
  assert.deepEqual(result, { targetId: 'win-x', exitCode: 7, stdout: 'out', stderr: 'err' })
  assert.deepEqual(security.calls, [{
    targetId: 'win-x',
    slot: 'ssh-private-key',
    credential: 'credential:test-key',
    operation: { operation: 'exec', command: ['whoami'] },
  }])
  assert.equal(runner.calls.length, 1)
  assert.equal(runner.calls[0].args.at(-1), 'whoami')
  const credentialPath = runner.calls[0].args[runner.calls[0].args.indexOf('-i') + 1]
  assert.equal(existsSync(credentialPath), false)

  service.add('shell-only', spec({}, { access: { capabilities: ['shell'] } }))
  await assert.rejects(() => service.exec('shell-only', ['whoami']), expectCode('capability-unsupported'))
  await assert.rejects(() => service.exec('win-x', []), expectCode('invalid-spec'))
  service.dispose()
})

test('密码槽交付 password 字段，临时文件在结束后清理', async (t) => {
  const root = fixture(t)
  const runner = fakeRunner({ exitCode: 0, stdout: 'Linux', stderr: '' })
  const security = approved()
  const service = createRemoteTargetsService({ root, runner, security })
  service.add('pw', passwordSpec())

  const result = await service.exec('pw', ['uname'])
  assert.deepEqual(result, { targetId: 'pw', exitCode: 0, stdout: 'Linux', stderr: '' })
  assert.deepEqual(security.calls, [{
    targetId: 'pw',
    slot: 'ssh-password',
    credential: 'credential:test-password',
    operation: { operation: 'exec', command: ['uname'] },
  }])
  assert.equal(runner.calls[0].command, 'plink.exe')
  assert.equal(runner.calls[0].args.at(-1), `'uname'`)
  const passwordPath = runner.calls[0].args[runner.calls[0].args.indexOf('-pwfile') + 1]
  assert.equal(existsSync(passwordPath), false)
  service.dispose()
})

test('带口令私钥在启动客户端前拒绝', async (t) => {
  const root = fixture(t)
  const runner = fakeRunner()
  const service = createRemoteTargetsService({ root, runner, security: approved({ passphrase: 'phrase' }) })
  service.add('win-x', spec())

  await assert.rejects(() => service.exec('win-x', ['whoami']), expectCode('encrypted-key-unsupported'))
  assert.equal(runner.calls.length, 0)
  service.dispose()
})

test('probe 记录 SQLite 状态并可跨服务实例读取', async (t) => {
  const root = fixture(t)
  const runner = fakeRunner({ exitCode: 0, stdout: 'Administrator\n', stderr: '' })
  const service = createRemoteTargetsService({ root, runner, security: approved() })
  service.add('win-x', spec())

  const probe = await service.probe('win')
  assert.equal(probe.ok, true)
  assert.equal(probe.detail, 'Administrator')
  assert.equal(service.show('win-x').lastProbe?.ok, true)
  service.dispose()

  const reopened = createRemoteTargetsService({ root })
  assert.equal(reopened.show('win-x').lastProbe?.detail, 'Administrator')
  reopened.dispose()

  const failing = createRemoteTargetsService({
    root,
    security: approved(),
    runner: fakeRunner({ exitCode: 255, stdout: '', stderr: 'Permission denied' }),
  })
  const failed = await failing.probe('win-x')
  assert.equal(failed.ok, false)
  assert.equal(failed.detail, 'Permission denied')
  failing.dispose()
})

test('传输组件未登记或未就绪时在凭据交付前失败', async (t) => {
  const root = fixture(t)
  const availability = {}
  const service = createRemoteTargetsService({
    root,
    security: approved(),
    runner: fakeRunner(),
    components: { get(id) { return availability[id] } },
  })
  service.add('key-target', spec())

  await assert.rejects(() => service.exec('key-target', ['whoami']), expectCode('component-unavailable'))
  availability.openssh = { id: 'openssh', kind: 'external', state: 'stopped' }
  await assert.rejects(() => service.probe('key-target'), (error) => error.code === 'component-unavailable' && /stopped/.test(error.message))
  availability.openssh = { id: 'openssh', kind: 'external', state: 'healthy' }
  service.add('missing-key', spec({}, {
    identity: { login: 'root', auth: { method: 'private-key', credential: 'credential:missing' } },
  }))
  await assert.rejects(() => service.exec('missing-key', ['whoami']), expectCode('credential-missing'))

  service.add('pw-target', passwordSpec())
  await assert.rejects(() => service.exec('pw-target', ['whoami']), expectCode('component-unavailable'))
  availability.plink = { id: 'plink', kind: 'external', state: 'healthy' }
  service.add('missing-password', spec({}, {
    identity: { login: 'root', auth: { method: 'password', credential: 'credential:missing' } },
    resource: { kind: 'server' },
  }))
  await assert.rejects(() => service.exec('missing-password', ['whoami']), expectCode('credential-missing'))
  service.dispose()
})

test('addFromText 接受 YAML，id 以命令参数为准', (t) => {
  const root = fixture(t)
  const service = createRemoteTargetsService({ root })
  const target = service.addFromText('yaml-target', `
    resource:
      kind: server
    identity:
      login: root
      auth:
        method: password
        credential: credential:test-password
    connectivity:
      host: 192.0.2.10
      trust:
        fingerprint: SHA256:xyz
  `)
  assert.equal(target.id, 'yaml-target')
  assert.equal(target.connectivity.port, 22)
  assert.equal(target.connectivity.remoteShell, 'posix')
  service.dispose()
})

test('旧认证只用于显式迁移，运行时与新增目标都要求 CredentialRef', async (t) => {
  const root = fixture(t)
  writeFileSync(join(root, 'targets.yaml'), LEGACY_TARGET)
  writeLegacyCredential(root, 'credentials/legacy/id_ed25519')
  const runner = fakeRunner()
  const service = createRemoteTargetsService({ root, runner, security: approved() })

  assert.equal(service.show('legacy').identity.auth.path, 'credentials/legacy/id_ed25519')
  await assert.rejects(() => service.exec('legacy', ['whoami']), expectCode('migration-required'))
  assert.equal(runner.calls.length, 0)

  const migration = service.credentialMigration('legacy')
  assert.equal(migration.method, 'key')
  assert.equal(migration.path, join(root, 'credentials', 'legacy', 'id_ed25519'))
  assert.equal(existsSync(migration.path), true)

  const migrated = service.useCredential('legacy', 'credential:legacy-key')
  assert.equal(migrated.identity.auth.method, 'private-key')
  assert.equal(migrated.identity.auth.credential, 'credential:legacy-key')
  assert.equal(migrated.identity.auth.path, undefined)
  assert.equal(existsSync(migration.path), true)
  assert.throws(() => service.credentialMigration('legacy'), expectCode('already-migrated'))
  assert.throws(() => service.useCredential('legacy', 'credential:other'), expectCode('already-migrated'))

  await service.exec('legacy', ['whoami'])
  assert.equal(runner.calls.length, 1)
  service.dispose()
})

test('缺少 Core 授权入口时 probe/exec/shell 在执行前拒绝', async (t) => {
  const root = fixture(t)
  let started = false
  const service = createRemoteTargetsService({ root, runner: { async run() { started = true; throw new Error('不应启动') }, async interactive() { started = true; throw new Error('不应启动') } } })
  t.after(() => service.dispose())
  service.add('target-a', spec())
  for (const operation of [() => service.probe('target-a'), () => service.exec('target-a', ['whoami']), () => service.shell('target-a')]) {
    await assert.rejects(operation, (error) => error.code === 'access-denied')
  }
  assert.equal(started, false)
})
