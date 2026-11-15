import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { createLocusCore, createMemoryCredentialProvider, createMemorySecurityStore } from '@locus/core'
import { api, component, createRemoteTargetsService } from '../lib/index.js'

const ROOT_PASSWORD = 'manual-ssh-root-password'
const REFERENCE = 'credential:server-key'
const report = { sshSession: 'unverified', cleanup: 'pending' }
const cleanup = []
let root
try {
  const sshd = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/sshd.exe' : '/usr/sbin/sshd'
  if (!existsSync(sshd)) {
    console.log(JSON.stringify({ ...report, blocked: 'local sshd unavailable' }))
    process.exitCode = 2
  } else {
    root = mkdtempSync(join(tmpdir(), 'locus-ssh-'))
    cleanup.push(() => rmSync(root, { recursive: true, force: true }))
    const keygen = (name) => {
      const path = join(root, name)
      const generated = spawnSync('ssh-keygen', ['-t', 'rsa', '-b', '2048', '-N', '', '-f', path], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
      if (generated.status !== 0) throw new Error(`ssh-keygen failed: ${generated.stderr || generated.stdout}`)
      return { path, publicKey: readFileSync(`${path}.pub`, 'utf8') }
    }
    const userKey = keygen('user-key')
    const hostKey = keygen('host-key')
    const wrongKey = keygen('wrong-key')
    const listener = createServer()
    const opened = Promise.withResolvers()
    listener.listen(0, '127.0.0.1', opened.resolve)
    await opened.promise
    const port = listener.address().port
    await new Promise((resolve) => listener.close(resolve))
    const slash = (value) => {
      const normalized = value.replaceAll('\\', '/')
      return process.platform === 'win32' ? normalized.replace(/^([A-Za-z]):/, (_match, drive) => `/${drive.toLowerCase()}`) : normalized
    }
    const authorized = join(root, 'authorized_keys')
    const known = join(root, 'known_hosts')
    const config = join(root, 'sshd_config')
    writeFileSync(authorized, userKey.publicKey)
    writeFileSync(known, `[127.0.0.1]:${port} ${hostKey.publicKey}`)
    writeFileSync(config, `Port ${port}\nListenAddress 127.0.0.1\nHostKey "${slash(hostKey.path)}"\nPidFile "${slash(join(root, 'sshd.pid'))}"\nAuthorizedKeysFile "${slash(authorized)}"\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPubkeyAuthentication yes\nStrictModes no\nLogLevel VERBOSE\n`)
    const check = spawnSync(sshd, ['-t', '-f', config], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
    if (check.status !== 0) {
      console.log(JSON.stringify({ ...report, blocked: `sshd prerequisite failed: ${(check.stderr || check.stdout).slice(0, 500)}` }))
      process.exitCode = 2
    } else {
      const server = spawn(sshd, ['-D', '-e', '-f', config], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
      cleanup.push(() => { if (server.exitCode === null && server.signalCode === null) server.kill() })
      const ready = Promise.withResolvers()
      let diagnostic = ''
      const timer = setTimeout(() => ready.reject(new Error('server-not-ready')), 10000)
      server.stderr.on('data', (chunk) => { diagnostic += chunk; if (diagnostic.includes('Server listening')) ready.resolve() })
      server.once('error', ready.reject)
      server.once('close', () => ready.reject(new Error('server-exited')))
      try {
        await ready.promise
        let host
        const core = createLocusCore({
          dataDirectory: join(root, 'locus'), components: [component],
          security: { store: createMemorySecurityStore(), provider: createMemoryCredentialProvider(), receiveHost(value) { host = value } },
        })
        cleanup.push(() => core.dispose())
        await host.initializeRoot(ROOT_PASSWORD, ROOT_PASSWORD)
        const session = host.createSession('agent')
        const componentPort = host.bindComponent(session, component)
        async function privileged(action) {
          try {
            return await action()
          } catch (error) {
            if (error.code !== 'authentication-required') throw error
            assert.ok(error.challenge)
            return await host.resume(await host.authenticate(error.challenge, ROOT_PASSWORD))
          }
        }
        /** Root 授权后经注册能力写入凭据，并为声明该槽的能力建立精确绑定。 */
        async function register(resourceId, credential, privateKey) {
          return privileged(() => componentPort.execute({
            capability: 'register-private-key',
            resource: { type: 'remote-target', id: resourceId },
            parameters: {},
          }, (context) => api['register-private-key'](context, { credential, privateKey })))
        }
        const access = {
          withCredential(targetId, slot, credential, operation, consume) {
            return componentPort.execute({
              capability: 'private-key-access',
              resource: { type: 'remote-target', id: targetId },
              parameters: { operation: operation.operation, command: [...operation.command] },
            }, (context) => context.withCredential(slot, credential, consume))
          },
        }
        await register('loopback', REFERENCE, readFileSync(userKey.path, 'utf8'))
        const observed = []
        const service = createRemoteTargetsService({
          root: join(root, 'targets'),
          security: access,
          runner: {
            async run(command, args, options) {
              const index = args.indexOf('-i')
              if (index >= 0) observed.push(args[index + 1])
              const { createProcessRunner } = await import('../lib/ssh.js')
              return createProcessRunner().run(command, args, options)
            },
            async interactive(command, args, options) {
              const { createProcessRunner } = await import('../lib/ssh.js')
              return createProcessRunner().interactive(command, args, options)
            },
          },
        })
        cleanup.push(() => service.dispose())
        const targetRoot = join(root, 'targets')
        service.add('loopback', {
          resource: { kind: 'server' },
          identity: { login: userInfo().username, auth: { method: 'private-key', credential: REFERENCE } },
          connectivity: { host: '127.0.0.1', port, trust: { knownHosts: 'credentials/loopback/known_hosts' } },
        })
        mkdirSync(join(targetRoot, 'credentials', 'loopback'), { recursive: true })
        writeFileSync(join(targetRoot, 'credentials', 'loopback', 'known_hosts'), `[127.0.0.1]:${port} ${hostKey.publicKey}`)
        const probe = await service.probe('loopback')
        assert.equal(probe.ok, true)
        const executed = await service.exec('loopback', ['whoami'])
        assert.equal(executed.exitCode, 0)
        assert.ok(observed.length >= 2)
        assert.equal(observed.every((path) => !existsSync(path)), true)
        const publicResult = spawnSync('ssh-keygen', ['-y', '-f', userKey.path], { encoding: 'utf8', windowsHide: true })
        assert.equal(publicResult.status, 0)
        report.sshSession = 'verified: real OpenSSH local sshd, Core CredentialRef, restricted temporary key, pinned known_hosts'
        report.execOutput = executed.stdout.trim().slice(0, 200)
        report.temporaryKeyRemoved = true
        // 错误私钥必须被拒绝。
        const wrongCredential = 'credential:wrong-key'
        await register('wrong', wrongCredential, readFileSync(wrongKey.path, 'utf8'))
        const wrongService = createRemoteTargetsService({
          root: join(root, 'wrong-targets'),
          security: access,
          runner: { async run(command, args, options) { const { createProcessRunner } = await import('../lib/ssh.js'); return createProcessRunner().run(command, args, options) }, async interactive() { return 1 } },
        })
        cleanup.push(() => wrongService.dispose())
        wrongService.add('wrong', {
          resource: { kind: 'server' },
          identity: { login: userInfo().username, auth: { method: 'private-key', credential: wrongCredential } },
          connectivity: { host: '127.0.0.1', port, trust: { knownHosts: 'credentials/wrong/known_hosts' } },
        })
        mkdirSync(join(root, 'wrong-targets', 'credentials', 'wrong'), { recursive: true })
        writeFileSync(join(root, 'wrong-targets', 'credentials', 'wrong', 'known_hosts'), `[127.0.0.1]:${port} ${hostKey.publicKey}`)
        const rejected = await wrongService.exec('wrong', ['whoami'])
        assert.notEqual(rejected.exitCode, 0)
        report.wrongKeyRejected = true
        host.endSession(session)
      } catch (error) {
        report.blocked = error instanceof Error ? error.message.slice(0, 500) : String(error)
        process.exitCode = 2
      } finally {
        clearTimeout(timer)
        if (server.exitCode === null && server.signalCode === null) {
          const ended = Promise.withResolvers()
          server.once('close', ended.resolve)
          server.kill()
          await ended.promise
        }
      }
    }
  }
} finally {
  for (const action of cleanup.reverse()) await action()
  report.cleanup = 'completed'
  console.log(JSON.stringify(report))
}
