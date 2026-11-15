import { TextDecoder } from 'node:util'
import type { AsyncEntry } from '@napi-rs/keyring'
import type * as KeyringBinding from '@napi-rs/keyring'
import { providerFailure, SecurityFailure } from './errors.ts'
import type { CredentialProvider, CredentialProviderKey, CredentialProviderStatus } from './types.ts'

/** 原生 Provider 仅由真实宿主使用；测试上下文在加载绑定前硬拒绝。 */
export function createKeyringCredentialProvider(): CredentialProvider {
  let binding: Promise<typeof KeyringBinding> | undefined
  let disposed = false
  const backend = process.platform === 'win32' ? 'windows-credential-manager'
    : process.platform === 'darwin' ? 'macos-keychain'
      : process.platform === 'linux' ? 'linux-secret-service' : 'unsupported'

  function assertActive(): void {
    if (disposed || process.env.NODE_TEST_CONTEXT !== undefined || process.env.NODE_ENV === 'test' || backend === 'unsupported') {
      throw new SecurityFailure('provider-unavailable')
    }
  }

  async function load(): Promise<typeof KeyringBinding> {
    assertActive()
    try {
      binding ??= import('@napi-rs/keyring')
      const loaded = await binding
      assertActive()
      return loaded
    } catch {
      throw new SecurityFailure('provider-unavailable')
    }
  }

  async function entry(key: CredentialProviderKey): Promise<AsyncEntry> {
    const { AsyncEntry: Entry } = await load()
    // Linux 必须是持久 Secret Service；不得使用默认的 keyutils 回退。
    return new Entry(key.service, key.account, process.platform === 'linux' ? { linux: { store: 'secret-service' } } : undefined)
  }

  return {
    id: 'os-keyring',
    async status(): Promise<CredentialProviderStatus> {
      if (disposed || process.env.NODE_TEST_CONTEXT !== undefined || process.env.NODE_ENV === 'test') {
        return { id: 'os-keyring', backend, state: 'unavailable', nativeBinding: 'not-loaded' }
      }
      try {
        await load()
        // 加载成功不证明当前 vault 可读写；状态查询不读取任何条目。
        return { id: 'os-keyring', backend, state: 'unverified', nativeBinding: 'loaded' }
      } catch {
        return { id: 'os-keyring', backend, state: 'unavailable', nativeBinding: 'not-loaded' }
      }
    },
    async get(key) {
      let bytes: number[] | null = null
      let buffer: Buffer | undefined
      try {
        bytes = await (await entry(key)).getSecret()
        assertActive()
        if (bytes === null) return undefined
        buffer = Buffer.from(bytes)
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer)
      } catch (error) {
        throw providerFailure(error)
      } finally {
        bytes?.fill(0)
        buffer?.fill(0)
      }
    },
    async set(key, secret) {
      assertActive()
      const bytes = Buffer.from(secret, 'utf8')
      try {
        if (process.platform === 'win32' && bytes.length > 2560) throw new SecurityFailure('credential-too-large')
        await (await entry(key)).setSecret(bytes)
        assertActive()
      } catch (error) {
        throw providerFailure(error)
      } finally {
        bytes.fill(0)
      }
    },
    async delete(key) {
      try {
        await (await entry(key)).deleteCredential()
        assertActive()
      } catch (error) {
        throw providerFailure(error)
      }
    },
    async list(service) {
      assertActive()
      try {
        // findCredentialsAsync 会返回密码；这里只保留 account，且不写入日志或元数据。
        const { findCredentialsAsync } = await load()
        const credentials = await findCredentialsAsync(service)
        assertActive()
        const accounts = new Set<string>()
        for (const credential of credentials) {
          if (typeof credential.account === 'string' && credential.account.length > 0) accounts.add(credential.account)
        }
        return Object.freeze(Array.from(accounts).sort())
      } catch (error) {
        throw providerFailure(error)
      }
    },
    dispose() {
      disposed = true
      binding = undefined
    },
  }
}
