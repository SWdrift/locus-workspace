import assert from 'node:assert/strict'
import { createPrivateKey, generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { createLocusCore } from '@locus/core'
import { createDispatcher, InvocationFailure } from '@locus/core/invocation'
import { createMemoryCredentialProvider, createMemorySecurityStore } from '@locus/core/security'
import {
  component,
  createRemoteTargetsService,
  operations,
  targetBinding,
} from '../lib/index.js'

const { privateKey: PRIVATE_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
const ENCRYPTED_PRIVATE_KEY = createPrivateKey(PRIVATE_KEY).export({
  type: 'pkcs1',
  format: 'pem',
  cipher: 'aes-256-cbc',
  passphrase: 'encrypted-private-key-test-passphrase',
})

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
const preview = operation('rt.target.preview')
const migrationSource = operation('rt.target.migration-source')

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
    privateKey: PRIVATE_KEY,
  }, f.context({ id: 'target-a' }))
  assert.equal(created.id, 'target-a')
  assert.deepEqual(created.identity.auth, { method: 'private-key' })
  assert.equal(f.events.at(-1).type, 'locus.rt.target.registered')
  assert.deepEqual(f.events.at(-1).data, { target: 'target-a' })

  const config = readFileSync(join(f.targetsRoot, 'targets.yaml'), 'utf8')
  assert.match(config, /id: target-a/)
  assert.match(config, /method: private-key/)
  assert.equal(config.includes(PRIVATE_KEY), false)
  assert.equal(config.includes('credential:'), false)

  const stored = JSON.parse(await f.provider.get({ service: PROVIDER_SERVICE, account: 'ssh-private-key:target-a' }))
  assert.deepEqual(stored, { privateKey: PRIVATE_KEY })
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
    (error) => error instanceof InvocationFailure && error.code === 'not-found' && error.details.domain === 'target-not-found',
  )

  const trustFile = join(f.targetsRoot, 'trust', 'target-a', 'known_hosts')
  writeFileSync(trustFile, 'existing-trust-anchor\n', 'utf8')
  const removed = await remove.run(undefined, undefined, f.context({ id: 'target-a' }))
  assert.deepEqual(removed, { target: 'target-a', removed: true })
  assert.equal(f.events.at(-1).type, 'locus.rt.target.removed')
  assert.equal((await list.run(undefined, undefined, f.context())).length, 0)
  assert.equal(readFileSync(trustFile, 'utf8'), 'existing-trust-anchor\n')
  assert.deepEqual(
    JSON.parse(await f.provider.get({ service: PROVIDER_SERVICE, account: 'ssh-private-key:target-a' })),
    { privateKey: PRIVATE_KEY },
  )
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
      privateKey: PRIVATE_KEY,
    }, f.context({ id: 'target-a' })),
    (error) => error.code === 'invalid-argument' && error.details.domain === 'invalid-spec',
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
    (error) => error.code === 'conflict' && error.details.domain === 'already-migrated',
  )
})

