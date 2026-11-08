import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { REMOTE_MACHINE_NAMESPACE } from '../../../packages/contracts/lib/index.js'
import { createRemoteMachineService } from '../lib/index.js'

function fixture(t) {
  const data = mkdtempSync(join(tmpdir(), 'locus-machine-'))
  const services = []
  t.after(async () => {
    await Promise.all(services.map((service) => service.dispose()))
    rmSync(data, { recursive: true, force: true })
  })
  return {
    data,
    service(run) {
      const service = createRemoteMachineService({ dataDirectory: data }, run === undefined ? {} : { run })
      services.push(service)
      return service
    },
  }
}

function successRunner(hostname = 'remote-host') {
  const calls = []
  return {
    calls,
    async run(args) {
      calls.push(args)
      if (args[0] === '-V') return { stdout: '', stderr: 'OpenSSH_9.5', error: null }
      return { stdout: `${hostname}\n`, stderr: '', error: null }
    },
  }
}

test('机器登记、多个地址与重启保持稳定 Identity', async (t) => {
  const f = fixture(t)
  const service = f.service(successRunner().run)
  const machine = service.register('Build Host', '离线登记')
  assert.equal(machine.id.length > 0, true)
  assert.equal(machine.description, '离线登记')
  assert.deepEqual(machine.addresses, [])
  assert.deepEqual(service.reference(machine.id), {
    namespace: REMOTE_MACHINE_NAMESPACE,
    id: machine.id,
  })

  const withSsh = service.addAddress(machine.id, {
    kind: 'ssh', value: 'build.example', port: 2222, label: 'primary',
  })
  const withHostname = service.addAddress(machine.id, { kind: 'hostname', value: 'build.example' })
  assert.equal(withHostname.addresses.length, 2)
  assert.equal(withHostname.addresses[0].id, withSsh.addresses[0].id)
  assert.equal(withHostname.addresses[0].port, 2222)
  const addressId = withHostname.addresses[0].id

  const renamed = service.update(machine.id, { name: 'Renamed', description: '' })
  assert.equal(renamed.id, machine.id)
  assert.equal(renamed.description, '')
  assert.equal(service.updateAddress(machine.id, addressId, { value: 'build.internal' }).addresses[0].value, 'build.internal')
  const withoutSsh = service.updateAddress(machine.id, addressId, { kind: 'hostname' })
  assert.equal(withoutSsh.addresses[0].kind, 'hostname')
  assert.equal(withoutSsh.addresses[0].port, undefined)
  const removed = service.removeAddress(machine.id, addressId)
  assert.equal(removed.id, machine.id)
  assert.equal(removed.addresses.length, 1)

  await service.dispose()
  const reopened = f.service(successRunner().run)
  const restored = reopened.get(machine.id)
  assert.equal(restored.id, machine.id)
  assert.equal(restored.name, 'Renamed')
  assert.equal(restored.addresses.length, 1)
})

test('同一地址可属于不同机器，不自动合并或推断身份', async (t) => {
  const f = fixture(t)
  const service = f.service(successRunner().run)
  const first = service.register('First')
  const second = service.register('Second')
  const firstWithAddress = service.addAddress(first.id, { kind: 'ip', value: '192.0.2.10' })
  const secondWithAddress = service.addAddress(second.id, { kind: 'ip', value: '192.0.2.10' })
  assert.equal(firstWithAddress.addresses[0].value, '192.0.2.10')
  assert.equal(secondWithAddress.addresses[0].value, '192.0.2.10')
  assert.notEqual(firstWithAddress.id, secondWithAddress.id)
  assert.equal(service.list().length, 2)
})

