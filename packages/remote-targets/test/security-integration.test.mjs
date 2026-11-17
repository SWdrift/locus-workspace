import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { createMemoryCredentialProvider } from '@locus/core'
import {
  createRemoteTargetsService,
  operations,
  RemoteTargetsFailure,
  targetBinding,
} from '../lib/index.js'

function operation(id) {
  const found = operations.find((item) => item.id === id)
  assert.ok(found, `缺少 operation：${id}`)
  return found
}

const register = operation('rt.target.register')
const get = operation('rt.target.get')
const list = operation('rt.targets.list')
const remove = operation('rt.target.remove')
const updateCredential = operation('rt.target.credential.update')
const migrate = operation('rt.target.migrate')
const job = operation('rt.job.run')

function privateKeySpec(connectivity = {}) {
  return {
    resource: { kind: 'server' },
    identity: { login: 'root', auth: { method: 'private-key' } },
    connectivity: { host: '127.0.0.1', port: 2200, ...connectivity },
  }
}

function passwordSpec(connectivity = {}) {
  return {
    resource: { kind: 'server' },
    identity: { login: 'root', auth: { method: 'password' } },
    connectivity: { host: '10.0.0.1', port: 22, trust: { fingerprint: 'SHA256:pw' }, ...connectivity },
  }
}

const PROVIDER_SERVICE = 'locus:test-installation:production'

function missingCredential() {
  const error = new Error('测试凭据缺失')
  error.code = 'credential-missing'
  return error
}

/** 按组件凭据声明拆分为秘密与元数据，模拟 Core 的 credential 端口。 */
function credentialPort(provider) {
  const metadata = new Map()
  const keyOf = (credential, resourceKey) => `${credential.id}:${resourceKey}`
  return {
    metadata,
    async read(credential, resourceKey, consume) {
      const key = keyOf(credential, resourceKey)
      const fields = metadata.get(key)
      if (fields === undefined) throw missingCredential()
      const raw = await provider.get({ service: PROVIDER_SERVICE, account: key })
      if (raw === undefined) throw missingCredential()
      return consume({ ...fields, ...JSON.parse(raw) })
    },
    async write(credential, resourceKey, values) {
      const key = keyOf(credential, resourceKey)
      const fields = {}
      const secrets = {}
      for (const [name, value] of Object.entries(values)) {
        if (value === undefined) continue
        if (credential.secretFields.includes(name)) secrets[name] = value
        else fields[name] = value
      }
      metadata.set(key, fields)
      await provider.set({ service: PROVIDER_SERVICE, account: key }, JSON.stringify(secrets))
      return `credential:${resourceKey}`
    },
  }
}

