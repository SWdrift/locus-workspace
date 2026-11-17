import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PACKAGES = join(ROOT, 'packages')

test('每个组件包导出唯一的组件定义与 operation 表', async () => {
  const directories = readdirSync(PACKAGES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'core')
    .map((entry) => entry.name)
  const seen = new Set()
  const modules = new Map()
  for (const directory of directories) {
    const manifest = JSON.parse(readFileSync(join(PACKAGES, directory, 'package.json'), 'utf8'))
    const module = await import(
      pathToFileURL(join(PACKAGES, directory, 'lib', 'index.js')).href
    )
    if (module.component === undefined) continue
    const component = module.component
    assert.equal(typeof component?.id, 'string', `${manifest.name} 缺少 component 导出`)
    assert.equal(component.kind, 'locus', `${manifest.name} 必须导出 locus 组件`)
    assert.equal(Object.isFrozen(component), true)
    assert.equal(seen.has(component.id), false, `组件 id 重复：${component.id}`)
    seen.add(component.id)
    modules.set(component.id, { manifest, module })
  }
  assert.deepEqual([...seen].sort(), ['gitea', 'postgres', 'remote-targets', 'template'])
  assert.equal(modules.get('postgres').module.component.version, '4')
  assert.equal(modules.get('gitea').module.component.version, '4')
  assert.equal(modules.get('remote-targets').module.component.version, '5')
  assert.equal(modules.get('template').module.component.version, '2')

  assert.deepEqual(
    modules.get('postgres').module.operations.map((operation) => operation.id),
    ['pg.database.register', 'pg.database.query'],
  )
  assert.deepEqual(
    modules.get('gitea').module.operations.map((operation) => operation.id),
    ['gitea.repository.register', 'gitea.repository.request'],
  )
  assert.deepEqual(
    modules.get('remote-targets').module.operations.map((operation) => operation.id),
    [
      'rt.targets.list', 'rt.target.get', 'rt.target.register', 'rt.target.remove',
      'rt.target.credential.update', 'rt.target.migrate', 'rt.system.read',
      'rt.services.list', 'rt.service.restart', 'rt.job.run',
    ],
  )
  assert.deepEqual(
    modules.get('template').module.operations.map((operation) => operation.id),
    ['template.templates.list', 'template.templates.create'],
  )

  for (const { module } of modules.values()) {
    const { component, operations } = module
    assert.equal(Object.isFrozen(operations), true)
    assert.equal(module.api, undefined)
    assert.deepEqual(
      operations.map((operation) => operation.id).sort(),
      (component.operations ?? []).map((operation) => operation.id).sort(),
    )
    for (const operation of component.operations ?? []) {
      assert.equal('run' in operation, false, `${component.id}:${operation.id} 的 handler 不应进入组件定义`)
      assert.equal('input' in operation, false)
    }
    for (const operation of operations) {
      assert.equal(typeof operation.run, 'function')
      assert.equal(typeof operation.input.parse, 'function')
      assert.equal(typeof operation.output.parse, 'function')
    }
    for (const credential of component.credentials ?? []) {
      assert.equal('input' in credential, false)
      assert.equal('secretFields' in credential, false)
    }

    const sourceRoot = join(PACKAGES, component.id === 'template' ? 'templates' : component.id, 'src')
    for (const file of readdirSync(sourceRoot, { recursive: true }).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(join(sourceRoot, file), 'utf8')
      assert.equal(/\blocus\s+[a-z]/i.test(source), false, `${component.id}/${file} 不应包含 CLI 命令文本`)
      assert.equal(source.includes("from 'commander'"), false, `${component.id}/${file} 不应依赖 Commander`)
    }
    const info = JSON.stringify(component.info ?? {})
    assert.equal(/\blocus\s+[a-z]/i.test(info), false, `${component.id} 的 info 不应包含 CLI 命令`)
    assert.equal(Object.isFrozen(component), true)
  }
})
