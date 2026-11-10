import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createLocusCore } from '../../core/lib/index.js'
import { buildWorkspaceOverview } from '../lib/index.js'

function fixture(t) {
  const data = mkdtempSync(join(tmpdir(), 'locus-application-'))
  const core = createLocusCore({ dataDirectory: data })
  t.after(async () => {
    await core.dispose()
    rmSync(data, { recursive: true, force: true })
  })
  return core
}

test('Overview 应用用例不依赖 CLI，保留确认关系与来源', async (t) => {
  const core = fixture(t)
  const workspace = core.workspaces.create('Application Workspace')
  const relation = core.workspaces.link(workspace.id, 'association', {
    namespace: 'test.resource',
    id: 'resource-1',
  }, { kind: 'manual', detail: 'test relation' })

  const overview = await buildWorkspaceOverview({ locus: core }, workspace.id)
  assert.equal(overview.workspace.id, workspace.id)
  assert.equal(overview.mode, 'relations')
  assert.equal(overview.otherRelations.length, 1)
  assert.equal(overview.otherRelations[0].relationId, relation.id)
  assert.equal(overview.otherRelations[0].source.detail, 'test relation')
  assert.match(overview.generatedAt, /^\d{4}-/)
  assert.equal(overview.filesystem.state, 'empty')
  assert.equal(overview.git.state, 'empty')
})

test('单一来源失败不抹除 Workspace 与其他部分', async (t) => {
  const core = fixture(t)
  const workspace = core.workspaces.create('Partial Workspace')
  core.workspaces.configureCapability(workspace.id, {
    id: 'locus.filesystem',
    provider: '@locus/filesystem',
    tags: ['environment'],
  })
  const filesystem = {
    capability: { id: 'locus.filesystem', provider: '@locus/filesystem', tags: ['environment'] },
    locations() {
      throw new Error('位置列表不可用')
    },
  }
  const overview = await buildWorkspaceOverview({ locus: core, filesystem }, workspace.id)
  assert.equal(overview.workspace.id, workspace.id)
  assert.equal(overview.filesystem.state, 'empty')
  assert.equal(overview.filesystem.error, '位置列表不可用')
  assert.equal(overview.providers.find((provider) => provider.id === 'locus.filesystem').loaded, true)
})
