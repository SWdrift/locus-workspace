import assert from 'node:assert/strict'
import test from 'node:test'
import { createOperationCatalog } from '../lib/index.js'

const definition = {
  id: 'test.echo',
  version: 1,
  description: '返回输入文本',
  input: {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: { text: { type: 'string', minLength: 1 } },
  },
  output: {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: { text: { type: 'string' } },
  },
}

function provider(overrides = {}) {
  return {
    operationId: definition.id,
    version: definition.version,
    availability: async () => ({ available: true }),
    async execute(input) {
      return { text: input.text }
    },
    ...overrides,
  }
}

test('Catalog 注册、发现与注销 Definition', () => {
  const catalog = createOperationCatalog()
  const dispose = catalog.register(definition, () => provider())
  assert.deepEqual(catalog.list().map((item) => item.id), ['test.echo'])
  assert.equal(catalog.get('test.echo'), definition)
  dispose()
  assert.deepEqual(catalog.list(), [])
  assert.equal(catalog.get('test.echo'), undefined)
  catalog.dispose()
  assert.throws(() => catalog.list(), /已释放/)
})

test('输入不满足 Schema 时返回 invalid-input 与路径', async () => {
  const catalog = createOperationCatalog()
  catalog.register(definition, () => provider())
  const result = await catalog.invoke('test.echo', { text: '' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'invalid-input')
  assert.equal(result.error.details.some((detail) => detail.includes('/text')), true)
})

test('Definition 未安装与 Provider 未加载分别表达', async () => {
  const empty = createOperationCatalog()
  const missing = await empty.invoke('test.echo', { text: 'x' })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'definition-missing')

  const catalog = createOperationCatalog()
  catalog.register(definition, () => undefined)
  const unavailable = await catalog.availability('test.echo')
  assert.equal(unavailable.state, 'unavailable')
  assert.equal(unavailable.code, 'provider-missing')
  const result = await catalog.invoke('test.echo', { text: 'x' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'provider-missing')
})

test('Provider 版本不匹配时拒绝调用', async () => {
  const catalog = createOperationCatalog()
  catalog.register(definition, () => provider({ version: 2 }))
  const result = await catalog.invoke('test.echo', { text: 'x' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'contract-mismatch')
})

test('Workspace 上下文检查能力选择，未提供上下文时不检查', async () => {
  const capability = { id: 'test.capability', provider: '@locus/test', tags: [] }
  const scoped = { ...definition, capability }
  let selected = false
  const catalog = createOperationCatalog({ isCapabilitySelected: () => selected })
  catalog.register(scoped, () => provider({ operationId: scoped.id }))

  assert.equal((await catalog.invoke(scoped.id, { text: 'x' })).ok, true)
  const rejected = await catalog.invoke(scoped.id, { text: 'x' }, { workspaceId: 'workspace-1' })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.code, 'capability-not-selected')

  selected = true
  assert.equal((await catalog.invoke(scoped.id, { text: 'x' }, { workspaceId: 'workspace-1' })).ok, true)
})

test('领域 Outcome 是 ok 值，执行异常与输出违约是调用错误', async () => {
  const catalog = createOperationCatalog()
  catalog.register(definition, () => provider({
    async execute() {
      return { text: 'unreachable' }
    },
  }))
  const outcome = await catalog.invoke('test.echo', { text: 'x' })
  assert.equal(outcome.ok, true)
  assert.deepEqual(outcome.value, { text: 'unreachable' })

  const throwing = createOperationCatalog()
  throwing.register(definition, () => provider({
    async execute() {
      throw new Error('领域执行失败')
    },
  }))
  const failed = await throwing.invoke('test.echo', { text: 'x' })
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'invocation-error')
  assert.equal(failed.error.message, '领域执行失败')

  const invalid = createOperationCatalog()
  invalid.register(definition, () => provider({
    async execute() {
      return { wrong: true }
    },
  }))
  const mismatch = await invalid.invoke('test.echo', { text: 'x' })
  assert.equal(mismatch.ok, false)
  assert.equal(mismatch.error.code, 'invalid-output')
})
