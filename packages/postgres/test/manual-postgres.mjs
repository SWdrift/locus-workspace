import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createDispatcher, createLocusCore, createMemoryCredentialProvider, createMemorySecurityStore } from '@locus/core'
import { component, operations } from '../lib/index.js'

const BIN = process.env.PGBIN ?? 'C:/Program Files/PostgreSQL/16/bin'
const ROOT = 'manual-root-password'
const APP_PASSWORD = 'manual-postgres-app-password'
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
      dataDirectory: join(root, 'locus'), components: [{ component, operations }],
      security: { store: createMemorySecurityStore(), provider: createMemoryCredentialProvider(), receiveHost(value) { host = value } },
    })
    cleanup.push(() => core.dispose())
    await host.initializeRoot(ROOT, ROOT)
    const session = host.createSession('agent')
    cleanup.push(() => { try { host.endSession(session) } catch {} })
    const dispatcher = createDispatcher(
      core.router, host, session, core.events, core.dataDirectory,
      { get: () => undefined },
    )
    /** root operation 先返回认证挑战；通过后 resume 同一个闭包得到结果。 */
    async function privileged(action) {
      const pending = await action()
      if (pending.ok) return pending
      const challenge = pending.error.details?.challenge
      assert.ok(challenge, `期望认证挑战，实际：${JSON.stringify(pending.error)}`)
      return host.resume(await host.authenticate(challenge, ROOT))
    }

    const registered = await privileged(() => dispatcher.invoke(
      {
        method: 'PUT',
        uri: 'pg://databases/local',
        contentType: 'application/json',
        body: { host: '127.0.0.1', port: String(port), database: 'locus_app', username: 'locus_app' },
      },
      { password: APP_PASSWORD },
    ))
    assert.equal(registered.ok, true)
    const result = await dispatcher.invoke({
      method: 'POST',
      uri: 'pg://databases/local/queries',
      contentType: 'application/json',
      body: { sql: 'select current_user as user, 1 as value' },
    })
    assert.equal(result.ok, true)
    assert.equal(result.data.rows[0].user, 'locus_app')
    assert.equal(result.data.rows[0].value, 1)
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
