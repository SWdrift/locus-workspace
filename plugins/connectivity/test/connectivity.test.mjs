import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createConnectivityService } from '../lib/index.js'

function fixture(t) {
  const data = mkdtempSync(join(tmpdir(), 'locus-connectivity-'))
  const services = []
  const calls = []
  let runner
  const remoteMachine = {
    get(machineId) {
      if (machineId !== 'machine-1' && machineId !== 'machine-2') {
        throw new Error(`找不到 Remote Machine：${machineId}`)
      }
      return { id: machineId, name: `Machine ${machineId}` }
    },
  }
  const service = (options = {}) => {
    const instance = createConnectivityService(
      { dataDirectory: data },
      remoteMachine,
      {
        run: async (args, signal) => {
          calls.push(args)
          if (runner) return runner(args, signal)
          if (args[0] === '-V') return { stdout: '', stderr: 'OpenSSH_9.5', error: null }
          return { stdout: 'host-1\n', stderr: '', error: null }
        },
        probeTcp: async () => 'listening',
        ...options,
      },
    )
    services.push(instance)
    return instance
  }
  t.after(async () => {
    await Promise.all(services.map((instance) => instance.dispose()))
    rmSync(data, { recursive: true, force: true })
  })
  return { data, calls, service, setRunner(value) { runner = value } }
}

function sshG(overrides = '') {
  return [
    'hostname 198.51.100.10',
    'port 22',
    'user admin',
    'proxyjump none',
    'proxycommand none',
    'stricthostkeychecking yes',
    'identityfile C:\\Users\\test\\.ssh\\id_ed25519',
    ...(overrides === '' ? [] : overrides.split('\n')),
    '',
  ].join('\n')
}

test('Profile 持久化、多个入口与 Machine Identity 独立', async (t) => {
  const f = fixture(t)
  let service = f.service()
  const direct = service.add('machine-1', {
    name: 'direct',
    transport: 'direct',
    target: 'build.example',
  })
  const jump = service.add('machine-1', {
    name: 'jump',
    transport: 'proxy-jump',
    target: 'build.example',
    proxyJump: 'jump.example',
  })
  const frp = service.add('machine-1', {
    name: 'frp',
    transport: 'frp',
    target: '127.0.0.1',
    port: 6000,
    user: 'Administrator',
  })
  assert.equal(direct.machineId, 'machine-1')
  assert.equal(jump.machineId, 'machine-1')
  assert.equal(frp.machineId, 'machine-1')
  assert.equal(service.list('machine-1').length, 3)
  assert.equal(service.list('machine-2').length, 0)
  assert.throws(
    () => service.add('machine-1', { name: 'direct', transport: 'direct', target: 'other' }),
    /同名/,
  )
  assert.throws(
    () => service.add('machine-1', { name: 'bad', transport: 'proxy-jump', target: 'other' }),
    /必须提供 ProxyJump/,
  )
  assert.throws(
    () => service.add('machine-1', { name: 'bad', transport: 'frp', target: '127.0.0.1' }),
    /visitor 端口/,
  )
  assert.throws(
    () => service.add('machine-1', { name: 'bad', transport: 'direct', target: '-oProxyCommand=x' }),
    /不能以 - 开头/,
  )
  assert.throws(
    () => service.add('machine-missing', { name: 'bad', transport: 'direct', target: 'host' }),
    /找不到 Remote Machine/,
  )

  await service.dispose()
  service = f.service()
  assert.equal(service.get(direct.id).id, direct.id)
  assert.equal(service.get(direct.id).machineId, 'machine-1')
})

