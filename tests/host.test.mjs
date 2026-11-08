import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import * as host from '../packages/host-dsh/lib/index.js'
import * as filesystem from '../plugins/filesystem/lib/index.js'

const require = createRequire(new URL('../packages/host-dsh/package.json', import.meta.url))
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)

test('领域 Plugin 卸载不清除 Core 身份或长期关系，重启重新恢复配置', async () => {
  const root = mkdtempSync(join(tmpdir(), 'locus-host-test-'))
  const previous = process.env.LOCUS_HOME
  process.env.LOCUS_HOME = join(root, 'data')
  const directory = join(root, 'files')
  mkdirSync(directory)
  writeFileSync(join(directory, 'note.txt'), 'persistent reference')
  const ctx = new Context()
  let next
  try {
    await ctx.plugin(host)
    const locus = ctx.get('locus')
    const workspace = locus.workspaces.create('independent')
    const plugin = ctx.plugin(filesystem)
    await plugin
    const files = ctx.get('locusFilesystem')
    locus.workspaces.configureCapability(workspace.id, files.capability)
    const location = files.register(workspace.id, directory)
    const observed = await files.inspect(workspace.id, location.id, 'note.txt')
    const relation = locus.workspaces.link(workspace.id, 'member', observed.reference, { kind: 'discovery', detail: directory })
    assert.throws(() => ctx.provide('locus', {}), /has been registered/)
    await plugin.dispose()
    assert.equal(ctx.get('locusFilesystem'), undefined)
    assert.equal(locus.workspaces.get(workspace.id).relations[0].id, relation.id)
    await ctx.fiber.dispose()
    assert.equal(ctx.get('locus'), undefined)
    assert.throws(() => locus.workspaces.get(workspace.id))

    next = new Context()
    await next.plugin(host)
    await next.plugin(filesystem)
    const restored = next.get('locus')
    assert.equal(restored.workspaces.get(workspace.id).id, workspace.id)
    assert.equal(restored.workspaces.get(workspace.id).relations[0].id, relation.id)
    assert.equal(next.get('locusFilesystem').locations(workspace.id)[0].id, location.id)
    assert.equal((await next.get('locusFilesystem').read(workspace.id, location.id, 'note.txt')).text, 'persistent reference')
  } finally {
    await ctx.fiber.dispose()
    await next?.fiber.dispose()
    if (previous === undefined) delete process.env.LOCUS_HOME
    else process.env.LOCUS_HOME = previous
    rmSync(root, { recursive: true, force: true })
  }
})
