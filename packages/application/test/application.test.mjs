import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createWorkspaceApplication } from '../lib/index.js'
import { createLocusCore } from '../../core/lib/index.js'
import { createFilesystemService } from '../../../plugins/filesystem/lib/index.js'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-application-'))
  const data = join(root, 'data')
  const files = join(root, 'files')
  mkdirSync(files)
  writeFileSync(join(files, 'note.txt'), 'application layer\n')
  const core = createLocusCore({ dataDirectory: data })
  const filesystem = createFilesystemService(core)
  t.after(async () => {
    await filesystem.dispose()
    await core.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  return { files, core, filesystem, app: createWorkspaceApplication({ locus: core, filesystem }) }
}

test('共用用例覆盖 Workspace、位置与确认组合', async (t) => {
  const f = fixture(t)
  const workspace = f.app.createWorkspace('UI 与 CLI')
  assert.equal(f.app.listWorkspaces().length, 1)
  assert.equal(f.app.getWorkspace(workspace.id).name, 'UI 与 CLI')
  assert.equal(f.app.renameWorkspace(workspace.id, '改名').id, workspace.id)

  const location = f.app.registerLocation(workspace.id, f.files)
  assert.equal(f.app.listLocations(workspace.id).length, 1)
  const discovery = await f.app.discoverLocation(workspace.id, location.id)
  assert.equal(discovery.root.state, 'accessible')
  assert.deepEqual(discovery.entries.map((entry) => entry.kind), ['file'])

  const relation = await f.app.confirmResource(workspace.id, location.id, 'member', 'note.txt')
  assert.equal(relation.kind, 'member')
  assert.match(relation.target.namespace, /^locus\.filesystem:/)
  assert.equal(f.app.getWorkspace(workspace.id).relations[0].id, relation.id)

  f.app.unlink(workspace.id, relation.id)
  assert.equal(f.app.getWorkspace(workspace.id).relations.length, 0)
  f.app.unregisterLocation(workspace.id, location.id)
  assert.equal(f.app.listLocations(workspace.id).length, 0)
})

test('确认前执行真实观察，缺失资源明确失败', async (t) => {
  const f = fixture(t)
  const workspace = f.app.createWorkspace('确认失败')
  const location = f.app.registerLocation(workspace.id, f.files)
  await assert.rejects(
    f.app.confirmResource(workspace.id, location.id, 'member', 'missing.txt'),
    /无法确认/,
  )
  assert.equal(f.app.getWorkspace(workspace.id).relations.length, 0)
})

test('缺少 Filesystem 时 Workspace 用例仍可用，位置用例明确失败', async (t) => {
  const f = fixture(t)
  const app = createWorkspaceApplication({ locus: f.core })
  const workspace = app.createWorkspace('无 Filesystem')
  assert.equal(app.filesystemAvailable, false)
  assert.equal(app.getWorkspace(workspace.id).id, workspace.id)
  assert.throws(() => app.listLocations(workspace.id), /Filesystem 能力不可用/)
})