test('只读观察返回来源、时间和主机名，并只针对单个 SSH 地址', async (t) => {
  const f = fixture(t)
  const runner = successRunner('build-01')
  const service = f.service(runner.run)
  const machine = service.register('Build')
  const withAddress = service.addAddress(machine.id, {
    kind: 'ssh', value: 'build.example', port: 2222,
  })
  const address = withAddress.addresses[0]
  const observed = await service.observe(machine.id)

  assert.equal(observed.state, 'observed')
  assert.equal(observed.scope, 'single-address')
  assert.equal(observed.machineId, machine.id)
  assert.equal(observed.source.kind, 'ssh')
  assert.equal(observed.source.addressId, address.id)
  assert.equal(observed.source.endpoint, 'build.example')
  assert.equal(observed.source.port, 2222)
  assert.equal(observed.host.hostname, 'build-01')
  assert.match(observed.observedAt, /^\d{4}-\d{2}-\d{2}T/)
  const command = runner.calls.at(-1)
  assert.equal(command.at(-1), 'hostname')
  assert.equal(command.includes('BatchMode=yes'), true)
  assert.equal(command.includes('-p'), true)

  const hostnameOnly = service.addAddress(machine.id, { kind: 'hostname', value: 'build-alias' })
  const nonSsh = hostnameOnly.addresses.find((item) => item.kind === 'hostname')
  await assert.rejects(service.observe(machine.id, nonSsh.id), /不是 ssh 类型/)
  await assert.rejects(service.observe(machine.id, 'missing-address'), /不存在地址/)
})

test('观察失败区分不可用、拒绝、不可达与未知错误，不伪造主机信息', async (t) => {
  const cases = [
    [{ code: 'ENOENT' }, '', 'unavailable'],
    [{ code: 255 }, 'user@host: Permission denied (publickey).', 'denied'],
    [{ code: 255 }, 'Host key verification failed.', 'denied'],
    [{ code: 255 }, 'ssh: connect to host build.example port 22: Connection refused', 'unreachable'],
    [{ code: 255 }, 'some unexpected failure', 'error'],
  ]
  for (const [error, stderr, state] of cases) {
    const f = fixture(t)
    const service = f.service(async (args) => {
      if (args[0] === '-V') return { stdout: '', stderr: 'OpenSSH_9.5', error: null }
      return { stdout: '', stderr, error }
    })
    const machine = service.register(`Failure ${state}`)
    const withAddress = service.addAddress(machine.id, { kind: 'ssh', value: 'build.example' })
    const observed = await service.observe(machine.id)
    assert.equal(observed.state, state)
    assert.equal(observed.host, undefined)
    assert.equal(observed.source.addressId, withAddress.addresses[0].id)
    assert.equal(typeof observed.error, 'string')
  }
})

test('没有 SSH 时机器登记仍成立，能力可用性单独报告观察依赖', async (t) => {
  const f = fixture(t)
  const service = f.service(async () => ({ stdout: '', stderr: '', error: { code: 'ENOENT' } }))
  const machine = service.register('Offline')
  assert.equal(service.get(machine.id).id, machine.id)
  assert.equal((await service.availability()).available, false)
  assert.match((await service.availability()).error, /OpenSSH/)
})

test('地址输入拒绝非法类型、空白、选项注入与非 SSH 端口', async (t) => {
  const f = fixture(t)
  const service = f.service(successRunner().run)
  const machine = service.register('Validation')
  assert.throws(() => service.addAddress(machine.id, { kind: 'ssh', value: '-oProxyCommand=bad' }), /不能以 - 开头/)
  assert.throws(() => service.addAddress(machine.id, { kind: 'ssh', value: 'bad host' }), /不能包含空白/)
  assert.throws(() => service.addAddress(machine.id, { kind: 'ip', value: '192.0.2.10', port: 22 }), /只有 ssh/)
  assert.throws(() => service.register('   '), /必须是非空字符串/)
})

test('未知数据版本拒绝打开，不覆盖既有机器数据', async (t) => {
  const f = fixture(t)
  const filename = join(f.data, 'remote-machine.sqlite')
  const database = new DatabaseSync(filename)
  database.exec('CREATE TABLE machines (id TEXT PRIMARY KEY); PRAGMA user_version = 2;')
  database.close()

  const service = f.service(successRunner().run)
  assert.throws(() => service.list(), /数据格式版本 2 不受支持/)
})
