import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { z } from 'zod'
import { createLocusCore } from '../lib/index.js'
import { defineComponent } from '../lib/components/index.js'
import { defineCredential, defineOperation, DomainFailure, InvocationFailure } from '../lib/invocation/index.js'
import { createMemoryCredentialProvider, createMemorySecurityStore, createSqliteSecurityStore, SecurityFailure } from '../lib/security/index.js'
import { bindTrustedComponent } from '../lib/security/policy.js'

const ROOT_PASSWORD = 'Root-安全运行时测试-2026'
const SECRET = 'credential-secret-不得泄露'

const auth = defineCredential({
  id: 'database-auth',
  fields: [
    { name: 'username', secret: false, required: true },
    { name: 'password', secret: true, required: true },
    { name: 'remark', secret: false, required: false },
  ],
})

function secureComponent() {
  const write = defineOperation({
    id: 'secure.write', method: 'PUT', scheme: 'secure', authority: 'items', path: '/:id', auth: 'root',
    input: z.object({ value: z.string() }), output: z.string(),
    async run(_query, input, context) {
      return context.credential.write(auth, context.url.pathParams.id, {
        username: 'app',
        password: input.value,
      })
    },
  })
  const read = defineOperation({
    id: 'secure.read', method: 'GET', scheme: 'secure', authority: 'items', path: '/:id', auth: 'user',
    input: z.undefined(), output: z.object({ password: z.string() }),
    async run(_query, _input, context) {
      return context.credential.read(auth, context.url.pathParams.id, (values) => ({ password: values.password }))
    },
  })
  const erase = defineOperation({
    id: 'secure.erase', method: 'DELETE', scheme: 'secure', authority: 'items', path: '/:id', auth: 'user',
    input: z.undefined(), output: z.boolean(),
    async run(_query, _input, context) {
      await context.credential.write(auth, context.url.pathParams.id, { username: 'app', password: 'x' })
      return true
    },
  })
  const admin = defineOperation({
    id: 'secure.admin', method: 'POST', scheme: 'secure', authority: 'actions', path: '/admin', auth: 'root',
    input: z.undefined(), output: z.string(),
    run: () => 'admin-done',
  })
  const user = defineOperation({
    id: 'secure.user', method: 'POST', scheme: 'secure', authority: 'actions', path: '/user', auth: 'user',
    input: z.undefined(), output: z.string(),
    run: () => 'user-done',
  })
  const secondCredential = defineCredential({
    id: 'other-auth',
    fields: [{ name: 'value', secret: true, required: true }],
  })
  const cross = defineOperation({
    id: 'secure.cross', method: 'POST', scheme: 'secure', authority: 'actions', path: '/cross', auth: 'user',
    input: z.undefined(), output: z.string(),
    async run(_query, _input, context) {
      return context.credential.read(secondCredential, 'alpha', (values) => values.value)
    },
  })
  return defineComponent({
    id: 'secure',
    version: '1',
    name: 'secure',
    summary: '安全运行时测试组件',
    kind: 'locus',
    operations: [write, read, erase, admin, user, cross],
    credentials: [auth, secondCredential],
  })
}

async function fixture(t, { sqlite = false, clock = Date.now } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'locus-security-'))
  let host
  const provider = createMemoryCredentialProvider()
  const core = createLocusCore({
    dataDirectory: directory,
    components: [secureComponent()],
    security: {
      store: sqlite ? createSqliteSecurityStore(directory) : createMemorySecurityStore(),
      provider,
      clock,
      receiveHost(value) { host = value },
    },
  })
  const session = host.createSession('human')
  const port = host.bindComponent(session, 'secure')
  t.after(async () => {
    try { host.endSession(session) } catch { /* 已结束 */ }
    await core.dispose()
    rmSync(directory, { recursive: true, force: true })
  })
  return { core, host, session, port, provider }
}

function request(operation, parameters = null) {
  return { component: 'secure', operation, parameters }
}

async function authorize(host, challenge, password = ROOT_PASSWORD, scope = 'operation') {
  return host.authenticate(challenge, password, scope)
}

