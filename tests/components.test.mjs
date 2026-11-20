import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const COMPONENTS = join(ROOT, 'components')

test('每个组件包导出唯一的组件定义与 operation 表', async () => {
  const directories = readdirSync(COMPONENTS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  const seen = new Set()
  const modules = new Map()
  for (const directory of directories) {
    const manifest = JSON.parse(readFileSync(join(COMPONENTS, directory, 'package.json'), 'utf8'))
    const module = await import(
      pathToFileURL(join(COMPONENTS, directory, 'lib', 'index.js')).href
    )
    const component = module.component
    assert.equal(typeof component?.id, 'string', `${manifest.name} 缺少 component 导出`)
    assert.equal(component.kind, 'locus', `${manifest.name} 必须导出 locus 组件`)
    assert.equal(Object.isFrozen(component), true)
    assert.equal(seen.has(component.id), false, `组件 id 重复：${component.id}`)
    seen.add(component.id)
    modules.set(component.id, { manifest, module })
  }
  assert.deepEqual([...seen].sort(), ['remote-targets', 'template'])

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

  }
})
