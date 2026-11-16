import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createLocusCore, createMemoryCredentialProvider, createMemorySecurityStore } from '@locus/core'
import { api, component, createGiteaRequester } from '../lib/index.js'

const PASSWORD = 'isolated-root-password'
const TOKEN = 'gitea-sentinel-token'
const REFERENCE = 'credential:gitea-local'
const OTHER_REFERENCE = 'credential:gitea-other'
const RESOURCE = { type: 'gitea', id: 'local' }

function request(capability = 'request', resource = RESOURCE) {
  return { capability, resource, parameters: null }
}

/** register 是 root 能力：先捕获挑战，认证后由 Core 恢复同一闭包。 */
async function register(host, origin, reference = REFERENCE, resource = RESOURCE) {
  const session = host.createSession('agent')
  const port = host.bindComponent(session, component)
  let challenge
  try {
    await port.execute(request('register', resource), (context) => api.register(context, {
      credential: reference, origin, token: TOKEN,
    }))
  } catch (error) {
    if (error.code !== 'authentication-required') throw error
    challenge = error.challenge
  }
  assert.ok(challenge)
  assert.deepEqual(await host.resume(await host.authenticate(challenge, PASSWORD)), { registered: true })
  return { session, port }
}

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-gitea-'))
  let host
  const core = createLocusCore({
    dataDirectory: join(root, 'data'), components: [component],
    security: { store: createMemorySecurityStore(), provider: createMemoryCredentialProvider(), receiveHost(value) { host = value } },
  })
  t.after(async () => { await core.dispose(); rmSync(root, { recursive: true, force: true }) })
  await host.initializeRoot(PASSWORD, PASSWORD)
  return { core, host }
}

/** 每次请求都经组件 request 能力授权；origin 来自 Core 绑定字段。 */
function requester(port, { reference = REFERENCE, fetcher, resource = RESOURCE } = {}) {
  return {
    request: (path, init) => port.execute(request('request', resource), (context) => (
      createGiteaRequester(context, reference, fetcher).request(path, init)
    )),
  }
}

async function server(t, handler) {
  const listener = createServer(handler)
  const opened = Promise.withResolvers()
  listener.once('error', opened.reject)
  listener.listen(0, '127.0.0.1', opened.resolve)
  await opened.promise
  t.after(() => new Promise((resolve) => listener.close(resolve)))
  const { port } = listener.address()
  return `http://127.0.0.1:${port}`
}

test('Gitea 只向登记 origin 交付 Authorization，重定向不转发认证', async (t) => {
  const setup = await fixture(t)
  const seen = []
  let otherHits = 0
  const other = await server(t, (_request, response) => { otherHits += 1; response.end('other') })
  const origin = await server(t, (incoming, response) => {
    seen.push({ url: incoming.url, authorization: incoming.headers.authorization })
    if (incoming.url === '/redirect') {
      response.writeHead(302, { Location: `${other}/collect` })
      response.end()
      return
    }
    if (incoming.url === '/denied') {
      response.writeHead(401)
      response.end('denied')
      return
    }
    if (incoming.url === '/forbidden') {
      response.writeHead(403)
      response.end('forbidden')
      return
    }
    response.end('ok')
  })
  const { port } = await register(setup.host, origin)
  const gitea = requester(port)
  const response = await gitea.request('/api/v1/version')
  assert.equal(response.kind, 'response')
  assert.equal(await response.response.text(), 'ok')
  assert.deepEqual(seen, [{ url: '/api/v1/version', authorization: `Bearer ${TOKEN}` }])
  const redirected = await gitea.request('/redirect')
  assert.equal(redirected.kind, 'response')
  assert.equal(redirected.response.status, 302)
  assert.equal(otherHits, 0)
  await redirected.response.body?.cancel()
  assert.deepEqual(await gitea.request('/denied'), { kind: 'authentication-failed', status: 401 })
  assert.deepEqual(await gitea.request('/forbidden'), { kind: 'authentication-failed', status: 403 })
})

test('Gitea 交付后清除请求头中的 Authorization', async (t) => {
  const setup = await fixture(t)
  const { port } = await register(setup.host, 'http://127.0.0.1:9')
  let delivered
  let sent
  const gitea = requester(port, {
    fetcher: async (_url, init) => {
      delivered = init.headers
      sent = new Headers(init.headers).get('authorization')
      return new Response('ok')
    },
  })
  const response = await gitea.request('/api/v1/version')
  assert.equal(response.kind, 'response')
  assert.equal(await response.response.text(), 'ok')
  assert.equal(sent, `Bearer ${TOKEN}`)
  assert.equal(delivered.has('authorization'), false)

  let failed
  const failing = requester(port, {
    fetcher: async (_url, init) => {
      failed = init.headers
      throw new Error('network down')
    },
  })
  assert.deepEqual(await failing.request('/api'), { kind: 'network-failed' })
  assert.equal(failed.has('authorization'), false)
})

test('Gitea 拒绝其他 origin、调用方 Authorization 与错误凭据引用', async (t) => {
  const setup = await fixture(t)
  const origin = await server(t, (_request, response) => response.end('ok'))
  const { port } = await register(setup.host, origin)
  const gitea = requester(port)
  await assert.rejects(
    () => gitea.request('http://127.0.0.1:1/api'),
    (error) => error.code === 'access-denied' && error.reason === 'resource-mismatch',
  )
  await assert.rejects(
    () => gitea.request('/api', { headers: { Authorization: 'Bearer caller-supplied' } }),
    (error) => error.code === 'access-denied' && error.reason === 'resource-mismatch',
  )
  const otherRef = requester(port, { reference: OTHER_REFERENCE })
  await assert.rejects(
    () => otherRef.request('/api'),
    (error) => error.code === 'access-denied' && error.reason === 'credential-binding-mismatch',
  )
})

test('Gitea 将网络失败与认证失败分开', async (t) => {
  const setup = await fixture(t)
  const origin = await server(t, (_request, response) => response.end('ok'))
  const { port } = await register(setup.host, origin)
  const opened = requester(port)
  const listener = createServer()
  const started = Promise.withResolvers()
  listener.listen(0, '127.0.0.1', started.resolve)
  await started.promise
  const { port: closedPort } = listener.address()
  await new Promise((resolve) => listener.close(resolve))
  const closedResource = { type: 'gitea', id: 'closed' }
  const { port: closedBoundPort } = await register(setup.host, `http://127.0.0.1:${closedPort}`, OTHER_REFERENCE, closedResource)
  const closed = requester(closedBoundPort, { reference: OTHER_REFERENCE, resource: closedResource })
  assert.deepEqual(await closed.request('/api'), { kind: 'network-failed' })
  const denied = await opened.request('/api')
  assert.equal(denied.kind, 'response')
})