test('安全绑定复制完整 operation 描述与字段，并拒绝非法来源标记', () => {
  const fields = {
    privateKey: { description: '可信私钥输入，不包含私钥值。', required: true, secret: true, tty: true, file: true },
  }
  const operation = {
    id: 'secure.describe',
    summary: '安全绑定使用公开声明快照。',
    method: 'POST',
    scheme: 'secure',
    authority: 'items',
    path: '',
    auth: 'root',
    fields,
  }
  const component = {
    id: 'secure', version: '1', name: 'secure', summary: '可信组件。', kind: 'locus', operations: [operation],
  }
  const bound = bindTrustedComponent(component)
  assert.deepEqual(bound.operations, [operation])
  assert.equal(Object.isFrozen(bound.operations[0]), true)
  assert.equal(Object.isFrozen(bound.operations[0].fields), true)
  assert.equal(Object.isFrozen(bound.operations[0].fields.privateKey), true)
  assert.notEqual(bound.operations[0].fields, fields)
  operation.summary = '后来修改的说明。'
  fields.privateKey.file = false
  assert.equal(bound.operations[0].summary, '安全绑定使用公开声明快照。')
  assert.equal(bound.operations[0].fields.privateKey.file, true)
  for (const extra of [
    { summary: 42 },
    { fields: { privateKey: { file: true } } },
    { fields: { privateKey: { tty: true, value: SECRET } } },
  ]) {
    assert.throws(
      () => bindTrustedComponent({ ...component, operations: [{ ...operation, ...extra }] }),
      (error) => error instanceof SecurityFailure && error.reason === 'invalid-request' && !String(error).includes(SECRET),
    )
  }
})

test('未初始化时 user 可运行，root 明确失败；初始化不可覆盖', async (t) => {
  const { core, host, port, session } = await fixture(t)
  assert.equal(await port.execute(request('secure.user'), () => 'ok'), 'ok')
  await assert.rejects(
    port.execute(request('secure.admin'), () => 'never'),
    (error) => error instanceof SecurityFailure && error.code === 'security-uninitialized',
  )
  await host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD)
  const status = await core.security.status()
  assert.equal(status.initialized, true)
  await assert.rejects(
    host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD),
    (error) => error instanceof SecurityFailure && error.code === 'security-already-initialized',
  )
  const management = host.forSession(session)
  assert.equal((await management.listCredentials()).length, 0)
})

test('Root 操作创建一次 Challenge，错误密码不执行，正确密码单次消费', async (t) => {
  const { host, port } = await fixture(t)
  await host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD)
  let executed = false
  const pending = port.execute(request('secure.admin'), () => {
    executed = true
    return 'admin-done'
  })
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'authentication-required')
    assert.equal(error.challenge.componentId, 'secure')
    assert.equal(error.challenge.operation, 'secure.admin')
    return true
  })
  assert.equal(executed, false)

  const challenge = await pending.catch((error) => error.challenge)
  await assert.rejects(
    host.authenticate(challenge, 'wrong-password'),
    (error) => error instanceof SecurityFailure && error.code === 'authentication-failed',
  )
  const grant = await authorize(host, challenge)
  assert.equal(await host.resume(grant), 'admin-done')
  assert.equal(executed, true)
  await assert.rejects(host.resume(grant), (error) => error.code === 'grant-consumed')
})

test('并发 resume 只消费一次', async (t) => {
  const { host, port } = await fixture(t)
  await host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD)
  const challenge = await port.execute(request('secure.admin'), () => 'once').catch((error) => error.challenge)
  const grant = await authorize(host, challenge)
  const settled = await Promise.allSettled([host.resume(grant), host.resume(grant)])
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1)
  assert.equal(settled.filter((item) => item.status === 'rejected').length, 1)
})

test('Session Grant 在同一 Session 复用，结束 Session 后失效', async (t) => {
  const { host, port, session } = await fixture(t)
  await host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD)
  const challenge = await port.execute(request('secure.admin'), () => 'first').catch((error) => error.challenge)
  const grant = await authorize(host, challenge, ROOT_PASSWORD, 'session')
  assert.equal(await host.resume(grant), 'first')
  assert.equal(await port.execute(request('secure.admin'), () => 'second'), 'second')

  host.endSession(session)
  await assert.rejects(
    port.execute(request('secure.admin'), () => 'third'),
    (error) => error.code === 'access-denied' && error.reason === 'session-ended',
  )
})

test('Root 覆盖改变 operation 等级；降级写入被拒，清除恢复声明', async (t) => {
  const { host, session, port } = await fixture(t)
  await host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD)
  const management = host.forSession(session)
  const downgraded = await management.setOperationLevel({ componentId: 'secure', operation: 'secure.write', level: 'user' })
  assert.equal(downgraded.effectiveAuthLevel, 'user')
  assert.equal(downgraded.source, 'override')
  await assert.rejects(
    port.execute(request('secure.write'), async (credential) => credential.write('database-auth', 'alpha', {
      username: 'app', password: SECRET,
    })),
    (error) => error.code === 'access-denied' && error.reason === 'credential-write-requires-root',
  )

  const cleared = await management.clearOperationLevel({ componentId: 'secure', operation: 'secure.write' })
  assert.equal(cleared.effectiveAuthLevel, 'root')
  assert.equal(cleared.source, 'operation')

  const upgraded = await management.setOperationLevel({ componentId: 'secure', operation: 'secure.read', level: 'root' })
  assert.equal(upgraded.effectiveAuthLevel, 'root')
  const challenge = await port.execute(request('secure.read'), () => 'x').catch((error) => error.challenge)
  assert.ok(challenge)
})