test('目标配置变化后 job handler 在使用旧绑定时拒绝，且不启动传输', async (t) => {
  const f = fixture(t, { components: { openssh: { id: 'openssh', kind: 'external', state: 'healthy' } } })
  await register.run(undefined, {
    spec: JSON.stringify(privateKeySpec()),
    privateKey: PRIVATE_KEY,
  }, f.context({ id: 'target-a' }))

  const configFile = join(f.targetsRoot, 'targets.yaml')
  writeFileSync(configFile, readFileSync(configFile, 'utf8').replace('host: 127.0.0.1', 'host: attacker.example'), 'utf8')

  await assert.rejects(
    job.run(undefined, { command: ['whoami'] }, f.context({ id: 'target-a' })),
    (error) => error instanceof InvocationFailure && error.code === 'conflict' && error.details.domain === 'target-config-mismatch',
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

test('preview 规范化目标但不写定义、凭据或观察状态', async (t) => {
  const f = fixture(t)
  const context = f.context({ id: 'preview-only' })
  context.credential.read = async () => { throw new Error('预览不应读取凭据') }
  context.credential.write = async () => { throw new Error('预览不应写入凭据') }
  const result = await preview.run(undefined, { spec: JSON.stringify(privateKeySpec()) }, context)
  assert.equal(result.id, 'preview-only')
  assert.equal(result.connectivity.transport, 'ssh')
  assert.equal(result.connectivity.remoteShell, 'posix')
  assert.deepEqual(preview.output.parse(result), result)
  assert.equal(existsSync(f.targetsRoot), false)
  assert.equal(f.events.length, 0)
})

test('migration-source 只返回旧认证方式与本机路径，不读取秘密', async (t) => {
  const f = fixture(t)
  mkdirSync(f.targetsRoot)
  writeFileSync(join(f.targetsRoot, 'targets.yaml'), `version: 1
targets:
  - id: legacy
    resource:
      kind: server
    identity:
      login: root
      auth:
        method: key
        path: credentials/legacy/key
    connectivity:
      host: 127.0.0.1
`, 'utf8')
  const result = await migrationSource.run(undefined, undefined, f.context({ id: 'legacy' }))
  assert.deepEqual(result, { method: 'key', path: join(f.targetsRoot, 'credentials', 'legacy', 'key') })
  assert.deepEqual(migrationSource.output.parse(result), result)
  assert.equal(f.events.length, 0)
  assert.equal(existsSync(result.path), false)
})

for (const [name, op] of [
  ['register', register],
  ['update-credential', updateCredential],
  ['migrate', migrate],
]) {
  test(`${name} 直接调用也不能绕过私钥预检，失败不写凭据或改目标`, async (t) => {
    const f = fixture(t)
    const id = name === 'migrate' ? 'legacy' : 'current'
    if (name === 'update-credential') {
      const service = createRemoteTargetsService({ root: f.targetsRoot })
      try { service.add(id, privateKeySpec()) } finally { service.dispose() }
    } else if (name === 'migrate') {
      mkdirSync(f.targetsRoot)
      writeFileSync(join(f.targetsRoot, 'targets.yaml'), `version: 1
targets:
  - id: legacy
    resource:
      kind: server
    identity:
      login: root
      auth:
        method: key
        path: credentials/legacy/key
    connectivity:
      host: 127.0.0.1
`, 'utf8')
    }
    const file = join(f.targetsRoot, 'targets.yaml')
    const before = existsSync(file) ? readFileSync(file, 'utf8') : undefined
    for (const privateKey of ['invalid-private-key-sentinel', ENCRYPTED_PRIVATE_KEY]) {
      const input = name === 'register'
        ? { spec: JSON.stringify(privateKeySpec()), privateKey }
        : { method: 'private-key', privateKey }
      await assert.rejects(
        op.run(undefined, input, f.context({ id })),
        (error) => error instanceof InvocationFailure &&
          error.code === 'invalid-argument' &&
          error.details.domain === 'encrypted-key-unsupported' &&
          !error.message.includes(privateKey),
      )
    }
    assert.equal(existsSync(file) ? readFileSync(file, 'utf8') : undefined, before)
    assert.equal(await f.provider.get({ service: PROVIDER_SERVICE, account: `ssh-private-key:${id}` }), undefined)
    assert.equal(f.credentials.metadata.size, 0)
    assert.equal(f.events.length, 0)
  })
}

test('真实 Dispatcher 保留包内错误映射并拒绝外部 Body 凭据输入绕过', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'locus-rt-dispatch-'))
  let host
  const core = createLocusCore({
    dataDirectory: root,
    components: [{ component, operations }],
    security: {
      store: createMemorySecurityStore(),
      provider: createMemoryCredentialProvider(),
      receiveHost(value) { host = value },
    },
  })
  const session = host.createSession('human')
  const dispatcher = createDispatcher(core.router, host, session, core.events, core.dataDirectory)
  t.after(async () => {
    host.endSession(session)
    await core.dispose()
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const rootPassword = 'remote-targets-test-root'
  await host.initializeRoot(rootPassword, rootPassword)

  const previewResult = await dispatcher.invoke({
    method: 'POST',
    uri: 'rt://targets/new/actions/preview',
    contentType: 'application/json',
    body: { spec: JSON.stringify(privateKeySpec()) },
  })
  assert.equal(previewResult.ok, true)
  assert.equal(previewResult.data.id, 'new')
  assert.equal(existsSync(join(root, 'remote-targets')), false)

  const missing = await dispatcher.invoke({ method: 'GET', uri: 'rt://targets/missing' })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'not-found')
  assert.equal(missing.error.details.domain, 'target-not-found')

  const bypass = await dispatcher.invoke({
    method: 'PUT',
    uri: 'rt://targets/new',
    contentType: 'application/json',
    body: { spec: JSON.stringify(privateKeySpec()), privateKey: PRIVATE_KEY },
  })
  assert.equal(bypass.ok, false)
  assert.equal(bypass.error.code, 'invalid-body')
  assert.equal(JSON.stringify(bypass).includes(PRIVATE_KEY), false)

  const invalid = await dispatcher.invoke({
    method: 'PUT',
    uri: 'rt://targets/new',
    contentType: 'application/json',
    body: { spec: JSON.stringify(privateKeySpec()) },
  }, { privateKey: 'not-a-private-key' })
  assert.equal(invalid.ok, false)
  const challenge = invalid.error.details.challenge
  assert.ok(challenge)
  const rejected = await host.resume(await host.authenticate(challenge, rootPassword))
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.code, 'invalid-argument')
  assert.equal(rejected.error.details.domain, 'encrypted-key-unsupported')
  assert.equal(existsSync(join(root, 'remote-targets', 'targets.yaml')), false)
})
