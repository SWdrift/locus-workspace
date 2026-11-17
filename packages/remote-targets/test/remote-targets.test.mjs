import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  createCommandRunner,
  createRemoteTargetsService,
  parseAddSpecText,
  readCredentialFile,
  RemoteTargetsFailure,
  targetBinding,
} from '../lib/index.js'
import {
  buildSshInvocation,
  joinRemoteCommand,
  quoteCmd,
  quotePosix,
} from '../lib/ssh.js'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-remote-target-'))
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return root
}

/** 新目标只声明 method；秘密由 Core 按 component + slot + resourceKey 交付。 */
function spec(connectivity = {}, overrides = {}) {
  return {
    resource: { kind: 'windows-device' },
    identity: { login: 'Administrator', auth: { method: 'private-key' } },
    connectivity: { via: 'frp', host: '127.0.0.1', port: 6001, ...connectivity },
    ...overrides,
  }
}

function passwordSpec(connectivity = {}) {
  return spec(
    { client: 'plink.exe', host: '10.0.0.1', port: 22, trust: { fingerprint: 'SHA256:abc' }, ...connectivity },
    {
      identity: { login: 'root', auth: { method: 'password' } },
      resource: { kind: 'server' },
    },
  )
}

function serverSpec(connectivity = {}, overrides = {}) {
  return spec(connectivity, {
    resource: { kind: 'server' },
    identity: { login: 'root', auth: { method: 'private-key' } },
    ...overrides,
  })
}

function keyMaterial(service, id, overrides = {}) {
  return {
    slot: 'ssh-private-key',
    values: {
      targetBinding: targetBinding(service.show(id)),
      privateKey: 'private-key-material',
      ...overrides,
    },
  }
}

function passwordMaterial(service, id, overrides = {}) {
  return {
    slot: 'ssh-password',
    values: {
      targetBinding: targetBinding(service.show(id)),
      password: 'password-material',
      ...overrides,
    },
  }
}

