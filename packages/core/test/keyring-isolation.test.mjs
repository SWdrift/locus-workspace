import assert from 'node:assert/strict'
import test from 'node:test'
import { createKeyringCredentialProvider, createMemoryCredentialProvider } from '../lib/security/index.js'

// 仅证明原生入口被拒绝，不加载绑定，也不创建真实 OS 条目。
test('自动化测试拒绝原生 get/set/delete，状态不把模块或后端标为可用', async () => {
  const provider = createKeyringCredentialProvider()
  const key = { service: 'forbidden-test-native-access', account: 'never-created' }
  for (const action of [() => provider.get(key), () => provider.set(key, 'never-written'), () => provider.delete(key)]) {
    await assert.rejects(action, (error) => error.code === 'provider-unavailable' && error.cause === undefined)
  }
  const status = await provider.status()
  assert.equal(status.state, 'unavailable')
  assert.equal(status.nativeBinding, 'not-loaded')
  await provider.dispose()
})

test('显式内存 Provider 的命名空间与释放隔离秘密', async () => {
  const provider = createMemoryCredentialProvider()
  const production = { service: 'installation:production', account: 'same-id' }
  const development = { service: 'installation:development', account: 'same-id' }
  await provider.set(development, 'isolated-memory-value')
  assert.equal(await provider.get(production), undefined)
  assert.equal(await provider.get(development), 'isolated-memory-value')
  await provider.dispose()
  await assert.rejects(() => provider.get(development), (error) => error.code === 'provider-unavailable')
})
