import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PACKAGES = join(ROOT, 'packages')

test('每个非 Core 包导出合法且唯一的组件定义', async () => {
  const directories = readdirSync(PACKAGES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'core')
    .map((entry) => entry.name)
  assert.deepEqual(directories.sort(), ['remote-targets', 'templates'])

  const seen = new Set()
  for (const directory of directories) {
    const manifest = JSON.parse(readFileSync(join(PACKAGES, directory, 'package.json'), 'utf8'))
    const module = await import(
      pathToFileURL(join(PACKAGES, directory, 'lib', 'index.js')).href
    )
    const component = module.component
    assert.equal(typeof component?.id, 'string', `${manifest.name} 缺少 component 导出`)
    assert.equal(component.kind, 'locus', `${manifest.name} 必须导出 locus 组件`)
    assert.equal(Object.isFrozen(component), true)
    assert.equal(seen.has(component.id), false, `组件 id 重复：${component.id}`)
    seen.add(component.id)
  }
})