test('修改与删除 Profile 不改变 Machine 或其他 Profile', async (t) => {
  const f = fixture(t)
  const service = f.service()
  const first = service.add('machine-1', { name: 'one', transport: 'direct', target: 'build.example' })
  const second = service.add('machine-1', { name: 'two', transport: 'frp', target: '127.0.0.1', port: 6000 })
  const changed = service.update(first.id, { name: 'renamed', target: 'build.internal', port: 2222 })
  assert.equal(changed.id, first.id)
  assert.equal(changed.machineId, 'machine-1')
  assert.equal(changed.name, 'renamed')
  assert.equal(changed.target, 'build.internal')
  assert.equal(changed.port, 2222)
  assert.equal(service.get(second.id).id, second.id)

  service.remove(first.id)
  assert.throws(() => service.get(first.id), /找不到 Connection Profile/)
  assert.equal(service.get(second.id).id, second.id)
  assert.equal(service.list('machine-1').length, 1)
})

test('inspect 复用 OpenSSH 有效配置，并在默认脱敏中不返回身份路径', async (t) => {
  const f = fixture(t)
  const service = f.service()
  const profile = service.add('machine-1', {
    name: 'alias',
    transport: 'direct',
    target: 'build-alias',
  })
  const knownHosts = join(f.data, 'known_hosts')
  writeFileSync(knownHosts, '')
  f.setRunner(async (args) => {
    assert.equal(args.includes('-G'), true)
    return {
      stdout: sshG(`userknownhostsfile ${knownHosts}`),
      stderr: '',
      error: null,
    }
  })
  const inspected = await service.inspect(profile.id)
  assert.equal(inspected.state, 'ready')
  assert.equal(inspected.resolved.hostname, '198.51.100.10')
  assert.equal(inspected.resolved.port, 22)
  assert.equal(inspected.resolved.user, 'admin')
  assert.equal(inspected.resolved.identityFileCount, 1)
  assert.equal(inspected.resolved.knownHostsFileCount, 1)
  assert.equal(JSON.stringify(inspected).includes('C:\\Users\\test'), false)
  assert.equal(inspected.checks.some((check) => check.code === 'effective-config' && check.state === 'ok'), true)
})

test('ProxyJump 与 FRP visitor 前置检查分别表达', async (t) => {
  const f = fixture(t)
  const service = f.service()
  const jump = service.add('machine-1', {
    name: 'jump',
    transport: 'proxy-jump',
    target: 'target.example',
    proxyJump: 'jump.example',
  })
  f.setRunner(async (args) => {
    assert.equal(args.includes('-J'), true)
    return {
      stdout: sshG().replace('proxyjump none', 'proxyjump jump.example'),
      stderr: '',
      error: null,
    }
  })
  assert.equal(['ready', 'warning'].includes((await service.inspect(jump.id)).state), true)

  const frp = service.add('machine-1', {
    name: 'frp',
    transport: 'frp',
    target: '127.0.0.1',
    port: 6000,
  })
  f.setRunner(async () => ({ stdout: sshG(), stderr: '', error: null }))
  assert.equal((await service.inspect(frp.id)).checks
    .find((check) => check.code === 'frp-visitor').state, 'ok')

  const noVisitor = f.service({ probeTcp: async () => 'refused' })
  const unavailableVisitor = await noVisitor.inspect(frp.id)
  assert.equal(unavailableVisitor.state, 'error')
  assert.equal(unavailableVisitor.checks.find((check) => check.code === 'frp-visitor').state, 'error')
})

test('inspect 区分 OpenSSH 缺失、配置错误与 explicit 文件缺失', async (t) => {
  const f = fixture(t)
  const service = f.service()
  const profile = service.add('machine-1', {
    name: 'missing',
    transport: 'direct',
    target: 'build.example',
    identityFile: join(f.data, 'missing-id'),
  })
  f.setRunner(async () => ({ stdout: '', stderr: '', error: { code: 'ENOENT' } }))
  const unavailable = await service.inspect(profile.id)
  assert.equal(unavailable.state, 'unavailable')

  f.setRunner(async () => ({
    stdout: sshG(`identityfile ${join(f.data, 'missing-id')}`),
    stderr: '',
    error: null,
  }))
  const invalid = await service.inspect(profile.id)
  assert.equal(invalid.state, 'error')
  assert.equal(invalid.checks.find((check) => check.code === 'identity-file').state, 'error')

  const badConfig = f.service()
  const badProfile = badConfig.add('machine-1', { name: 'bad', transport: 'direct', target: 'bad-alias' })
  f.setRunner(async () => ({ stdout: '', stderr: 'Bad configuration option', error: { code: 255 } }))
  const bad = await badConfig.inspect(badProfile.id)
  assert.equal(bad.state, 'error')
  assert.match(bad.error, /配置解析失败/)
})

