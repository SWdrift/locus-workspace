import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { createLocusCore } from '@locus/core'
import { createDispatcher } from '@locus/core/invocation'
import { createMemoryCredentialProvider, createMemorySecurityStore } from '@locus/core/security'
import { component, createRemoteTargetsService, operations, targetBinding } from '../lib/index.js'
import { createProcessRunner } from '../lib/ssh.js'

const ROOT_PASSWORD = 'manual-ssh-root-password'
const report = { sshSession: 'unverified', cleanup: 'pending' }
const cleanup = []
try {
  const sshd = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/sshd.exe' : '/usr/sbin/sshd'
  if (!existsSync(sshd)) {
    console.log(JSON.stringify({ ...report, blocked: 'local sshd unavailable' }))
    process.exitCode = 2
  } else {
    const root = mkdtempSync(join(tmpdir(), 'locus-ssh-'))
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
    const keygen = (name) => {
      const path = join(root, name)
      const generated = spawnSync('ssh-keygen', ['-t', 'rsa', '-b', '2048', '-N', '', '-f', path], {
        encoding: 'utf8', windowsHide: true, timeout: 30000,
      })
      if (generated.status !== 0) throw new Error(`ssh-keygen failed: ${generated.stderr || generated.stdout}`)
      return { path, publicKey: readFileSync(`${path}.pub`, 'utf8') }
    }
    const userKey = keygen('user-key')
    const hostKey = keygen('host-key')
    const wrongKey = keygen('wrong-key')
    const listener = createServer()
    await new Promise((resolve, reject) => {
      listener.once('error', reject)
      listener.listen(0, '127.0.0.1', resolve)
    })
    const port = listener.address().port
    await new Promise((resolve) => listener.close(resolve))
    const slash = (value) => {
      const normalized = value.replaceAll('\\', '/')
      return process.platform === 'win32'
        ? normalized.replace(/^([A-Za-z]):/, (_match, drive) => `/${drive.toLowerCase()}`)
        : normalized
    }
    const authorized = join(root, 'authorized_keys')
    const config = join(root, 'sshd_config')
    writeFileSync(authorized, userKey.publicKey)
    writeFileSync(config, `Port ${port}
ListenAddress 127.0.0.1
HostKey "${slash(hostKey.path)}"
PidFile "${slash(join(root, 'sshd.pid'))}"
AuthorizedKeysFile "${slash(authorized)}"
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
StrictModes no
LogLevel VERBOSE
`)
    const check = spawnSync(sshd, ['-t', '-f', config], {
      encoding: 'utf8', windowsHide: true, timeout: 10000,
    })
    if (check.status !== 0) {
      report.blocked = `sshd prerequisite failed: ${(check.stderr || check.stdout).slice(0, 500)}`
      process.exitCode = 2
    } else {
      const server = spawn(sshd, ['-D', '-e', '-f', config], {
        stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
      })
      cleanup.push(async () => {
        if (server.exitCode !== null || server.signalCode !== null) return
        const ended = new Promise((resolve) => server.once('close', resolve))
        server.kill()
        await ended
      })
      const ready = Promise.withResolvers()
      let diagnostic = ''
      const timer = setTimeout(() => ready.reject(new Error('server-not-ready')), 10000)
      server.stderr.on('data', (chunk) => {
        diagnostic += chunk
        if (diagnostic.includes('Server listening')) ready.resolve()
      })
      server.once('error', ready.reject)
      server.once('close', () => ready.reject(new Error('server-exited')))
      try {
        await ready.promise
      } finally {
        clearTimeout(timer)
      }

      let host
      const core = createLocusCore({
        dataDirectory: join(root, 'locus'),
        components: [{ component, operations }],
        security: {
          store: createMemorySecurityStore(),
          provider: createMemoryCredentialProvider(),
          receiveHost(value) { host = value },
        },
      })
      cleanup.push(() => core.dispose())
      await host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD)
      const session = host.createSession('agent')
      cleanup.push(() => host.endSession(session))
      const dispatcher = createDispatcher(
        core.router, host, session, core.events, core.dataDirectory,
        { get: (id) => id === 'openssh' ? { id, kind: 'external', state: 'healthy' } : undefined },
      )
      const targetRoot = join(core.dataDirectory, 'remote-targets')
      const targetSpec = (id) => ({
        resource: { kind: 'server' },
        identity: { login: userInfo().username, auth: { method: 'private-key' } },
        connectivity: {
          host: '127.0.0.1',
          port,
          trust: { knownHosts: `trust/${id}/known_hosts` },
        },
      })
      async function register(id, privateKey) {
        const pending = await dispatcher.invoke({
          method: 'PUT',
          uri: `rt://targets/${id}`,
          contentType: 'application/json',
          body: { spec: JSON.stringify(targetSpec(id)) },
        }, { privateKey })
        assert.equal(pending.ok, false)
        const challenge = pending.error.details?.challenge
        assert.ok(challenge, JSON.stringify(pending.error))
        const result = await host.resume(await host.authenticate(challenge, ROOT_PASSWORD))
        assert.equal(result.ok, true, JSON.stringify(result))
        const trustDirectory = join(targetRoot, 'trust', id)
        mkdirSync(trustDirectory, { recursive: true })
        writeFileSync(join(trustDirectory, 'known_hosts'), `[127.0.0.1]:${port} ${hostKey.publicKey}`)
      }

      const privateKey = readFileSync(userKey.path, 'utf8')
      await register('loopback', privateKey)
      const probe = await dispatcher.invoke({ method: 'GET', uri: 'rt://targets/loopback/system' })
      assert.equal(probe.ok, true)
      assert.equal(probe.data.ok, true)
      const executed = await dispatcher.invoke({
        method: 'POST',
        uri: 'rt://targets/loopback/jobs',
        contentType: 'application/json',
        body: { command: ['whoami'] },
      })
      assert.equal(executed.ok, true)
      assert.equal(executed.data.exitCode, 0)

      // 真实服务执行器记录交付路径，独立验证临时文件在消费完成后移除。
      const observed = []
      const runner = createProcessRunner()
      const service = createRemoteTargetsService({
        root: targetRoot,
        runner: {
          async run(command, args, options) {
            const index = args.indexOf('-i')
            if (index >= 0) observed.push(args[index + 1])
            return runner.run(command, args, options)
          },
          interactive: runner.interactive,
        },
      })
      cleanup.push(() => service.dispose())
      const material = {
        slot: 'ssh-private-key',
        values: { privateKey, targetBinding: targetBinding(service.show('loopback')) },
      }
      const direct = await service.exec('loopback', ['whoami'], material)
      assert.equal(direct.exitCode, 0)
      assert.ok(observed.length > 0)
      assert.equal(observed.every((path) => !existsSync(path)), true)

      await register('wrong', readFileSync(wrongKey.path, 'utf8'))
      const rejected = await dispatcher.invoke({
        method: 'POST',
        uri: 'rt://targets/wrong/jobs',
        contentType: 'application/json',
        body: { command: ['whoami'] },
      })
      assert.equal(rejected.ok, true)
      assert.notEqual(rejected.data.exitCode, 0)
      report.sshSession = 'verified: real OpenSSH, Core operation credentials, pinned known_hosts'
      report.execOutput = executed.data.stdout.trim().slice(0, 200)
      report.temporaryKeyRemoved = true
      report.wrongKeyRejected = true
    }
  }
} catch (error) {
  report.blocked = error instanceof Error ? error.message.slice(0, 500) : String(error)
  process.exitCode = 2
} finally {
  for (const action of cleanup.reverse()) await action()
  report.cleanup = 'completed'
  console.log(JSON.stringify(report))
}
