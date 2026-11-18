import { SecurityFailure } from '../errors.ts'
import {
  assertStoredBinding,
  assertStoredBindingKey,
  assertStoredInstallation,
  assertStoredLevel,
  assertStoredMetadata,
  assertStoredOperationKey,
  assertStoredProfile,
  assertStoredReference,
  assertStoredRoot,
  compareBindings,
  compareOperationLevels,
  corruptSecurityStore,
} from '../policy.ts'
import type {
  CredentialBinding,
  CredentialMetadata,
  CredentialRef,
  OperationLevelRecord,
  RootAuthenticationState,
  SecurityInstallation,
  SecurityLevel,
  SecurityStore,
  SecurityStoreTransaction,
} from '../types.ts'

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
      let active = true
      let nextInstallation = installation
      let nextRoot = root
      let nextCredentials = credentials
      let nextBindings = bindings
      let nextLevels = levels
      function assertActive(): void {
        if (!active) throw new SecurityFailure('io')
      }
      function requireInstallation(): void {
        if (nextInstallation === undefined) corruptSecurityStore()
      }
      function bindingKey(componentId: string, slot: string, resourceKey: string): string {
        return JSON.stringify([componentId, slot, resourceKey])
      }
      function levelKey(componentId: string, operation: string): string {
        return JSON.stringify([componentId, operation])
      }
      function writableCredentials(): Map<string, Map<CredentialRef, CredentialMetadata>> {
        if (nextCredentials === credentials) {
          nextCredentials = new Map<string, Map<CredentialRef, CredentialMetadata>>(
            Array.from(credentials, ([profile, values]) => [profile, new Map(values)]),
          )
        }
        return nextCredentials
      }
      function writableBindings(): Map<string, Map<string, CredentialBinding>> {
        if (nextBindings === bindings) {
          nextBindings = new Map<string, Map<string, CredentialBinding>>(
            Array.from(bindings, ([profile, values]) => [profile, new Map(values)]),
          )
        }
        return nextBindings
      }
      function writableLevels(): Map<string, Map<string, OperationLevelRecord>> {
        if (nextLevels === levels) {
          nextLevels = new Map<string, Map<string, OperationLevelRecord>>(
            Array.from(levels, ([profile, values]) => [profile, new Map(values)]),
          )
        }
        return nextLevels
      }
      const transaction: SecurityStoreTransaction = {
        getInstallation() {
          assertActive()
          return nextInstallation
        },
        setInstallation(value) {
          assertActive()
          assertStoredInstallation(value)
          if (nextInstallation !== undefined && nextInstallation.installationId !== value.installationId)
            corruptSecurityStore()
          nextInstallation = Object.freeze({ installationId: value.installationId })
        },
        getRoot() {
          assertActive()
          return nextRoot
        },
        setRoot(value) {
          assertActive()
          assertStoredRoot(value)
          requireInstallation()
          nextRoot = Object.freeze({
            generation: value.generation,
            verifier: Object.freeze({
              version: value.verifier.version,
              algorithm: value.verifier.algorithm,
              N: value.verifier.N,
              r: value.verifier.r,
              p: value.verifier.p,
              maxmem: value.verifier.maxmem,
              salt: value.verifier.salt,
              derivedKey: value.verifier.derivedKey,
            }),
            failedAttempts: value.failedAttempts,
            lockedUntil: value.lockedUntil,
            attempt:
              value.attempt === undefined
                ? undefined
                : Object.freeze({ id: value.attempt.id, expiresAt: value.attempt.expiresAt }),
          })
        },
        getCredential(profile, reference) {
          assertActive()
          assertStoredProfile(profile)
          assertStoredReference(reference)
          return nextCredentials.get(profile)?.get(reference)
        },
        listCredentials(profile) {
          assertActive()
          assertStoredProfile(profile)
          return Object.freeze(
            Array.from(nextCredentials.get(profile)?.values() ?? []).sort((left, right) =>
              left.reference < right.reference ? -1 : left.reference > right.reference ? 1 : 0,
            ),
          )
        },
        setCredential(value) {
          assertActive()
          assertStoredMetadata(value)
          requireInstallation()
          const writable = writableCredentials()
          let profile = writable.get(value.profile)
          if (profile === undefined) {
            profile = new Map()
            writable.set(value.profile, profile)
          }
          profile.set(
            value.reference,
            Object.freeze({
              reference: value.reference,
              profile: value.profile,
              owner: value.owner,
              providerId: value.providerId,
              fields: Object.freeze({ ...value.fields }),
              createdAt: value.createdAt,
              updatedAt: value.updatedAt,
            }),
          )
        },
        deleteCredential(profile, reference) {
          assertActive()
          assertStoredProfile(profile)
          assertStoredReference(reference)
          if (nextCredentials.get(profile)?.has(reference)) writableCredentials().get(profile)!.delete(reference)
          const values = nextBindings.get(profile)
          if (values !== undefined) {
            for (const [key, value] of values) {
              if (value.reference === reference) writableBindings().get(profile)!.delete(key)
            }
          }
        },
        getBinding(profile, componentId, slot, resourceKey) {
          assertActive()
          assertStoredBindingKey(profile, componentId, slot, resourceKey)
          return nextBindings.get(profile)?.get(bindingKey(componentId, slot, resourceKey))
        },
        listBindings(profile) {
          assertActive()
          assertStoredProfile(profile)
          return Object.freeze(Array.from(nextBindings.get(profile)?.values() ?? []).sort(compareBindings))
        },
        setBinding(value) {
          assertActive()
          assertStoredBinding(value)
          requireInstallation()
          if (nextCredentials.get(value.profile)?.has(value.reference) !== true) throw new SecurityFailure('io')
          const writable = writableBindings()
          let profile = writable.get(value.profile)
          if (profile === undefined) {
            profile = new Map()
            writable.set(value.profile, profile)
          }
          profile.set(
            bindingKey(value.componentId, value.slot, value.resourceKey),
            Object.freeze({
              profile: value.profile,
              componentId: value.componentId,
              slot: value.slot,
              resourceKey: value.resourceKey,
              reference: value.reference,
              createdAt: value.createdAt,
              updatedAt: value.updatedAt,
            }),
          )
        },
        deleteBinding(profile, componentId, slot, resourceKey) {
          assertActive()
          assertStoredBindingKey(profile, componentId, slot, resourceKey)
          const key = bindingKey(componentId, slot, resourceKey)
          if (nextBindings.get(profile)?.has(key) === true) writableBindings().get(profile)?.delete(key)
        },
        getOperationLevel(profile, componentId, operation): SecurityLevel | undefined {
          assertActive()
          assertStoredOperationKey(profile, componentId, operation)
          return nextLevels.get(profile)?.get(levelKey(componentId, operation))?.level
        },
        listOperationLevels(profile) {
          assertActive()
          assertStoredProfile(profile)
          return Object.freeze(Array.from(nextLevels.get(profile)?.values() ?? []).sort(compareOperationLevels))
        },
        setOperationLevel(value) {
          assertActive()
          assertStoredLevel(value)
          requireInstallation()
          const writable = writableLevels()
          let profile = writable.get(value.profile)
          if (profile === undefined) {
            profile = new Map()
            writable.set(value.profile, profile)
          }
          profile.set(
            levelKey(value.componentId, value.operation),
            Object.freeze({
              profile: value.profile,
              componentId: value.componentId,
              operation: value.operation,
              level: value.level,
              updatedAt: value.updatedAt,
            }),
          )
        },
        deleteOperationLevel(profile, componentId, operation) {
          assertActive()
          assertStoredOperationKey(profile, componentId, operation)
          const key = levelKey(componentId, operation)
          if (nextLevels.get(profile)?.has(key) === true) writableLevels().get(profile)?.delete(key)
        },
      }
      inTransaction = true
      try {
        const result = operation(transaction)
        if (result !== null && (typeof result === 'object' || typeof result === 'function') && 'then' in result)
          throw new SecurityFailure('io')
        if ((nextInstallation === undefined) !== (nextRoot === undefined)) corruptSecurityStore()
        installation = nextInstallation
        root = nextRoot
        credentials = nextCredentials
        bindings = nextBindings
        levels = nextLevels
        return result
      } catch (error) {
        if (error instanceof SecurityFailure) throw error
        throw new SecurityFailure('io')
      } finally {
        active = false
        inTransaction = false
      }
    },
    dispose() {
      if (inTransaction) throw new SecurityFailure('io')
      if (disposed) return
      disposed = true
      installation = undefined
      root = undefined
      credentials.clear()
      bindings.clear()
      levels.clear()
    },
  }
}
