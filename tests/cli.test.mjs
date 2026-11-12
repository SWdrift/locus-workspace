import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createWorkspaceApplication } from '../packages/application/lib/index.js'
import { createLocusCore } from '../packages/core/lib/index.js'
import { createFilesystemService } from '../plugins/filesystem/lib/index.js'
import { createCommands } from '../plugins/cli/lib/commands.js'

/** 复用真实应用命令树，但不启动 launcher；DSH profile 装配由 smoke 覆盖。 */
async function invoke(services, argv) {
  const application = createWorkspaceApplication(services.filesystem === undefined
    ? { locus: services.locus }
    : { locus: services.locus, filesystem: services.filesystem })
  const commands = createCommands(application, undefined)
  const silence = (program) => {
    program.exitOverride()
    program.configureOutput({ writeOut() {}, writeErr() {} })
    for (const child of program.commands) silence(child)
  }
  silence(commands.program)
  try {
    commands.program.parse(argv, { from: 'user' })
  } catch (error) {
    return { exitCode: error.exitCode ?? 1, error }
  }
  const pending = commands.execute()
  if (!pending) return { exitCode: 1, error: new Error('未选择命令') }
  try {
    return { ...(await pending), json: commands.json() }
  } catch (error) {
    return { exitCode: 2, error }
  }
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-cli-'))
  const data = join(root, 'data')
  const resources = join(root, 'resources')
  const parent = join(resources, 'parent')
  const child = join(parent, 'child')
  const sibling = join(resources, 'sibling')
  mkdirSync(child, { recursive: true })
  mkdirSync(sibling)
  writeFileSync(join(parent, 'note.txt'), 'CLI file\n')
  writeFileSync(join(child, 'child.txt'), 'child file\n')
  let core = createLocusCore({ dataDirectory: data })
  let filesystem = createFilesystemService(core)
  const services = {
    get locus() { return core },
    get filesystem() { return filesystem },
    async restart() {
      await filesystem.dispose()
      await core.dispose()
      core = createLocusCore({ dataDirectory: data })
      filesystem = createFilesystemService(core)
    },
  }
  t.after(async () => {
    await filesystem.dispose()
    await core.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  return { root, data, resources, parent, child, sibling, services }
}

test('Workspace 创建、列举、打开、改名与 JSON 输出不依赖目录', async (t) => {
  const f = fixture(t)
  const created = await invoke(f.services, ['workspace', 'create', '研究'])
  assert.match(created.text, /Workspace: 研究/)
  const id = created.value.id

  const bare = await invoke(f.services, ['--json', 'workspace', 'list'])
  assert.equal(bare.json, true)
  assert.equal(bare.value.length, 1)
  assert.equal(bare.value[0].name, '研究')

  const opened = await invoke(f.services, ['workspace', 'show', id])
  assert.match(opened.text, new RegExp(`Identity: ${id}`))
  assert.match(opened.text, /长期关系:\n  无/)

  const renamed = await invoke(f.services, ['workspace', 'rename', id, '重命名'])
  assert.equal(renamed.value.name, '重命名')
  assert.equal(renamed.value.id, id)
})

test('显式关系幂等、拒绝自引用，解除只移除关系', async (t) => {
  const f = fixture(t)
  const first = (await invoke(f.services, ['workspace', 'create', 'A'])).value
  const second = (await invoke(f.services, ['workspace', 'create', 'B'])).value

  const linked = await invoke(f.services, ['workspace', 'link', first.id, 'locus.workspace', second.id])
  assert.equal(linked.value.kind, 'association')
  const repeated = await invoke(f.services, ['workspace', 'link', first.id, 'locus.workspace', second.id])
  assert.equal(repeated.value.id, linked.value.id)
  assert.equal(f.services.locus.workspaces.get(first.id).relations.length, 1)

  const self = await invoke(f.services, ['workspace', 'link', first.id, 'locus.workspace', first.id])
  assert.match(String(self.error?.message), /不能把自身/)

  const missing = await invoke(f.services, ['workspace', 'link', first.id, 'locus.workspace', 'missing'])
  assert.match(String(missing.error?.message), /找不到 Workspace/)

  await assert.rejects(async () => {
    const result = await invoke(f.services, ['workspace', 'unlink', first.id, linked.value.id])
    if (result.error) throw result.error
  }, /required option '--yes'/)
  assert.equal(f.services.locus.workspaces.get(first.id).relations.length, 1)

  const removed = await invoke(f.services, ['workspace', 'unlink', first.id, linked.value.id, '--yes'])
  assert.match(removed.text, /外部资源未删除/)
  assert.equal(f.services.locus.workspaces.get(first.id).relations.length, 0)
  assert.equal(f.services.locus.workspaces.get(second.id).id, second.id)
})

test('位置登记允许路径缺失，发现只读取一层', async (t) => {
  const f = fixture(t)
  const workspace = (await invoke(f.services, ['workspace', 'create', 'Files'])).value
  const registered = await invoke(f.services, ['fs', 'register', workspace.id, f.parent])
  assert.equal(registered.value.path, f.parent)
  const missing = await invoke(f.services, ['fs', 'register', workspace.id, join(f.resources, 'missing')])
  assert.match(missing.text, /尚未确认为成员/)

  const locations = await invoke(f.services, ['--json', 'fs', 'locations', workspace.id])
  assert.equal(locations.value.length, 2)

  const discovered = await invoke(f.services, ['--json', 'fs', 'discover', workspace.id, registered.value.id])
  assert.equal(discovered.value.root.state, 'accessible')
  assert.deepEqual(discovered.value.entries.map((entry) => entry.kind).sort(), ['directory', 'file'])
  assert.equal(discovered.exitCode, 0)

  const absent = await invoke(f.services, ['fs', 'discover', workspace.id, missing.value.id])
  assert.equal(absent.value.root.state, 'missing')
  assert.equal(absent.exitCode, 2)
})

test('读取有界、确认可访问资源并保留关系，取消位置不删除文件或关系', async (t) => {
  const f = fixture(t)
  const workspace = (await invoke(f.services, ['workspace', 'create', 'Read'])).value
  const location = (await invoke(f.services, ['fs', 'register', workspace.id, f.parent])).value

  const read = await invoke(f.services, ['fs', 'read', workspace.id, location.id, 'note.txt', '--max-bytes', '4'])
  assert.equal(read.value.text, 'CLI ')
  assert.equal(read.value.truncated, true)

  const inspected = await invoke(f.services, ['fs', 'inspect', workspace.id, location.id, 'child'])
  assert.equal(inspected.value.kind, 'directory')

  const confirmed = await invoke(f.services, ['fs', 'confirm', workspace.id, location.id, 'note.txt'])
  assert.equal(confirmed.value.kind, 'member')
  assert.match(confirmed.value.target.namespace, /^locus\.filesystem:/)
  assert.match(confirmed.value.source.detail, /note\.txt/)

  const missing = await invoke(f.services, ['fs', 'confirm', workspace.id, location.id, 'missing.txt'])
  assert.match(String(missing.error?.message), /无法确认/)

  await invoke(f.services, ['fs', 'unregister', workspace.id, location.id, '--yes'])
  assert.equal(f.services.locus.workspaces.get(workspace.id).relations.length, 1)
  const reread = await invoke(f.services, ['fs', 'locations', workspace.id])
  assert.match(reread.text, /没有已登记位置/)
})

test('重启恢复 Workspace、关系与位置；缺少 Filesystem 插件时长期事实仍可读', async (t) => {
  const f = fixture(t)
  const workspace = (await invoke(f.services, ['workspace', 'create', 'Restart'])).value
  const location = (await invoke(f.services, ['fs', 'register', workspace.id, f.parent])).value
  const relation = (await invoke(f.services, ['fs', 'confirm', workspace.id, location.id, 'note.txt'])).value

  await f.services.restart()
  const restored = await invoke(f.services, ['--json', 'workspace', 'show', workspace.id])
  assert.equal(restored.value.id, workspace.id)
  assert.equal(restored.value.relations[0].id, relation.id)
  const locations = await invoke(f.services, ['--json', 'fs', 'locations', workspace.id])
  assert.equal(locations.value[0].id, location.id)

  const withoutPlugin = await invoke({ locus: f.services.locus, filesystem: undefined }, ['fs', 'locations', workspace.id])
  assert.match(String(withoutPlugin.error?.message), /Filesystem 能力不可用/)
  const stillThere = await invoke({ locus: f.services.locus, filesystem: undefined }, ['workspace', 'show', workspace.id])
  assert.equal(stillThere.value.relations.length, 1)
})

test('缺少 UI 插件时 ui 命令明确失败', async (t) => {
  const f = fixture(t)
  const result = await invoke(f.services, ['ui'])
  assert.equal(result.exitCode, 2)
  assert.match(String(result.error?.message), /UI 服务不可用/)
})

test('无参数与未知命令返回稳定失败', async (t) => {
  const f = fixture(t)
  const bare = await invoke(f.services, [])
  assert.equal(bare.exitCode, 1)
  assert.match(String(bare.error?.message), /请指定命令/)
  const unknown = await invoke(f.services, ['bogus'])
  assert.equal(unknown.exitCode, 1)
  assert.match(String(unknown.error?.message), /未知命令：bogus/)
})
