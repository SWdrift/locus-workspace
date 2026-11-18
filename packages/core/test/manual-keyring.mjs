import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createKeyringCredentialProvider } from '../lib/security/providers/keyring.js'

// 由显式隔离账户启动器复制到专用目录；自动化测试不会收集本文件。
const digest = (value) => createHash('sha256').update(value).digest('hex')
function identity() {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error('identity-unavailable')
  return result.stdout.trim()
}
const child = process.argv[2] === '--child'
const context = child ? JSON.parse(readFileSync(0, 'utf8')) : { sid: process.argv[2], service: process.argv[3] }
if (process.platform !== 'win32' || !/^S-1-5-21-/.test(context.sid ?? '') || !/^locus:[0-9a-f-]{36}:development$/.test(context.service ?? '') || identity() !== context.sid || process.env.NODE_TEST_CONTEXT !== undefined || process.env.NODE_ENV === 'test') {
  console.error('isolated-account-required')
  process.exit(2)
}
const provider = createKeyringCredentialProvider()
const key = (account) => ({ service: context.service, account })
if (child) {
  try {
    const value = await provider.get(key('ascii'))
    assert.equal(typeof value, 'string')
    assert.equal(digest(value), context.digest)
    console.log(JSON.stringify({ crossProcess: true }))
  } catch { process.exitCode = 1; console.error('isolated-child-check-failed') }
  finally { await provider.dispose() }
} else {
  const accounts = ['ascii', 'unicode', 'ssh-key', 'boundary', 'over-limit', 'missing']
  let report
  let cleaned = true
  try {
    assert.equal(await provider.get(key('missing')), undefined)
    const ascii = `isolated-${randomUUID()}`
    const unicode = `隔离秘密-${randomUUID()}-😀`
    const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey
    for (const [account, secret] of [['ascii', ascii], ['unicode', unicode], ['ssh-key', privateKey]]) {
      await provider.set(key(account), secret)
      assert.equal(digest(await provider.get(key(account))), digest(secret))
    }
    const boundary = '界'.repeat(853) + 'a'
    assert.equal(Buffer.byteLength(boundary, 'utf8'), 2560)
    await provider.set(key('boundary'), boundary)
    assert.equal(await provider.get(key('boundary')), boundary)
    let tooLarge = false
    try { await provider.set(key('over-limit'), 'a'.repeat(2561)) } catch (error) { tooLarge = error.code === 'credential-too-large' }
    assert.equal(tooLarge, true)
    // 隔离身份已校验，直接核验原生后端边界，而不是用适配器预检冒充后端证据。
    const { AsyncEntry } = await import('@napi-rs/keyring')
    const entry = new AsyncEntry(context.service, 'native-capacity')
    let nativeBoundary = false
    try {
      await entry.setSecret(Buffer.alloc(2560, 0x61))
      assert.equal((await entry.getSecret()).length, 2560)
      try { await entry.setSecret(Buffer.alloc(2561, 0x61)) } catch { nativeBoundary = true }
      assert.equal(nativeBoundary, true)
    } finally { await entry.deleteCredential() }
    const cross = spawnSync(process.execPath, [process.argv[1], '--child'], {
      input: JSON.stringify({ ...context, digest: digest(ascii) }), encoding: 'utf8', windowsHide: true, timeout: 30000,
    })
    assert.equal(cross.status, 0)
    assert.equal(JSON.parse(cross.stdout).crossProcess, true)
    report = { os: `${process.platform}-${process.arch}`, package: '@napi-rs/keyring@2.1.2', backend: 'Windows Credential Manager', isolatedIdentity: true, profile: 'development', encoding: 'UTF-8 raw setSecret/getSecret', ascii: true, unicode: true, sshPrivateKey: 'RSA-2048 PKCS1 PEM', sshPrivateKeyBytes: Buffer.byteLength(privateKey), maximumBlobBytes: 2560, nativeBoundary: true, overLimit: 'credential-too-large', missing: true, crossProcess: true, rebootPersistence: 'unverified', locked: 'unverified', serviceUnavailable: 'unverified' }
  } catch (error) {
    process.exitCode = 1
    report = { status: 'failed', code: typeof error.code === 'string' && /^[a-z-]+$/.test(error.code) ? error.code : 'native-check-failed', isolatedIdentity: true }
  } finally {
    for (const account of accounts) {
      try { await provider.delete(key(account)); if (await provider.get(key(account)) !== undefined) cleaned = false } catch { cleaned = false }
    }
    // 清理该测试 service 下未知账户，避免后续新增用例留下孤立记录；只用于隔离测试账户。
    try {
      for (const account of await provider.list(context.service)) {
        await provider.delete(key(account))
        if (await provider.get(key(account)) !== undefined) cleaned = false
      }
      if ((await provider.list(context.service)).length !== 0) cleaned = false
    } catch { cleaned = false }
    await provider.dispose()
    console.log(JSON.stringify({ ...report, entriesCleaned: cleaned }))
    if (!cleaned) process.exitCode = 1
  }
}