function fakeRunner(result = { exitCode: 0, stdout: 'whoami-ok', stderr: '' }, interactiveCode = 0) {
  const calls = []
  return {
    calls,
    async run(command, args, options) {
      calls.push({ command, args, options })
      return result
    },
    async interactive(command, args, options) {
      calls.push({ command, args, options })
      return interactiveCode
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

test('登记、列举、按前缀查看与移除目标，默认值可预测且不写秘密文件', (t) => {
  const root = fixture(t)
  const service = createRemoteTargetsService({ root })
  t.after(() => service.dispose())

  const added = service.add('win-x', spec())
  assert.equal(added.id, 'win-x')
  assert.deepEqual(added.identity.auth, { method: 'private-key' })
  assert.equal(added.connectivity.remoteShell, 'cmd')
  assert.equal(added.connectivity.via, 'frp')
  assert.equal(added.connectivity.port, 6001)
  assert.deepEqual(added.access.capabilities, ['exec', 'shell'])
  assert.equal(existsSync(join(root, 'targets.yaml')), true)
  assert.equal(existsSync(join(root, 'trust', 'win-x')), true)
  assert.equal(existsSync(join(root, 'trust', 'win-x', 'known_hosts')), false)
  assert.equal(existsSync(join(root, 'credentials')), false)

  assert.equal(service.list().length, 1)
  assert.equal(service.show('win').id, 'win-x')
  assert.throws(() => service.show('missing'), expectCode('target-not-found'))
  assert.throws(() => service.add('win-x', spec()), expectCode('target-exists'))

  const yaml = parseAddSpecText(JSON.stringify(serverSpec()), 'yaml-target')
  assert.equal(yaml.connectivity.remoteShell, 'posix')

  service.remove('win')
  assert.equal(service.list().length, 0)
  assert.throws(() => service.show('win-x'), expectCode('target-not-found'))
})

test('拒绝未知字段、旧认证方式与非法路径，dry-run 不落盘', (t) => {
  const root = fixture(t)
  const service = createRemoteTargetsService({ root })
  t.after(() => service.dispose())

  assert.throws(() => service.add('bad', { ...spec(), extra: true }), expectCode('invalid-spec'))
  assert.throws(() => service.add('bad', spec({}, { id: 'other' })), expectCode('invalid-spec'))
  assert.throws(
    () => service.add('bad', spec({}, { identity: { login: 'root', auth: { method: 'private-key', credential: 'credential:key' } } })),
    expectCode('invalid-spec'),
  )
  assert.throws(
    () => service.add('bad', spec({}, { identity: { login: 'root', auth: { method: 'private-key', path: '../key' } } })),
    expectCode('invalid-spec'),
  )
  assert.throws(
    () => service.add('legacy', spec({}, { identity: { login: 'root', auth: { method: 'key', path: 'id_ed25519' } } })),
    expectCode('migration-required'),
  )
  assert.throws(
    () => service.add('Bad_Id', spec()),
    expectCode('invalid-spec'),
  )

  const dry = service.add('dry', spec(), { dryRun: true })
  assert.equal(dry.id, 'dry')
  assert.equal(service.list().length, 0)
  assert.equal(existsSync(join(root, 'targets.yaml')), false)
  assert.equal(existsSync(join(root, 'trust', 'dry')), false)
})

test('targets.yaml 解析默认值、重复 id 与 knownHosts 相对路径约束', (t) => {
  const root = fixture(t)
  writeFileSync(join(root, 'targets.yaml'), `version: 1
targets:
  - id: alpha
    resource:
      kind: server
    identity:
      login: root
      auth:
        method: private-key
    connectivity:
      host: 192.0.2.10
      trust:
        knownHosts: trust/alpha/known_hosts
  - id: beta
    resource:
      kind: windows-device
    identity:
      login: Administrator
      auth:
        method: password
    connectivity:
      host: 192.0.2.11
      trust:
        fingerprint: SHA256:xyz
`, 'utf8')

  const service = createRemoteTargetsService({ root })
  t.after(() => service.dispose())
  const targets = service.list()
  assert.deepEqual(targets.map((target) => target.id), ['alpha', 'beta'])
  assert.equal(targets[0].connectivity.port, 22)
  assert.equal(targets[0].connectivity.remoteShell, 'posix')
  assert.equal(targets[1].connectivity.remoteShell, 'cmd')
  assert.deepEqual(targets[1].identity.auth, { method: 'password' })

  const loaded = service.addFromText('gamma', `
    identity:
      login: root
      auth:
        method: private-key
    resource:
      kind: server
    connectivity:
      host: 192.0.2.12
      port: 2200
  `)
  assert.equal(loaded.connectivity.port, 2200)

  writeFileSync(join(root, 'targets.yaml'), `version: 1
targets:
  - id: dup
    identity: { login: root, auth: { method: private-key } }
    connectivity: { host: 192.0.2.1 }
  - id: dup
    identity: { login: root, auth: { method: private-key } }
    connectivity: { host: 192.0.2.2 }
`, 'utf8')
  assert.throws(() => service.list(), expectCode('invalid-spec'))

  writeFileSync(join(root, 'targets.yaml'), `version: 2
targets: []
`, 'utf8')
  assert.throws(() => service.list(), expectCode('invalid-spec'))

  writeFileSync(join(root, 'targets.yaml'), `version: 1
targets:
  - id: absolute
    identity: { login: root, auth: { method: private-key } }
    connectivity:
      host: 192.0.2.1
      trust: { knownHosts: /etc/ssh/known_hosts }
`, 'utf8')
  assert.throws(() => service.list(), expectCode('invalid-spec'))
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
  const runner = createCommandRunner()
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

test('密钥认证使用 OpenSSH 参数，known_hosts 默认宽松、显式配置严格校验', (t) => {
  const root = fixture(t)
  const service = createRemoteTargetsService({ root })
  t.after(() => service.dispose())
  const target = service.add('posix', serverSpec({ port: 6001 }))
  const path = join(root, 'temp-key')

  const invocation = buildSshInvocation(target, root, ['whoami'], path)
  assert.equal(invocation.command, 'ssh')
  assert.deepEqual(invocation.args.slice(0, 6), ['-p', '6001', '-l', 'root', '-i', path])
  assert.ok(invocation.args.includes('IdentitiesOnly=yes'))
  assert.ok(invocation.args.includes('IdentityAgent=none'))
  assert.ok(invocation.args.includes('StrictHostKeyChecking=accept-new'))
  assert.ok(invocation.args.includes(`UserKnownHostsFile=${join(root, 'trust', 'posix', 'known_hosts')}`))
  assert.equal(invocation.args.at(-1), `'whoami'`)

  const strict = createRemoteTargetsService({ root: join(root, 'strict-root') })
  t.after(() => strict.dispose())
  const strictTarget = strict.add('strict', serverSpec({ trust: { knownHosts: 'trust/strict/known_hosts' } }))
  const strictInvocation = buildSshInvocation(strictTarget, join(root, 'strict-root'), [], path)
  assert.ok(strictInvocation.args.includes('StrictHostKeyChecking=yes'))
  assert.equal(strictInvocation.args.at(-1), '127.0.0.1')
})

test('密码认证使用 Plink，缺少主机指纹时拒绝', (t) => {
  const root = fixture(t)
  const service = createRemoteTargetsService({ root })
  t.after(() => service.dispose())
  const target = service.add('dev', passwordSpec())
  const path = join(root, 'temp-password')

  const invocation = buildSshInvocation(target, root, ['uname', '-a'], path)
  assert.equal(invocation.command, 'plink.exe')
  assert.ok(invocation.args.includes('-pwfile'))
  assert.ok(invocation.args.includes('SHA256:abc'))
  assert.equal(invocation.args.at(-1), `'uname' '-a'`)

  const unsafe = service.add('unsafe', passwordSpec({ host: '10.0.0.2', trust: undefined }))
  assert.throws(() => buildSshInvocation(unsafe, root, ['whoami'], path), expectCode('invalid-spec'))
})

test('exec 以临时文件交付私钥并在结束后清理，退出码与输出原样返回', async (t) => {
  const root = fixture(t)
  let delivered
  let deliveredPath
  const runner = {
    calls: [],
    async run(command, args, options) {
      this.calls.push({ command, args, options })
      const path = args[args.indexOf('-i') + 1]
      deliveredPath = path
      delivered = readFileSync(path, 'utf8')
      return { exitCode: 7, stdout: 'out', stderr: 'err' }
    },
    async interactive() {
      throw new Error('不应交互')
    },
  }
  const service = createRemoteTargetsService({ root, runner })
  t.after(() => service.dispose())
  service.add('win-x', spec())

  const result = await service.exec('win-x', ['whoami'], keyMaterial(service, 'win-x'))
  assert.deepEqual(result, { targetId: 'win-x', exitCode: 7, stdout: 'out', stderr: 'err' })
  assert.equal(delivered, 'private-key-material')
  assert.equal(existsSync(deliveredPath), false)
  assert.equal(runner.calls.length, 1)
  assert.equal(runner.calls[0].args.at(-1), 'whoami')
})

test('密码槽经 -pwfile 交付 password 字段，临时文件在结束后清理', async (t) => {
  const root = fixture(t)
  let delivered
  let deliveredPath
  const runner = {
    calls: [],
    async run(command, args) {
      this.calls.push({ command, args })
      const path = args[args.indexOf('-pwfile') + 1]
      deliveredPath = path
      delivered = readFileSync(path, 'utf8')
      return { exitCode: 0, stdout: 'Linux', stderr: '' }
    },
    async interactive() {
      throw new Error('不应交互')
    },
  }
  const service = createRemoteTargetsService({ root, runner })
  t.after(() => service.dispose())
  service.add('pw', passwordSpec())

  const result = await service.exec('pw', ['uname'], passwordMaterial(service, 'pw'))
  assert.deepEqual(result, { targetId: 'pw', exitCode: 0, stdout: 'Linux', stderr: '' })
  assert.equal(delivered, 'password-material')
  assert.equal(existsSync(deliveredPath), false)
  assert.equal(runner.calls[0].command, 'plink.exe')
  assert.equal(runner.calls[0].args.at(-1), `'uname'`)
})

test('带口令私钥、凭据槽不匹配与目标配置变化在执行前拒绝', async (t) => {
  const root = fixture(t)
  const runner = fakeRunner()
  const service = createRemoteTargetsService({ root, runner })
  t.after(() => service.dispose())
  service.add('win-x', spec())
  service.add('pw', passwordSpec())

  await assert.rejects(
    () => service.exec('win-x', ['whoami'], keyMaterial(service, 'win-x', { passphrase: 'phrase' })),
    expectCode('encrypted-key-unsupported'),
  )
  await assert.rejects(
    () => service.exec('win-x', ['whoami'], passwordMaterial(service, 'pw')),
    expectCode('invalid-spec'),
  )
  await assert.rejects(
    () => service.exec('win-x', ['whoami'], { slot: 'ssh-private-key', values: { targetBinding: 'stale', privateKey: 'k' } }),
    expectCode('target-config-mismatch'),
  )
  await assert.rejects(
    () => service.exec('win-x', ['whoami'], { slot: 'ssh-private-key', values: { targetBinding: targetBinding(service.show('win-x')) } }),
    expectCode('credential-missing'),
  )
  assert.equal(runner.calls.length, 0)

  const beforeChange = keyMaterial(service, 'win-x')
  service.remove('win-x')
  service.add('win-x', spec({ host: 'attacker.example' }))
  await assert.rejects(
    () => service.exec('win-x', ['whoami'], beforeChange),
    expectCode('target-config-mismatch'),
  )
  assert.equal(runner.calls.length, 0)
})

test('exec/shell 遵守目标授权能力与命令约束', async (t) => {
  const root = fixture(t)
  const runner = fakeRunner()
  const service = createRemoteTargetsService({ root, runner })
  t.after(() => service.dispose())
  service.add('shell-only', spec({}, { access: { capabilities: ['shell'] } }))
  service.add('exec-only', spec({}, { access: { capabilities: ['exec'] } }))

  await assert.rejects(
    () => service.exec('shell-only', ['whoami'], keyMaterial(service, 'shell-only')),
    expectCode('capability-unsupported'),
  )
  await assert.rejects(
    () => service.exec('exec-only', [], keyMaterial(service, 'exec-only')),
    expectCode('invalid-spec'),
  )
  await assert.rejects(
    () => service.shell('exec-only', keyMaterial(service, 'exec-only')),
    expectCode('capability-unsupported'),
  )
  assert.equal(runner.calls.length, 0)

  const exitCode = await service.shell('shell-only', keyMaterial(service, 'shell-only'))
  assert.equal(exitCode, 0)
  assert.equal(runner.calls.length, 1)
  assert.equal(runner.calls[0].args.at(-1), '127.0.0.1')
})

test('services/restartService 仅支持 cmd，解析输出并传递超时', async (t) => {
  const root = fixture(t)
  const runner = fakeRunner({
    exitCode: 0,
    stdout: JSON.stringify([{ Name: 'beta', Status: 'Stopped' }, { Name: 'alpha', Status: 'Running' }]),
    stderr: '',
  })
  const service = createRemoteTargetsService({ root, runner })
  t.after(() => service.dispose())
  service.add('win-x', spec())
  service.add('posix', serverSpec())

  const services = await service.services('win-x', keyMaterial(service, 'win-x'))
  assert.deepEqual(services, [
    { name: 'alpha', status: 'Running' },
    { name: 'beta', status: 'Stopped' },
  ])
  assert.equal(runner.calls[0].options.timeoutMs, 30000)

  runner.calls.length = 0
  const restarted = await service.restartService('win-x', 'alpha', keyMaterial(service, 'win-x'))
  assert.deepEqual(restarted, { name: 'alpha', status: 'Running' })
  const encoded = runner.calls[0].args.at(-1).split(' ').at(-1)
  assert.match(encoded, /^[A-Za-z0-9+/=]+$/)
  assert.match(Buffer.from(encoded, 'base64').toString('utf16le'), /Restart-Service -Name 'alpha'/)
  assert.equal(runner.calls[0].options.timeoutMs, 60000)

  await assert.rejects(
    () => service.services('posix', keyMaterial(service, 'posix')),
    expectCode('capability-unsupported'),
  )
  await assert.rejects(
    () => service.restartService('posix', 'alpha', keyMaterial(service, 'posix')),
    expectCode('capability-unsupported'),
  )
  await assert.rejects(
    () => service.restartService('win-x', 'bad;name', keyMaterial(service, 'win-x')),
    expectCode('invalid-spec'),
  )
})

test('system 与 probe 返回结果，probe 状态跨服务实例读取', async (t) => {
  const root = fixture(t)
  const runner = fakeRunner({ exitCode: 0, stdout: 'Administrator\n', stderr: '' })
  const service = createRemoteTargetsService({ root, runner })
  t.after(() => service.dispose())
  service.add('win-x', spec())

  const system = await service.system('win-x', keyMaterial(service, 'win-x'))
  assert.equal(system.targetId, 'win-x')
  assert.equal(system.ok, true)
  assert.equal(system.detail, 'Administrator')
  assert.equal(runner.calls[0].options.timeoutMs, 15000)

  const probe = await service.probe('win', keyMaterial(service, 'win-x'))
  assert.equal(probe.ok, true)
  assert.equal(probe.detail, 'Administrator')
  assert.equal(service.show('win-x').lastProbe?.ok, true)

  const reopened = createRemoteTargetsService({ root })
  t.after(() => reopened.dispose())
  assert.equal(reopened.show('win-x').lastProbe?.detail, 'Administrator')

  const failing = createRemoteTargetsService({
    root,
    runner: fakeRunner({ exitCode: 255, stdout: '', stderr: 'Permission denied' }),
  })
  t.after(() => failing.dispose())
  const failed = await failing.probe('win-x', keyMaterial(failing, 'win-x'))
  assert.equal(failed.ok, false)
  assert.equal(failed.detail, 'Permission denied')
  service.dispose()
  reopened.dispose()
  failing.dispose()
})

test('传输组件未登记或未就绪时在凭据交付前失败', async (t) => {
  const root = fixture(t)
  const availability = {}
  const runner = fakeRunner()
  const service = createRemoteTargetsService({
    root,
    runner,
    components: { get(id) { return availability[id] } },
  })
  t.after(() => service.dispose())
  service.add('key-target', spec())
  service.add('pw-target', passwordSpec())

  await assert.rejects(
    () => service.exec('key-target', ['whoami'], keyMaterial(service, 'key-target')),
    expectCode('component-unavailable'),
  )
  availability.openssh = { id: 'openssh', kind: 'external', state: 'stopped' }
  await assert.rejects(
    () => service.probe('key-target', keyMaterial(service, 'key-target')),
    (error) => error.code === 'component-unavailable' && /stopped/.test(error.message),
  )
  await assert.rejects(
    () => service.exec('pw-target', ['whoami'], passwordMaterial(service, 'pw-target')),
    expectCode('component-unavailable'),
  )
  assert.equal(runner.calls.length, 0)

  availability.openssh = { id: 'openssh', kind: 'external', state: 'healthy' }
  availability.plink = { id: 'plink', kind: 'external', state: 'healthy' }
  await assert.rejects(
    () => service.exec('key-target', ['whoami'], { slot: 'ssh-private-key', values: { targetBinding: targetBinding(service.show('key-target')) } }),
    expectCode('credential-missing'),
  )
  assert.equal(runner.calls.length, 0)
})

test('旧文件认证只用于显式迁移，运行时要求 Core 凭据材料', async (t) => {
  const root = fixture(t)
  writeFileSync(join(root, 'targets.yaml'), LEGACY_TARGET)
  const legacyPath = join(root, 'credentials', 'legacy', 'id_ed25519')
  mkdirSync(dirname(legacyPath), { recursive: true })
  writeFileSync(legacyPath, 'legacy-key', 'utf8')
  const runner = fakeRunner()
  const service = createRemoteTargetsService({ root, runner })
  t.after(() => service.dispose())

  assert.equal(service.show('legacy').identity.auth.path, 'credentials/legacy/id_ed25519')
  await assert.rejects(
    () => service.exec('legacy', ['whoami'], { slot: 'ssh-private-key', values: {} }),
    expectCode('migration-required'),
  )
  assert.equal(runner.calls.length, 0)

  const migration = service.credentialMigration('legacy')
  assert.equal(migration.method, 'key')
  assert.equal(migration.path, legacyPath)
  assert.equal(existsSync(migration.path), true)

  const migrated = service.useCredential('legacy')
  assert.deepEqual(migrated.identity.auth, { method: 'private-key' })
  assert.equal('path' in migrated.identity.auth, false)
  assert.equal(existsSync(migration.path), true)
  assert.throws(() => service.credentialMigration('legacy'), expectCode('already-migrated'))
  assert.throws(() => service.useCredential('legacy'), expectCode('already-migrated'))
  assert.equal(service.show('legacy').identity.auth.path, undefined)

  await service.exec('legacy', ['whoami'], keyMaterial(service, 'legacy'))
  assert.equal(runner.calls.length, 1)
})

test('凭据文件读取只接受有界普通 UTF-8 文件', async (t) => {
  const root = fixture(t)
  const plain = join(root, 'plain')
  writeFileSync(plain, 'secret', 'utf8')
  assert.equal(await readCredentialFile(plain), 'secret')

  const empty = join(root, 'empty')
  writeFileSync(empty, '', 'utf8')
  await assert.rejects(() => readCredentialFile(empty), expectCode('invalid-spec'))

  const large = join(root, 'large')
  writeFileSync(large, 'x'.repeat(1024 * 1024 + 1), 'utf8')
  await assert.rejects(() => readCredentialFile(large), expectCode('credential-too-large'))

  const linked = join(root, 'linked')
  try {
    symlinkSync(plain, linked)
  } catch (error) {
    t.skip(`当前环境不能创建符号链接：${error.message}`)
    return
  }
  await assert.rejects(() => readCredentialFile(linked), expectCode('io'))
})
