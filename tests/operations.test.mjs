import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { createLocusCore } from '../packages/core/lib/index.js'
import { createOperationCatalog } from '../packages/operations/lib/index.js'
import * as host from '../packages/host-dsh/lib/index.js'
import { createConnectivityService } from '../plugins/connectivity/lib/index.js'
import { registerConnectivityOperations } from '../plugins/connectivity/lib/contract.js'
import { createRemoteMachineService } from '../plugins/remote-machine/lib/index.js'
import { registerRemoteMachineOperations } from '../plugins/remote-machine/lib/contract.js'
import * as remoteMachineContract from '../plugins/remote-machine/lib/contract.js'
import * as remoteMachinePlugin from '../plugins/remote-machine/lib/index.js'

const require = createRequire(new URL('../packages/host-dsh/package.json', import.meta.url))
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)

function tempRoot(prefix) {
  return mkdtempSync(join(tmpdir(), prefix))
}

function servicesFor(t) {
  const root = tempRoot('locus-operations-')
  const data = join(root, 'data')
  const core = createLocusCore({ dataDirectory: data })
  const remoteMachine = createRemoteMachineService(core, {
    run: async (args) => {
      if (args[0] === '-V') return { stdout: '', stderr: 'OpenSSH_9.5', error: null }
      return { stdout: 'remote-host\n', stderr: '', error: null }
    },
  })
  const connectivity = createConnectivityService(core, remoteMachine, {
    run: async (args) => {
      if (args[0] === '-V') return { stdout: '', stderr: 'OpenSSH_9.5', error: null }
      return { stdout: 'remote-host\n', stderr: '', error: null }
    },
  })
  t.after(async () => {
    await connectivity.dispose()
    await remoteMachine.dispose()
    await core.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  return { core, remoteMachine, connectivity }
}

function catalogFor(services) {
  const catalog = createOperationCatalog({
    isCapabilitySelected: (workspaceId, capability) => {
      try {
        return services.core.workspaces.get(workspaceId).capabilities.some((entry) =>
          entry.id === capability.id && entry.provider === capability.provider)
      } catch {
        return false
      }
    },
  })
  registerRemoteMachineOperations(catalog, () => services.remoteMachine)
  registerConnectivityOperations(catalog, () => services.connectivity)
  return catalog
}

test('非 CLI 消费方读取同一契约并区分 Outcome、输入错误与能力未选择', async (t) => {
  const services = servicesFor(t)
  const catalog = catalogFor(services)
  assert.deepEqual(
    catalog.list().map((definition) => definition.id),
    ['connect.verify', 'machine.observe'],
  )

  const machine = services.remoteMachine.register('Build Host')
  services.remoteMachine.addAddress(machine.id, { kind: 'ssh', value: 'build.example' })
  const observed = await catalog.invoke('machine.observe', { machine: machine.id })
  assert.equal(observed.ok, true)
  assert.equal(observed.value.state, 'observed')
  assert.equal(observed.value.host.hostname, 'remote-host')

  const profile = services.connectivity.add(machine.id, {
    name: 'direct',
    transport: 'direct',
    target: 'build.example',
  })
  const verified = await catalog.invoke('connect.verify', { profile: profile.id })
  assert.equal(verified.ok, true)
  assert.equal(verified.value.state, 'connected')

  const invalid = await catalog.invoke('machine.observe', {})
  assert.equal(invalid.ok, false)
  assert.equal(invalid.error.code, 'invalid-input')
  assert.equal(invalid.error.details.some((detail) => detail.includes('/machine')), true)

  const workspace = services.core.workspaces.create('Contract Workspace')
  const unselected = await catalog.invoke('machine.observe', { machine: machine.id }, {
    workspaceId: workspace.id,
  })
  assert.equal(unselected.ok, false)
  assert.equal(unselected.error.code, 'capability-not-selected')

  services.core.workspaces.configureCapability(workspace.id, services.remoteMachine.capability)
  const selected = await catalog.invoke('machine.observe', { machine: machine.id }, {
    workspaceId: workspace.id,
  })
  assert.equal(selected.ok, true)
})

test('Contract 插件安装 Definition；Provider 插件卸载后仍可发现并明确失败', async (t) => {
  const previous = process.env.LOCUS_HOME
  const root = tempRoot('locus-cordis-operations-')
  process.env.LOCUS_HOME = join(root, 'data')
  const ctx = new Context()
  let plugin
  try {
    await ctx.plugin(host)
    await ctx.plugin(remoteMachineContract)
    const catalog = ctx.get('locusOperations')
    assert.equal(ctx.get('locusRemoteMachine'), undefined)
    assert.deepEqual(catalog.list().map((definition) => definition.id), ['machine.observe'])

    const missing = await catalog.invoke('machine.observe', { machine: 'machine-1' })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'provider-missing')

    plugin = ctx.plugin(remoteMachinePlugin)
    await plugin
    const service = ctx.get('locusRemoteMachine')
    const machine = service.register('Cordis Host')
    const invalid = await catalog.invoke('machine.observe', {})
    assert.equal(invalid.error.code, 'invalid-input')

    await plugin.dispose()
    plugin = undefined
    assert.equal(ctx.get('locusRemoteMachine'), undefined)
    const unavailable = await catalog.invoke('machine.observe', { machine: machine.id })
    assert.equal(unavailable.ok, false)
    assert.equal(unavailable.error.code, 'provider-missing')
  } finally {
    await plugin?.dispose()
    await ctx.fiber.dispose()
    rmSync(root, { recursive: true, force: true })
    if (previous === undefined) delete process.env.LOCUS_HOME
    else process.env.LOCUS_HOME = previous
  }
})
