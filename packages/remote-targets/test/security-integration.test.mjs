import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createLocusCore, createMemoryCredentialProvider, createMemorySecurityStore } from '@locus/core'
import { api, component, createRemoteTargetsService, RemoteTargetsFailure, targetBinding } from '../lib/index.js'

const ROOT_PASSWORD = 'isolated-root'
const CREDENTIAL = 'credential:target-a'
const PRIVATE_KEY = 'isolated-key-material'
const RESOURCE_A = { type: 'remote-target', id: 'target-a' }

function targetSpec(credential = CREDENTIAL) {
  return { resource: { kind: 'server' }, identity: { login: 'controlled', auth: { method: 'private-key', credential } }, connectivity: { host: '127.0.0.1' } }
}

function passwordSpec(credential = 'credential:target-pw') {
  return {
    resource: { kind: 'server' },
    identity: { login: 'root', auth: { method: 'password', credential } },
    connectivity: { host: '10.0.0.1', port: 22, trust: { fingerprint: 'SHA256:pw' } },
  }
}

/** 把服务边界映射到组件能力：资源精确到目标，slot 决定 read 能力。 */
function accessPort(port) {
  return {
    withCredential(targetId, slot, credential, expectedBinding, consume) {
      return port.execute({
        capability: slot === 'ssh-password' ? 'password-access' : 'private-key-access',
        resource: { type: 'remote-target', id: targetId },
        parameters: null,
      }, (context, snapshot) => {
        assert.equal(Object.isFrozen(snapshot), true)
        assert.equal(snapshot.resource.type, 'remote-target')
        return context.withCredential(slot, credential, (values) => {
          if (values.targetBinding !== expectedBinding) {
            throw new RemoteTargetsFailure('target-config-mismatch', '测试目标配置已变化')
          }
          return consume(values)
        })
      })
    },
  }
}