function fixture(t, { components = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'locus-rt-op-'))
  const provider = createMemoryCredentialProvider()
  const credentials = credentialPort(provider)
  const events = []
  t.after(() => {
    provider.dispose()
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const context = (pathParams = {}) => ({
    dataDirectory: root,
    url: { pathParams },
    components: { get: (id) => components[id] },
    credential: credentials,
    emit(type, data) {
      events.push({ type, data })
    },
  })
  const targetsRoot = join(root, 'remote-targets')
  return { root, provider, credentials, events, context, targetsRoot }
}

test('register 写目标与凭据材料，秘密只在 provider，list/get/remove 通过 handler', async (t) => {
  const f = fixture(t, { components: { openssh: { id: 'openssh', kind: 'external', state: 'healthy' } } })

  const created = await register.run(undefined, {
    spec: JSON.stringify(privateKeySpec()),
    privateKey: 'private-key-material',
  }, f.context({ id: 'target-a' }))
  assert.equal(created.id, 'target-a')
  assert.deepEqual(created.identity.auth, { method: 'private-key' })
  assert.equal(f.events.at(-1).type, 'locus.rt.target.registered')
  assert.deepEqual(f.events.at(-1).data, { target: 'target-a' })

  const config = readFileSync(join(f.targetsRoot, 'targets.yaml'), 'utf8')
  assert.match(config, /id: target-a/)
  assert.match(config, /method: private-key/)
  assert.equal(config.includes('private-key-material'), false)
  assert.equal(config.includes('credential:'), false)

  const stored = JSON.parse(await f.provider.get({ service: PROVIDER_SERVICE, account: 'ssh-private-key:target-a' }))
  assert.deepEqual(stored, { privateKey: 'private-key-material' })
  const metadata = f.credentials.metadata.get('ssh-private-key:target-a')
  assert.deepEqual(Object.keys(metadata), ['targetBinding'])
  assert.equal(metadata.targetBinding, targetBinding(created))
  assert.match(metadata.targetBinding, /^[a-f0-9]{64}$/)

  const listed = await list.run(undefined, undefined, f.context())
  assert.deepEqual(listed.map((target) => target.id), ['target-a'])
  const shown = await get.run(undefined, undefined, f.context({ id: 'target-a' }))
  assert.equal(shown.id, 'target-a')
  await assert.rejects(
    async () => get.run(undefined, undefined, f.context({ id: 'missing' })),
    (error) => error.code === 'target-not-found',
  )

  const removed = await remove.run(undefined, undefined, f.context({ id: 'target-a' }))
  assert.deepEqual(removed, { target: 'target-a', removed: true })
  assert.equal(f.events.at(-1).type, 'locus.rt.target.removed')
  assert.equal((await list.run(undefined, undefined, f.context())).length, 0)
})

test('register 缺少秘密或使用旧契约字段时拒绝且不落盘', async (t) => {
  const f = fixture(t)

  await assert.rejects(
    register.run(undefined, { spec: JSON.stringify(privateKeySpec()) }, f.context({ id: 'target-a' })),
    (error) => error.code === 'invalid-argument',
  )
  await assert.rejects(
    register.run(undefined, {
      spec: JSON.stringify({
        ...privateKeySpec(),
        identity: { login: 'root', auth: { method: 'private-key', credential: 'credential:key' } },
      }),
      privateKey: 'private-key-material',
    }, f.context({ id: 'target-a' })),
    (error) => error.code === 'invalid-spec',
  )
  assert.equal(existsSync(join(f.targetsRoot, 'targets.yaml')), false)
  assert.equal(f.events.length, 0)
})

test('密码目标登记与 credential.update 只改写秘密，不改变目标配置', async (t) => {
  const f = fixture(t)
  const created = await register.run(undefined, {
    spec: JSON.stringify(passwordSpec()),
    password: 'password-one',
  }, f.context({ id: 'pw' }))
  assert.deepEqual(created.identity.auth, { method: 'password' })
  const configFile = join(f.targetsRoot, 'targets.yaml')
  const config = readFileSync(configFile, 'utf8')
  assert.equal(config.includes('password-one'), false)

  await assert.rejects(
    updateCredential.run(undefined, { method: 'private-key', privateKey: 'key' }, f.context({ id: 'pw' })),
    (error) => error.code === 'invalid-argument',
  )

  const updated = await updateCredential.run(undefined, { method: 'password', password: 'password-two' }, f.context({ id: 'pw' }))
  assert.deepEqual(updated, { target: 'pw', method: 'password', updated: true })
  assert.equal(f.events.at(-1).type, 'locus.rt.credential.updated')
  assert.deepEqual(
    JSON.parse(await f.provider.get({ service: PROVIDER_SERVICE, account: 'ssh-password:pw' })),
    { password: 'password-two' },
  )
  assert.equal(readFileSync(configFile, 'utf8'), config)
})

test('migrate 从旧文件认证写入 Core 凭据并改写目标，旧文件保留', async (t) => {
  const f = fixture(t)
  const legacyFile = join(f.targetsRoot, 'credentials', 'legacy', 'password')
  mkdirSync(dirname(legacyFile), { recursive: true })
  writeFileSync(legacyFile, 'legacy-secret', 'utf8')
  writeFileSync(join(f.targetsRoot, 'targets.yaml'), `version: 1
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
      remoteShell: posix
`, 'utf8')

  const migrated = await migrate.run(undefined, { method: 'password', password: 'new-secret' }, f.context({ id: 'legacy' }))
  assert.deepEqual(migrated.identity.auth, { method: 'password' })
  assert.equal(f.events.at(-1).type, 'locus.rt.target.migrated')
  assert.deepEqual(
    JSON.parse(await f.provider.get({ service: PROVIDER_SERVICE, account: 'ssh-password:legacy' })),
    { password: 'new-secret' },
  )
  assert.equal(readFileSync(legacyFile, 'utf8'), 'legacy-secret')
  const config = readFileSync(join(f.targetsRoot, 'targets.yaml'), 'utf8')
  assert.equal(config.includes('path: credentials/legacy/password'), false)
  assert.equal(config.includes('new-secret'), false)

  await assert.rejects(
    migrate.run(undefined, { method: 'password', password: 'again' }, f.context({ id: 'legacy' })),
    (error) => error.code === 'already-migrated',
  )
})

test('目标配置变化后 job handler 在使用旧绑定时拒绝，且不启动传输', async (t) => {
  const f = fixture(t, { components: { openssh: { id: 'openssh', kind: 'external', state: 'healthy' } } })
  await register.run(undefined, {
    spec: JSON.stringify(privateKeySpec()),
    privateKey: 'private-key-material',
  }, f.context({ id: 'target-a' }))

  const configFile = join(f.targetsRoot, 'targets.yaml')
  writeFileSync(configFile, readFileSync(configFile, 'utf8').replace('host: 127.0.0.1', 'host: attacker.example'), 'utf8')

  await assert.rejects(
    job.run(undefined, { command: ['whoami'] }, f.context({ id: 'target-a' })),
    (error) => error instanceof RemoteTargetsFailure && error.code === 'target-config-mismatch',
  )
})

test('凭据缺失时 job/system/services/restart handler 在启动传输前失败', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'locus-rt-missing-'))
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const service = createRemoteTargetsService({ root: join(root, 'remote-targets') })
  t.after(() => service.dispose())
  service.add('win-x', {
    resource: { kind: 'windows-device' },
    identity: { login: 'Administrator', auth: { method: 'private-key' } },
    connectivity: { host: '127.0.0.1' },
  })

  const provider = createMemoryCredentialProvider()
  t.after(() => provider.dispose())
  const events = []
  const context = (pathParams) => ({
    dataDirectory: root,
    url: { pathParams },
    components: { get: () => undefined },
    credential: credentialPort(provider),
    emit(type, data) { events.push({ type, data }) },
  })

  for (const [op, input] of [
    [job, { command: ['whoami'] }],
    [operation('rt.system.read'), undefined],
    [operation('rt.services.list'), undefined],
    [operation('rt.service.restart'), undefined],
  ]) {
    await assert.rejects(
      op.run(undefined, input, context({ id: 'win-x' })),
      (error) => error.code === 'credential-missing',
    )
  }
  assert.equal(events.length, 0)
})
