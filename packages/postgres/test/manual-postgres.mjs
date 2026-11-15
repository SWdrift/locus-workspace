import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createLocusCore, createMemoryCredentialProvider, createMemorySecurityStore } from '@locus/core'
import { api, component } from '../lib/index.js'

const BIN = process.env.PGBIN ?? 'C:/Program Files/PostgreSQL/16/bin'
const ROOT = 'manual-root-password'
const APP_PASSWORD = 'manual-postgres-app-password'
const REFERENCE = 'credential:postgres-local'
const RESOURCE = { type: 'database', id: 'local' }
const report = { postgresServer: 'unverified', postgresConsumer: 'unverified' }
const cleanup = []
let root
try {
  const initdb = join(BIN, 'initdb.exe')
  const pgCtl = join(BIN, 'pg_ctl.exe')
  const psql = join(BIN, 'psql.exe')
  if (!existsSync(initdb) || !existsSync(pgCtl) || !existsSync(psql)) {
    console.log(JSON.stringify({ ...report, blocked: 'PostgreSQL binaries not found' }))
    process.exitCode = 2
  } else {
    root = mkdtempSync(join(tmpdir(), 'locus-pg-'))
    cleanup.push(() => rmSync(root, { recursive: true, force: true }))
    const data = join(root, 'data')
    const initialized = spawnSync(initdb, ['-D', data, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale'], { encoding: 'utf8', windowsHide: true, timeout: 60000 })
    if (initialized.status !== 0) throw new Error(`initdb failed: ${initialized.stderr || initialized.stdout}`)
    const listener = createServer()
    const opened = Promise.withResolvers()
    listener.listen(0, '127.0.0.1', opened.resolve)
    await opened.promise
    const port = listener.address().port
    await new Promise((resolve) => listener.close(resolve))
    const log = join(root, 'postgres.log')
    const started = spawnSync(pgCtl, ['-D', data, '-o', `-p ${port} -h 127.0.0.1`, '-l', log, 'start'], { encoding: 'utf8', windowsHide: true, timeout: 60000 })
    if (started.status !== 0) throw new Error(`pg_ctl start failed: ${started.stderr || started.stdout}`)
    cleanup.push(() => spawnSync(pgCtl, ['-D', data, '-m', 'fast', 'stop'], { encoding: 'utf8', windowsHide: true, timeout: 60000 }))
    const base = ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
    const create = spawnSync(psql, base, {
      input: `CREATE ROLE locus_app LOGIN PASSWORD '${APP_PASSWORD}';\nCREATE DATABASE locus_app OWNER locus_app;\n`,
      encoding: 'utf8', windowsHide: true, timeout: 30000,
    })
    if (create.status !== 0) throw new Error(`psql setup failed: ${create.stderr || create.stdout}`)
    const hba = readFileSync(join(data, 'pg_hba.conf'), 'utf8').replace(/^host\s+all\s+all\s+127\.0\.0\.1\/32\s+\w+/m, 'host all all 127.0.0.1/32 scram-sha-256')
    writeFileSync(join(data, 'pg_hba.conf'), hba)
    const reload = spawnSync(pgCtl, ['-D', data, 'reload'], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
    if (reload.status !== 0) throw new Error(`pg_ctl reload failed: ${reload.stderr || reload.stdout}`)
    const noPassword = spawnSync(psql, ['-h', '127.0.0.1', '-p', String(port), '-U', 'locus_app', '-d', 'locus_app', '-w', '-c', 'select 1'], {
      encoding: 'utf8', windowsHide: true, timeout: 30000, env: { ...process.env, PGPASSWORD: '', PGPASSFILE: join(root, 'no-pgpass') },
    })
    if (noPassword.status === 0) throw new Error('scram verification failed: passwordless login was accepted')
    report.postgresServer = `verified: temporary PostgreSQL 16 on 127.0.0.1:${port}, scram-sha-256 rejects passwordless login`

    let host
    const core = createLocusCore({
      dataDirectory: join(root, 'locus'), components: [component],
      security: { store: createMemorySecurityStore(), provider: createMemoryCredentialProvider(), receiveHost(value) { host = value } },
    })
    cleanup.push(() => core.dispose())
    await host.initializeRoot(ROOT, ROOT)
    const session = host.createSession('agent')
    cleanup.push(() => { try { host.endSession(session) } catch {} })
    const security = host.bindComponent(session, component)
    async function privileged(action) {
      let challenge
      try { await action() } catch (error) { if (error.code !== 'authentication-required') throw error; challenge = error.challenge }
      assert.ok(challenge)
      await host.resume(await host.authenticate(challenge, ROOT))
    }
    await privileged(() => security.execute(
      { capability: 'register', resource: RESOURCE, parameters: {} },
      (context) => api.register(context, { credential: REFERENCE, username: 'locus_app', password: APP_PASSWORD }),
    ))
    const result = await security.execute(
      { capability: 'list', resource: RESOURCE, parameters: {} },
      (context) => api.list(context, {
        config: { host: '127.0.0.1', port, database: 'locus_app', credential: REFERENCE },
        sql: 'select current_user as user, 1 as value',
      }),
    )
    assert.equal(result.rows[0].user, 'locus_app')
    assert.equal(result.rows[0].value, 1)
    report.postgresConsumer = 'verified: real pg.Pool authenticated with Core-delivered username/password fields and executed select'
    console.log(JSON.stringify(report))
  }
} catch (error) {
  report.blocked = error instanceof Error ? error.message.slice(0, 500) : String(error)
  console.log(JSON.stringify(report))
  process.exitCode = 2
} finally {
  for (const action of cleanup.reverse()) await action()
}
