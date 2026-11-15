import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PACKAGES = join(ROOT, 'packages')

test('每个组件包导出合法且唯一的组件定义与能力表', async () => {
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
  assert.equal(modules.get('postgres').module.component.version, '2')
  assert.equal(modules.get('gitea').module.component.version, '2')
  assert.equal(modules.get('remote-targets').module.component.version, '3')
  assert.equal(modules.get('template').module.component.version, '1')

  assert.deepEqual(Object.keys(modules.get('postgres').module.api).sort(), ['list', 'register'])
  assert.deepEqual(Object.keys(modules.get('gitea').module.api).sort(), ['register', 'request'])
  assert.deepEqual(
    Object.keys(modules.get('remote-targets').module.api).sort(),
    ['password-access', 'private-key-access', 'register-password', 'register-private-key'],
  )
  assert.equal(modules.get('template').module.api, undefined)
  for (const { module } of modules.values()) {
    const sourceRoot = join(PACKAGES, module.component.id === 'template' ? 'templates' : module.component.id, 'src')
    for (const file of readdirSync(sourceRoot, { recursive: true }).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(join(sourceRoot, file), 'utf8')
      assert.equal(/\blocus\s+[a-z]/i.test(source), false, `${module.component.id}/${file} 不应包含 CLI 命令文本`)
      assert.equal(source.includes("from 'commander'"), false, `${module.component.id}/${file} 不应依赖 Commander`)
    }
    const info = JSON.stringify(module.component.info ?? {})
    assert.equal(/\blocus\s+[a-z]/i.test(info), false, `${module.component.id} 的 info 不应包含 CLI 命令`)
    assert.equal(Object.isFrozen(module.component), true)
    if (module.api !== undefined) assert.equal(Object.isFrozen(module.api), true)
    for (const capability of module.component.capabilities ?? []) {
      assert.equal('run' in capability, false, `${module.component.id}:${capability.id} 的 handler 不应进入组件定义`)
    }
    assert.deepEqual(
      Object.keys(module.api ?? {}).sort(),
      (module.component.capabilities ?? []).map((capability) => capability.id).sort(),
    )
  }
})