test('凭据按 component + slot + resourceKey 绑定；缺失不调用 consume；跨槽拒绝', async (t) => {
  const { host, port } = await fixture(t)
  await host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD)
  const writeChallenge = await port.execute(request('secure.write'), async (credential) => (
    credential.write('database-auth', 'alpha', { username: 'app', password: SECRET })
  )).catch((error) => error.challenge)
  const writeGrant = await authorize(host, writeChallenge)
  const reference = await host.resume(writeGrant)
  assert.match(reference, /^credential:/)

  const values = await port.execute(request('secure.read'), async (credential) => (
    credential.read('database-auth', 'alpha', (input) => input)
  ))
  assert.equal(values.password, SECRET)
  assert.equal(values.username, 'app')

  let consumed = false
  await assert.rejects(
    port.execute(request('secure.read'), (credential) => credential.read('database-auth', 'missing', () => {
      consumed = true
      return 'never'
    })),
    (error) => error instanceof SecurityFailure && error.code === 'credential-missing',
  )
  assert.equal(consumed, false)

  await assert.rejects(
    port.execute(request('secure.cross'), (credential) => credential.read('other-auth', 'alpha', (input) => input.value)),
    (error) => error instanceof SecurityFailure && error.code === 'credential-missing',
  )
})

test('公开字段进入元数据，秘密字段只进入 Provider', async (t) => {
  const { host, port, session } = await fixture(t)
  await host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD)
  const challenge = await port.execute(request('secure.write'), async (credential) => (
    credential.write('database-auth', 'meta', { username: 'public-user', password: SECRET, remark: 'note' })
  )).catch((error) => error.challenge)
  const reference = await host.resume(await authorize(host, challenge))

  const management = host.forSession(session)
  const [metadata] = (await management.listCredentials()).filter((item) => item.reference === reference)
  assert.deepEqual(metadata.fields, { username: 'public-user', remark: 'note' })
  assert.equal(JSON.stringify(metadata).includes(SECRET), false)
  const [binding] = (await management.listBindings()).filter((item) => item.reference === reference)
  assert.equal(binding.componentId, 'secure')
  assert.equal(binding.slot, 'database-auth')
  assert.equal(binding.resourceKey, 'meta')
})

test('Root 重置递增世代并撤销待处理 Challenge 与 Grant', async (t) => {
  const { host, port } = await fixture(t)
  await host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD)
  const challenge = await port.execute(request('secure.admin'), () => 'never').catch((error) => error.challenge)
  const grant = await authorize(host, challenge)
  await host.resetRoot('Root-重置后-2026', 'Root-重置后-2026')
  await assert.rejects(host.resume(grant), (error) => error.code === 'grant-revoked')

  const nextChallenge = await port.execute(request('secure.admin'), () => 'never').catch((error) => error.challenge)
  await assert.rejects(
    host.authenticate(nextChallenge, ROOT_PASSWORD),
    (error) => error.code === 'authentication-failed',
  )
})

test('Provider 失败只暴露固定分类，不透传原始异常', async (t) => {
  const { host, port, provider } = await fixture(t)
  await host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD)
  const challenge = await port.execute(request('secure.write'), async (credential) => (
    credential.write('database-auth', 'alpha', { username: 'app', password: SECRET })
  )).catch((error) => error.challenge)
  provider.set = async () => { throw new Error(`provider failure ${SECRET}`) }
  const grant = await authorize(host, challenge)
  await assert.rejects(host.resume(grant), (error) => (
    error instanceof SecurityFailure && error.code === 'provider-unavailable' && !String(error).includes(SECRET)
  ))
})

test('自造 Session 与未登记组件不能取得端口', async (t) => {
  const { host } = await fixture(t)
  const forged = { sessionId: 'forged', userId: 'user', source: 'human', startedAt: 0, endedAt: undefined, active: true }
  assert.throws(() => host.bindComponent(forged, 'secure'), (error) => error.code === 'access-denied')
  const session = host.createSession('human')
  assert.throws(() => host.bindComponent(session, 'missing'), (error) => error.code === 'access-denied')
  host.endSession(session)
})

