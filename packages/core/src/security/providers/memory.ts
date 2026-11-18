import { SecurityFailure } from '../errors.ts'
import type { CredentialProvider } from '../types.ts'

/** 仅显式注入的测试/开发保管器；不访问 Keyring、文件或环境变量。 */
export function createMemoryCredentialProvider(): CredentialProvider {
  const secrets = new Map<string, Map<string, string>>()
  let disposed = false
  function assertActive(): void {
    if (disposed) throw new SecurityFailure('provider-unavailable')
  }
  return {
    id: 'memory',
    async status() {
      return {
        id: 'memory',
        backend: 'memory',
        state: disposed ? 'unavailable' : 'ready',
        nativeBinding: 'not-applicable',
      }
    },
    async get(key) {
      assertActive()
      return secrets.get(key.service)?.get(key.account)
    },
    async set(key, secret) {
      assertActive()
      let service = secrets.get(key.service)
      if (service === undefined) {
        service = new Map()
        secrets.set(key.service, service)
      }
      service.set(key.account, secret)
    },
    async delete(key) {
      assertActive()
      const service = secrets.get(key.service)
      service?.delete(key.account)
      if (service?.size === 0) secrets.delete(key.service)
    },
    async list(service) {
      assertActive()
      return Object.freeze(Array.from(secrets.get(service)?.keys() ?? []).sort())
    },
    dispose() {
      disposed = true
      secrets.clear()
    },
  }
}