function bindingText(binding) {
  return `${binding.componentId}:${binding.capability}:${binding.slot}:${binding.resource.type}/${binding.resource.id}`
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'locus-core-remote-'))
  const provider = createMemoryCredentialProvider()
  let host
  const core = createLocusCore({
    dataDirectory: join(root, 'data'),
    components: [component],
    security: { store: createMemorySecurityStore(), provider, receiveHost(value) { host = value } },
  })
  const session = host.createSession('agent')
  const port = host.bindComponent(session, component)
  async function privileged(operation) {
    try {
      return await operation()
    } catch (error) {
      if (error.code !== 'authentication-required') throw error
      assert.ok(error.challenge)
      return await host.resume(await host.authenticate(error.challenge, ROOT_PASSWORD))
    }
  }
  function register(capability, resource, input) {
    return privileged(() => port.execute({ capability, resource, parameters: {} }, (context) => api[capability](context, input)))
  }
  return {
    root,
    core,
    provider,
    host,
    session,
    port,
    register,
    initialize: () => host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD),
    close: async () => {
      host.endSession(session)
      await core.dispose()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

test('实际 Core 精确绑定目标、普通 User 不认证，缺失与权限拒绝分开', async (t) => {
  const f = fixture()
  let started = false
  const service = createRemoteTargetsService({
    root: join(f.root, 'targets'),
    security: accessPort(f.port),
    runner: { async run() { started = true; return { exitCode: 0, stdout: 'authorized-command', stderr: '' } }, async interactive() { started = true; return 0 } },
  })
  t.after(async () => { service.dispose(); await f.close() })
  service.add('target-a', targetSpec())
  service.add('target-b', targetSpec('credential:target-b'))

  await assert.rejects(() => service.exec('target-a', ['whoami']), (error) => error.code === 'security-uninitialized')
  await f.initialize()
  for (const operation of [() => service.probe('target-b'), () => service.exec('target-b', ['whoami']), () => service.shell('target-b')]) {
    await assert.rejects(operation, (error) => error.code === 'access-denied' && error.reason === 'credential-binding-mismatch')
  }

  const bindingA = targetBinding(service.show('target-a'))
  await f.register('register-private-key', RESOURCE_A, {
    credential: CREDENTIAL, targetBinding: bindingA, privateKey: PRIVATE_KEY,
  })
  const management = f.host.forSession(f.session)
  const bindings = await management.listBindings()
  assert.deepEqual(bindings.map(bindingText).sort(), [
    'remote-targets:private-key-access:ssh-private-key:remote-target/target-a',
    'remote-targets:register-private-key:ssh-private-key:remote-target/target-a',
  ])
  const [metadata] = await management.listCredentials()
  assert.equal(metadata?.reference, CREDENTIAL)
  assert.deepEqual(Object.keys(metadata?.fields ?? {}), ['targetBinding'])
  assert.equal(metadata.fields.targetBinding, bindingA)

  const installation = await f.core.security.status()
  const key = { service: `locus:${installation.installationId}:production`, account: 'target-a' }
  await f.provider.delete(key)
  await assert.rejects(() => service.exec('target-a', ['whoami']), (error) => error.code === 'credential-missing')
  assert.equal(started, false)

  await f.register('register-private-key', RESOURCE_A, {
    credential: CREDENTIAL, targetBinding: bindingA, privateKey: PRIVATE_KEY,
  })
  const result = await service.exec('target-a', ['whoami'])
  assert.equal(result.exitCode, 0)
  assert.equal(started, true)
})

test('目标安全配置变化后必须由 Root 重新登记绑定', async (t) => {
  const f = fixture()
  let started = false
  const service = createRemoteTargetsService({
    root: join(f.root, 'targets'),
    security: accessPort(f.port),
    runner: { async run() { started = true; return { exitCode: 0, stdout: 'authorized', stderr: '' } }, async interactive() { started = true; return 0 } },
  })
  t.after(async () => { service.dispose(); await f.close() })
  await f.initialize()
  service.add('target-a', targetSpec())
  const binding = targetBinding(service.show('target-a'))
  await f.register('register-private-key', RESOURCE_A, {
    credential: CREDENTIAL, targetBinding: binding, privateKey: PRIVATE_KEY,
  })
  const first = await service.exec('target-a', ['whoami'])
  assert.equal(first.exitCode, 0)
  assert.equal(started, true)

  started = false
  service.remove('target-a')
  service.add('target-a', {
    ...targetSpec(),
    connectivity: { ...targetSpec().connectivity, host: 'attacker.example' },
  })
  await assert.rejects(
    () => service.exec('target-a', ['whoami']),
    (error) => error instanceof RemoteTargetsFailure && error.code === 'target-config-mismatch',
  )
  assert.equal(started, false)

  // Root 重新登记新的目标摘要后才恢复；不是普通请求参数可以绕过。
  await f.register('register-private-key', RESOURCE_A, {
    credential: CREDENTIAL,
    targetBinding: targetBinding(service.show('target-a')),
    privateKey: PRIVATE_KEY,
  })
  const approved = await service.exec('target-a', ['whoami'])
  assert.equal(approved.exitCode, 0)
  assert.equal(started, true)
})

test('密码槽经 Core 绑定，合并后的 password 字段进入临时文件', async (t) => {
  const f = fixture()
  let delivered
  let started = false
  const service = createRemoteTargetsService({
    root: join(f.root, 'targets'),
    security: accessPort(f.port),
    runner: {
      async run(_command, args) {
        started = true
        delivered = readFileSync(args[args.indexOf('-pwfile') + 1], 'utf8')
        return { exitCode: 0, stdout: 'pw-ok', stderr: '' }
      },
      async interactive() { started = true; return 0 },
    },
  })
  t.after(async () => { service.dispose(); await f.close() })
  await f.initialize()
  service.add('target-pw', passwordSpec())

  await f.register('register-password', { type: 'remote-target', id: 'target-pw' }, {
    credential: 'credential:target-pw', targetBinding: targetBinding(service.show('target-pw')), password: 'pw-secret',
  })
  const bindings = await f.host.forSession(f.session).listBindings()
  assert.deepEqual(bindings.map(bindingText).sort(), [
    'remote-targets:password-access:ssh-password:remote-target/target-pw',
    'remote-targets:register-password:ssh-password:remote-target/target-pw',
  ])

  const result = await service.exec('target-pw', ['whoami'])
  assert.deepEqual(result, { targetId: 'target-pw', exitCode: 0, stdout: 'pw-ok', stderr: '' })
  assert.equal(started, true)
  assert.equal(delivered, 'pw-secret')
})

test('缺少 Core 授权入口时 probe/exec/shell 在执行前拒绝', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'locus-remote-security-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  let started = false
  const service = createRemoteTargetsService({ root, runner: { async run() { started = true; throw new Error('不应启动') }, async interactive() { started = true; throw new Error('不应启动') } } })
  t.after(() => service.dispose())
  service.add('target-a', targetSpec())
  for (const operation of [() => service.probe('target-a'), () => service.exec('target-a', ['whoami']), () => service.shell('target-a')]) {
    await assert.rejects(operation, (error) => error.code === 'access-denied')
  }
  assert.equal(started, false)
})
