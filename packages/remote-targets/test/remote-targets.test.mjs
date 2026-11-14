import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { createRemoteTargetsService, RemoteTargetsFailure } from '../lib/index.js'
import { buildSshInvocation, joinRemoteCommand, quoteCmd, quotePosix } from '../lib/ssh.js'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-remote-target-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function writeCredential(root, relative) {
  const path = join(root, ...relative.split('/'))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, 'placeholder', 'utf8')
  return path
}

function spec(connectivity = {}, overrides = {}) {
  return {
    resource: { kind: 'windows-device' },
    identity: { login: 'Administrator', auth: { method: 'key' } },
    connectivity: { via: 'frp', host: '127.0.0.1', port: 6001, ...connectivity },
    ...overrides,
  }
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

function expectCode(code) {
  return (error) => error instanceof RemoteTargetsFailure && error.code === code
}

test('登记、列举、按前缀查看与移除目标，默认值可预测', (t) => {
  const root = fixture(t)
  const service = createRemoteTargetsService({ root })

  const added = service.add('win-x', spec())
  assert.equal(added.id, 'win-x')
  assert.equal(added.identity.auth.path, 'credentials/win-x/id_ed25519')
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

test('拒绝未知字段、绝对路径与 id 不一致，dry-run 不落盘', (t) => {
  const root = fixture(t)
  const service = createRemoteTargetsService({ root })

  assert.throws(
    () => service.add('bad', { ...spec(), extra: true }),
    expectCode('invalid-spec'),
  )
  assert.throws(
    () => service.add('bad', {
      ...spec(),
      identity: { login: 'root', auth: { method: 'key', path: '/etc/key' } },
    }),
    expectCode('invalid-spec'),
  )
  assert.throws(
    () => service.add('bad', {
      ...spec(),
      identity: { login: 'root', auth: { method: 'key', path: '../key' } },
    }),
    expectCode('invalid-spec'),
  )
  assert.throws(
    () => service.add('bad', spec({}, { id: 'other' })),
    expectCode('invalid-spec'),
  )

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

test('密钥认证使用 OpenSSH 参数，显式 known_hosts 开启严格校验', (t) => {
  const root = fixture(t)
  const service = createRemoteTargetsService({ root })
  const target = service.add('win-x', spec())

  const invocation = buildSshInvocation(target, root, ['whoami'])
  assert.equal(invocation.command, 'ssh')
  assert.deepEqual(invocation.args.slice(0, 6), [
    '-p', '6001', '-l', 'Administrator', '-i', join(root, 'credentials', 'win-x', 'id_ed25519'),
  ])
  assert.ok(invocation.args.includes('StrictHostKeyChecking=accept-new'))
  assert.equal(invocation.args.at(-1), 'whoami')

  const strict = service.add('strict', spec({ trust: { knownHosts: 'credentials/strict/known_hosts' } }))
  const strictInvocation = buildSshInvocation(strict, root, [])
  assert.ok(strictInvocation.args.includes('StrictHostKeyChecking=yes'))
  assert.equal(strictInvocation.args.at(-1), '127.0.0.1')
  service.dispose()
})

test('密码认证使用 Plink，缺少主机指纹时拒绝', (t) => {
  const root = fixture(t)
  const service = createRemoteTargetsService({ root })
  const target = service.add('dev', spec(
    { client: 'plink.exe', host: '10.0.0.1', port: 22, trust: { fingerprint: 'SHA256:abc' } },
    { identity: { login: 'root', auth: { method: 'password' } }, resource: { kind: 'server' } },
  ))

  const invocation = buildSshInvocation(target, root, ['uname', '-a'])
  assert.equal(invocation.command, 'plink.exe')
  assert.ok(invocation.args.includes('-pwfile'))
  assert.ok(invocation.args.includes('SHA256:abc'))
  assert.equal(invocation.args.at(-1), `'uname' '-a'`)

  const unsafe = service.add('unsafe', spec(
    { host: '10.0.0.2' },
    { identity: { login: 'root', auth: { method: 'password' } }, resource: { kind: 'server' } },
  ))
  assert.throws(() => buildSshInvocation(unsafe, root, ['whoami']), expectCode('invalid-spec'))
  service.dispose()
})

test('exec 检查凭据与能力，退出码与输出原样返回', async (t) => {
  const root = fixture(t)
  const runner = fakeRunner({ exitCode: 7, stdout: 'out', stderr: 'err' })
  const service = createRemoteTargetsService({ root, runner })
  service.add('win-x', spec())

  await assert.rejects(
    () => service.exec('win-x', ['whoami']),
    expectCode('credential-missing'),
  )

  writeCredential(root, 'credentials/win-x/id_ed25519')
  const result = await service.exec('win-x', ['whoami'])
  assert.deepEqual(result, { targetId: 'win-x', exitCode: 7, stdout: 'out', stderr: 'err' })
  assert.equal(runner.calls.length, 1)
  assert.equal(runner.calls[0].args.at(-1), 'whoami')

  service.add('shell-only', spec({}, {
    access: { capabilities: ['shell'] },
  }))
  writeCredential(root, 'credentials/shell-only/id_ed25519')
  await assert.rejects(
    () => service.exec('shell-only', ['whoami']),
    expectCode('capability-unsupported'),
  )

  await assert.rejects(() => service.exec('win-x', []), expectCode('invalid-spec'))
  service.dispose()
})

test('probe 记录 SQLite 状态并可跨服务实例读取', async (t) => {
  const root = fixture(t)
  const runner = fakeRunner({ exitCode: 0, stdout: 'Administrator\n', stderr: '' })
  const service = createRemoteTargetsService({ root, runner })
  service.add('win-x', spec())
  writeCredential(root, 'credentials/win-x/id_ed25519')

  const probe = await service.probe('win')
  assert.equal(probe.ok, true)
  assert.equal(probe.detail, 'Administrator')
  const view = service.show('win-x')
  assert.equal(view.lastProbe?.ok, true)
  service.dispose()

  const reopened = createRemoteTargetsService({ root })
  assert.equal(reopened.show('win-x').lastProbe?.detail, 'Administrator')
  reopened.dispose()

  const failing = createRemoteTargetsService({
    root,
    runner: fakeRunner({ exitCode: 255, stdout: '', stderr: 'Permission denied' }),
  })
  const failed = await failing.probe('win-x')
  assert.equal(failed.ok, false)
  assert.equal(failed.detail, 'Permission denied')
  failing.dispose()
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

test('auth.root 复用外部凭据目录，不复制文件', async (t) => {
  const root = fixture(t)
  const external = mkdtempSync(join(tmpdir(), 'locus-credential-'))
  t.after(() => rmSync(external, { recursive: true, force: true }))
  writeCredential(external, 'frp/win-a/.ssh/id_ed25519')

  const runner = fakeRunner()
  const service = createRemoteTargetsService({ root, runner })
  service.add('win-a', spec({}, {
    identity: {
      login: 'Administrator',
      auth: { method: 'key', root: external, path: 'frp/win-a/.ssh/id_ed25519' },
    },
  }))

  await service.exec('win-a', ['whoami'])
  assert.ok(
    runner.calls[0]?.args.includes(join(external, 'frp', 'win-a', '.ssh', 'id_ed25519')),
  )
  assert.equal(existsSync(join(root, 'credentials', 'win-a', 'id_ed25519')), false)
  service.dispose()
})

