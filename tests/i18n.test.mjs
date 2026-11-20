import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { createI18nRegistry, i18n as core } from '../packages/core/lib/i18n/index.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const COMPONENTS = join(ROOT, 'components')

const modules = []
for (const entry of readdirSync(COMPONENTS, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  modules.push({
    name: entry.name,
    module: await import(pathToFileURL(join(COMPONENTS, entry.name, 'lib', 'index.js')).href),
  })
}
const cli = (await import('../apps/cli/lib/i18n.js')).i18n

test('每个组件包导出自己的 i18n 表，namespace 与组件 id 一致', () => {
  for (const { name, module } of modules) {
    assert.ok(module.i18n, `${name} 缺少 i18n 导出`)
    assert.equal(module.i18n.namespace, module.component.id)
  }
})

test('注册器索引全部 catalog 并拒绝重复 namespace', () => {
  const catalogs = [
    core,
    ...modules.map(entry => entry.module.i18n).filter(catalog => catalog !== undefined),
    cli,
  ]
  const registry = createI18nRegistry(catalogs)
  const namespaces = new Set(registry.entries.map(entry => entry.namespace))
  for (const catalog of catalogs) assert.ok(namespaces.has(catalog.namespace))
  assert.ok(registry.has('core', 'workspace.not-found'))
  assert.ok(registry.has('cli', 'prompt.secret'))
  assert.throws(() => createI18nRegistry([core, core]), /duplicated/)
})

test('插值只替换具名占位符，缺参数保留占位符', () => {
  assert.equal(core.t('workspace.not-found', { reference: 'demo' }), '找不到 Workspace：demo')
  assert.equal(
    core.t('component.write-definition-failed', { path: 'x' }),
    '无法写入组件定义 x：{{detail}}',
  )
  assert.equal(
    core.t('field.relation-source'),
    '可选确认来源对象 {kind:"manual"|"discovery",detail:string}；默认人工显式确认。',
  )
  assert.equal(core.t('component.dependency-cycle'), '依赖循环')
})
