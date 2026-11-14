import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createComponentRunner } from '../lib/components/runner.js'

test('runner 将无 BOM 的 UTF-16LE 输出解码为文本', async () => {
  const runner = createComponentRunner()
  const script = "process.stdout.write(Buffer.from('WSL version: 2.7.14.0 版本: 6.18','utf16le'))"
  const result = await runner.run([process.execPath, '-e', script], { timeoutMs: 10_000 })
  assert.equal(result.exitCode, 0, result.stderr)
  assert.equal(result.stdout, 'WSL version: 2.7.14.0 版本: 6.18')
})

test('runner 在命令缺失时返回 ENOENT', async () => {
  const result = await createComponentRunner().run(
    ['locus-definitely-missing-binary', '--version'],
    { timeoutMs: 3000 },
  )
  assert.equal(result.exitCode, 1)
  assert.equal(result.errorCode, 'ENOENT')
})

test('runner 通过 execa 执行 Windows .cmd', { skip: process.platform !== 'win32' }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'locus-cmd-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'probe.cmd')
  writeFileSync(file, '@echo off\r\necho cmd-ok\r\n', 'utf8')
  const result = await createComponentRunner().run([file], { timeoutMs: 5000 })
  assert.equal(result.exitCode, 0, result.stderr)
  assert.match(result.stdout, /cmd-ok/)
})
