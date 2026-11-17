import { SecurityFailure } from './errors.ts'
import type {
  CredentialBinding,
  CredentialMetadata,
  CredentialProvider,
  CredentialRef,
  OperationLevelRecord,
  RootAuthenticationState,
  SecurityInstallation,
  SecurityLevel,
  SecurityStore,
  SecurityStoreTransaction,
} from './types.ts'

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
      return { id: 'memory', backend: 'memory', state: disposed ? 'unavailable' : 'ready', nativeBinding: 'not-applicable' }
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

/** 内存元数据仅供显式注入，不是用户默认持久化后端。 */
export function createMemorySecurityStore(): SecurityStore {
  let installation: SecurityInstallation | undefined
  let root: RootAuthenticationState | undefined
  let credentials = new Map<string, Map<CredentialRef, CredentialMetadata>>()
  let bindings = new Map<string, Map<string, CredentialBinding>>()
  let levels = new Map<string, Map<string, OperationLevelRecord>>()
  let disposed = false
  let inTransaction = false

  return {
    transaction<T>(operation: (transaction: SecurityStoreTransaction) => T): T {
      if (disposed) throw new SecurityFailure('security-disposed')
      if (inTransaction) throw new SecurityFailure('io')
      let nextInstallation = installation
      let nextRoot = root
      let nextCredentials = credentials
      let nextBindings = bindings
      let nextLevels = levels
      function bindingKey(componentId: string, slot: string, resourceKey: string): string {
        return JSON.stringify([componentId, slot, resourceKey])
      }
      function levelKey(componentId: string, operation: string): string {
        return JSON.stringify([componentId, operation])
      }
      function writableCredentials(): Map<string, Map<CredentialRef, CredentialMetadata>> {
        if (nextCredentials === credentials) {
          nextCredentials = new Map<string, Map<CredentialRef, CredentialMetadata>>(Array.from(credentials, ([profile, values]) => [profile, new Map(values)]))
        }
        return nextCredentials
      }
      function writableBindings(): Map<string, Map<string, CredentialBinding>> {
        if (nextBindings === bindings) {
          nextBindings = new Map<string, Map<string, CredentialBinding>>(Array.from(bindings, ([profile, values]) => [
            profile,
            new Map(Array.from(values, ([key, value]) => [key, Object.freeze({ ...value })])),
          ]))
        }
        return nextBindings
      }
      function writableLevels(): Map<string, Map<string, OperationLevelRecord>> {
        if (nextLevels === levels) {
          nextLevels = new Map<string, Map<string, OperationLevelRecord>>(Array.from(levels, ([profile, values]) => [
            profile,
            new Map(Array.from(values, ([key, value]) => [key, Object.freeze({ ...value })])),
          ]))
        }
        return nextLevels
      }
      const transaction: SecurityStoreTransaction = {
        getInstallation: () => nextInstallation,
        setInstallation(value) {
          nextInstallation = Object.freeze({ ...value })
        },
        getRoot: () => nextRoot,
        setRoot(value) {
          nextRoot = Object.freeze({
            ...value,
            verifier: Object.freeze({ ...value.verifier }),
            attempt: value.attempt === undefined ? undefined : Object.freeze({ ...value.attempt }),
          })
        },
        getCredential: (profile, reference) => nextCredentials.get(profile)?.get(reference),
        listCredentials: (profile) => Object.freeze(Array.from(nextCredentials.get(profile)?.values() ?? [])),
        setCredential(value) {
          const writable = writableCredentials()
          let profile = writable.get(value.profile)
          if (profile === undefined) {
            profile = new Map()
            writable.set(value.profile, profile)
          }
          profile.set(value.reference, Object.freeze({ ...value, fields: Object.freeze({ ...value.fields }) }))
        },
        deleteCredential(profile, reference) {
          if (nextCredentials.get(profile)?.has(reference)) writableCredentials().get(profile)!.delete(reference)
          const values = nextBindings.get(profile)
          if (values !== undefined) {
            for (const [key, value] of values) {
              if (value.reference === reference) writableBindings().get(profile)!.delete(key)
            }
          }
        },
        getBinding(profile, componentId, slot, resourceKey) {
          return nextBindings.get(profile)?.get(bindingKey(componentId, slot, resourceKey))
        },
        listBindings(profile) {
          return Object.freeze(Array.from(nextBindings.get(profile)?.values() ?? []).sort((left, right) => (
            JSON.stringify([left.componentId, left.slot, left.resourceKey])
              .localeCompare(JSON.stringify([right.componentId, right.slot, right.resourceKey]))
          )))
        },
        setBinding(value) {
          const writable = writableBindings()
          let profile = writable.get(value.profile)
          if (profile === undefined) {
            profile = new Map()
            writable.set(value.profile, profile)
          }
          profile.set(bindingKey(value.componentId, value.slot, value.resourceKey), Object.freeze({ ...value }))
        },
        deleteBinding(profile, componentId, slot, resourceKey) {
          const key = bindingKey(componentId, slot, resourceKey)
          if (nextBindings.get(profile)?.has(key) === true) writableBindings().get(profile)?.delete(key)
        },
        getOperationLevel(profile, componentId, operation): SecurityLevel | undefined {
          return nextLevels.get(profile)?.get(levelKey(componentId, operation))?.level
        },
        listOperationLevels(profile) {
          return Object.freeze(Array.from(nextLevels.get(profile)?.values() ?? []).sort((left, right) => (
            JSON.stringify([left.componentId, left.operation]).localeCompare(JSON.stringify([right.componentId, right.operation]))
          )))
        },
        setOperationLevel(value) {
          const writable = writableLevels()
          let profile = writable.get(value.profile)
          if (profile === undefined) {
            profile = new Map()
            writable.set(value.profile, profile)
          }
          profile.set(levelKey(value.componentId, value.operation), Object.freeze({ ...value }))
        },
        deleteOperationLevel(profile, componentId, operation) {
          const key = levelKey(componentId, operation)
          if (nextLevels.get(profile)?.has(key) === true) writableLevels().get(profile)?.delete(key)
        },
      }
      inTransaction = true
      try {
        const result = operation(transaction)
        if (result !== null && typeof result === 'object' && 'then' in result) throw new SecurityFailure('io')
        installation = nextInstallation
        root = nextRoot
        credentials = nextCredentials
        bindings = nextBindings
        levels = nextLevels
        return result
      } finally {
        inTransaction = false
      }
    },
    dispose() {
      disposed = true
      installation = undefined
      root = undefined
      credentials.clear()
      bindings.clear()
      levels.clear()
    },
  }
}