for (const sqlite of [false, true]) {
  test(`${sqlite ? 'SQLite' : '内存'} Store 下超长资源 key 是输入错误，边界 key 可读写`, async (t) => {
    const { host, port, session } = await fixture(t, { sqlite })
    await host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD)
    const invalidKey = 'x'.repeat(2049)
    const invalidResource = (error) => (
      error instanceof SecurityFailure && error.code === 'access-denied' && error.reason === 'invalid-resource-key'
    )
    let consumed = false
    await assert.rejects(
      port.execute(request('secure.read'), (credential) => credential.read('database-auth', invalidKey, () => {
        consumed = true
      })),
      invalidResource,
    )
    assert.equal(consumed, false)

    const challenge = await port.execute(request('secure.write'), (credential) => (
      credential.write('database-auth', invalidKey, { username: 'app', password: SECRET })
    )).catch((error) => error.challenge)
    await assert.rejects(host.resume(await authorize(host, challenge)), invalidResource)
    const management = host.forSession(session)
    assert.equal((await management.listCredentials()).length, 0)
    assert.equal((await management.listBindings()).length, 0)
    await assert.rejects(management.unbindCredential({
      componentId: 'secure', slot: 'database-auth', resourceKey: invalidKey,
    }), invalidResource)

    const boundaryKey = 'x'.repeat(2048)
    const validChallenge = await port.execute(request('secure.write'), (credential) => (
      credential.write('database-auth', boundaryKey, { username: 'app', password: SECRET })
    )).catch((error) => error.challenge)
    const reference = await host.resume(await authorize(host, validChallenge))
    assert.match(reference, /^credential:/)
    assert.equal(await port.execute(request('secure.read'), (credential) => (
      credential.read('database-auth', boundaryKey, (values) => values.password)
    )), SECRET)
  })
}

test('可信协议错误穿透；伪造同名错误不能泄漏回调秘密', async (t) => {
  const { host, port } = await fixture(t)
  await host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD)
  const failures = [
    new DomainFailure('demo-domain', '可展示的领域错误'),
    new InvocationFailure('not-found', '可展示的协议错误', { component: 'secure' }),
  ]
  for (const error of failures) {
    await assert.rejects(port.execute(request('secure.user'), () => { throw error }), (value) => value === error)
    const challenge = await port.execute(request('secure.admin'), () => { throw error }).catch((value) => value.challenge)
    await assert.rejects(host.resume(await authorize(host, challenge)), (value) => value === error)
  }

  const writeChallenge = await port.execute(request('secure.write'), (credential) => (
    credential.write('database-auth', 'callback', { username: 'app', password: SECRET })
  )).catch((error) => error.challenge)
  await host.resume(await authorize(host, writeChallenge))
  for (const name of ['InvocationFailure', 'ComponentFailure', 'DomainFailure']) {
    const forged = Object.assign(new Error(SECRET), { name, code: 'not-found', details: { leaked: SECRET } })
    const sanitized = (error) => (
      error instanceof SecurityFailure && error.code === 'operation-failed' &&
      !String(error).includes(SECRET) && error.cause === undefined && error.details === undefined
    )
    await assert.rejects(port.execute(request('secure.user'), () => { throw forged }), sanitized)
    await assert.rejects(port.execute(request('secure.read'), (credential) => (
      credential.read('database-auth', 'callback', () => { throw forged })
    )), sanitized)
  }
})

test('提取后的 Root 认证仍拒绝并发挑战，锁定次数与过期时间保持不变', async (t) => {
  let now = 1_000
  const { host, port } = await fixture(t, { clock: () => now })
  await host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD)
  const challenge = await port.execute(request('secure.admin'), () => 'done').catch((error) => error.challenge)
  const otherChallenge = await port.execute(request('secure.admin', { task: 'other' }), () => 'other').catch((error) => error.challenge)
  const firstAttempt = host.authenticate(challenge, ROOT_PASSWORD)
  await assert.rejects(host.authenticate(challenge, ROOT_PASSWORD), (error) => error.code === 'authentication-unavailable')
  await assert.rejects(host.authenticate(otherChallenge, ROOT_PASSWORD), (error) => error.code === 'authentication-unavailable')
  const firstGrant = await firstAttempt
  host.cancelChallenge(otherChallenge)
  now += 60_000
  await assert.rejects(host.resume(firstGrant), (error) => error.code === 'grant-expired')

  const lockedChallenge = await port.execute(request('secure.admin'), () => 'done').catch((error) => error.challenge)
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(host.authenticate(lockedChallenge, 'wrong-password'), (error) => error.code === 'authentication-failed')
  }
  await assert.rejects(host.authenticate(lockedChallenge, ROOT_PASSWORD), (error) => error.code === 'authentication-rate-limited')
  now += 60_000
  const unlockedGrant = await host.authenticate(lockedChallenge, ROOT_PASSWORD)
  assert.equal(await host.resume(unlockedGrant), 'done')

  const expiredChallenge = await port.execute(request('secure.admin'), () => 'never').catch((error) => error.challenge)
  now += 300_000
  await assert.rejects(host.authenticate(expiredChallenge, ROOT_PASSWORD), (error) => error.code === 'challenge-expired')
})