test('verify 执行一次只读 hostname 并区分连接失败类别', async (t) => {
  const f = fixture(t)
  const service = f.service()
  const profile = service.add('machine-1', {
    name: 'verify',
    transport: 'direct',
    target: 'build.example',
    port: 2222,
  })
  const success = await service.verify(profile.id)
  assert.equal(success.state, 'connected')
  assert.equal(success.host.hostname, 'host-1')
  assert.equal(success.source.transport, 'direct')
  assert.equal(success.durationMs >= 0, true)
  const call = f.calls.at(-1)
  assert.equal(call.includes('-T'), true)
  assert.equal(call.includes('hostname'), true)

  const cases = [
    [{ code: 255 }, 'user@host: Permission denied (publickey).', 'denied'],
    [{ code: 255 }, 'Host key verification failed.', 'host-key'],
    [{ code: 255 }, 'ssh: connect to host x port 22: Connection refused', 'target-unavailable'],
    [{ code: 255 }, 'ssh: connect to host x port 22: Connection timed out', 'unreachable'],
    [{ code: 255 }, 'Bad configuration option: Foo', 'config-error'],
    [{ code: 'ENOENT' }, '', 'unavailable'],
    [{ code: 255 }, 'unexpected', 'error'],
  ]
  for (const [error, stderr, state] of cases) {
    f.setRunner(async () => ({ stdout: '', stderr, error }))
    const attempt = await service.verify(profile.id)
    assert.equal(attempt.state, state)
    assert.equal(attempt.host, undefined)
    assert.equal(typeof attempt.error, 'string')
  }
})

test('open 返回原生命令入口而不启动交互进程', async (t) => {
  const f = fixture(t)
  const service = f.service()
  const profile = service.add('machine-1', {
    name: 'open',
    transport: 'proxy-jump',
    target: 'target.example',
    port: 2222,
    user: 'admin',
    proxyJump: 'jump.example',
    identityFile: 'C:\\secret\\id',
    knownHostsFile: 'C:\\secret\\known_hosts',
    sshConfigFile: 'C:\\secret\\ssh_config',
  })
  const before = f.calls.length
  const opened = service.open(profile.id)
  assert.equal(opened.mode, 'native')
  assert.equal(f.calls.length, before)
  assert.equal(opened.command[0], 'ssh')
  assert.equal(opened.command.includes('-F'), true)
  assert.equal(opened.command.includes('-i'), true)
  assert.equal(opened.command.includes('-J'), true)
  assert.equal(opened.command.includes('-p'), true)
  assert.equal(opened.command.at(-1), 'target.example')
  assert.match(opened.note, /CLI/)
})

test('availability 与未知数据版本', async (t) => {
  const f = fixture(t)
  const service = f.service()
  assert.equal((await service.availability()).available, true)
  const unavailable = f.service({ run: async () => ({ stdout: '', stderr: '', error: { code: 'ENOENT' } }) })
  assert.equal((await unavailable.availability()).available, false)

  await service.dispose()
  rmSync(join(f.data, 'connectivity.sqlite'), { force: true })
  const filename = join(f.data, 'connectivity.sqlite')
  const database = new DatabaseSync(filename)
  database.exec('CREATE TABLE profiles (id TEXT PRIMARY KEY); PRAGMA user_version = 2;')
  database.close()
  const broken = f.service()
  assert.throws(() => broken.list(), /数据格式版本 2 不受支持/)
})
