import { randomUUID } from 'node:crypto'
import type { ComponentCredential } from '../components/types.ts'
import { deny, domainOrOperationFailure, providerFailure, SecurityFailure } from './errors.ts'
import { assertBindingInput, assertCredentialRef, assertResourceKey, credentialDeclaration } from './policy.ts'
import type { BoundComponent } from './policy.ts'
import type {
  CredentialCleanupResult,
  CredentialProvider,
  CredentialProviderKey,
  CredentialRef,
  CredentialStatus,
  CredentialValues,
  HostSecurity,
  OperationCredentialPort,
  SecurityStore,
  SecurityStoreTransaction,
  UnbindCredentialInput,
} from './types.ts'

interface CredentialDependencies {
  readonly profile: string
  readonly clock: () => number
  readonly provider: CredentialProvider | undefined
  readonly transaction: SecurityStore['transaction']
}

interface CredentialAuthorization {
  readonly canWrite: boolean
  readonly assert: (transaction: SecurityStoreTransaction) => void
}

export interface CredentialService extends Pick<
  HostSecurity,
  | 'listCredentials'
  | 'listBindings'
  | 'deleteCredential'
  | 'unbindCredential'
  | 'credentialStatus'
  | 'cleanupCredentialOrphans'
> {
  port(component: BoundComponent, authorization: CredentialAuthorization): OperationCredentialPort
}

interface NormalizedCredentialValues {
  readonly publicFields: Readonly<Record<string, string>>
  readonly secretFields: Readonly<Record<string, string>>
}

const FIELD_NAME = /^[a-z][a-zA-Z0-9]{0,63}$/

/** 凭据用例只接收本次操作的授权断言，不接触 Session 或 Grant 的内部状态。 */
export function createCredentialService(deps: CredentialDependencies): CredentialService {
  function provider(): CredentialProvider {
    if (deps.provider === undefined) throw new SecurityFailure('provider-unavailable')
    return deps.provider
  }

  function service(transaction: SecurityStoreTransaction): string {
    const installation = transaction.getInstallation()
    if (installation === undefined) throw new SecurityFailure('security-uninitialized')
    return `locus:${installation.installationId}:${deps.profile}`
  }

  function providerKey(transaction: SecurityStoreTransaction, reference: CredentialRef): CredentialProviderKey {
    return Object.freeze({ service: service(transaction), account: reference.slice('credential:'.length) })
  }

  async function read<T>(
    component: BoundComponent,
    authorization: CredentialAuthorization,
    slot: string,
    resourceKey: string,
    consume: (values: CredentialValues) => T | Promise<T>,
  ): Promise<T> {
    const declaration = credentialDeclaration(component, slot)
    const key = assertResourceKey(resourceKey)
    const backend = provider()
    const { metadata, key: secretKey } = deps.transaction(transaction => {
      authorization.assert(transaction)
      const binding = transaction.getBinding(deps.profile, component.componentId, slot, key)
      if (binding === undefined) throw new SecurityFailure('credential-missing')
      const metadata = transaction.getCredential(deps.profile, binding.reference)
      if (metadata === undefined) throw new SecurityFailure('credential-missing')
      if (metadata.owner !== component.componentId) deny('credential-reference-owned')
      if (metadata.providerId !== backend.id) throw new SecurityFailure('provider-unavailable')
      return { metadata, key: providerKey(transaction, binding.reference) }
    })
    let raw: string | undefined
    try {
      raw = await backend.get(secretKey)
    } catch (error) {
      throw providerFailure(error)
    }
    if (raw === undefined) throw new SecurityFailure('credential-missing')
    let values: CredentialValues | undefined
    try {
      values = mergeCredentialValues(declaration, metadata.fields, raw)
      deps.transaction(authorization.assert)
      try {
        return await consume(values)
      } catch (error) {
        domainOrOperationFailure(error)
      }
    } finally {
      values = undefined
      raw = undefined
    }
  }

  async function write(
    component: BoundComponent,
    authorization: CredentialAuthorization,
    slot: string,
    resourceKey: string,
    values: CredentialValues,
  ): Promise<CredentialRef> {
    const declaration = credentialDeclaration(component, slot)
    const key = assertResourceKey(resourceKey)
    const normalized = fieldValues(declaration, values)
    const backend = provider()
    const secretJson = JSON.stringify(normalized.secretFields)
    const {
      reference,
      key: secretKey,
      previousSecretWanted,
    } = deps.transaction(transaction => {
      authorization.assert(transaction)
      const binding = transaction.getBinding(deps.profile, component.componentId, slot, key)
      const reference = binding?.reference ?? (`credential:${randomUUID()}` as CredentialRef)
      const metadata = transaction.getCredential(deps.profile, reference)
      if (metadata !== undefined && metadata.owner !== component.componentId) deny('credential-reference-owned')
      if (metadata !== undefined && metadata.providerId !== backend.id)
        throw new SecurityFailure('provider-unavailable')
      return { reference, key: providerKey(transaction, reference), previousSecretWanted: metadata !== undefined }
    })
    let previousSecret: string | undefined
    let written = false
    try {
      if (previousSecretWanted) previousSecret = await backend.get(secretKey)
      await backend.set(secretKey, secretJson)
      written = true
      if ((await backend.get(secretKey)) !== secretJson) throw new SecurityFailure('provider-unavailable')
    } catch (error) {
      if (written) {
        try {
          if (previousSecret === undefined) await backend.delete(secretKey)
          else await backend.set(secretKey, previousSecret)
        } catch {
          throw new SecurityFailure('io')
        }
      }
      throw providerFailure(error)
    }
    try {
      deps.transaction(transaction => {
        authorization.assert(transaction)
        const current = transaction.getCredential(deps.profile, reference)
        if (current !== undefined && current.owner !== component.componentId) deny('credential-reference-owned')
        if (current !== undefined && current.providerId !== backend.id)
          throw new SecurityFailure('provider-unavailable')
        const now = deps.clock()
        transaction.setCredential({
          reference,
          profile: deps.profile,
          owner: current?.owner ?? component.componentId,
          providerId: backend.id,
          fields: normalized.publicFields,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
        })
        const existing = transaction.getBinding(deps.profile, component.componentId, slot, key)
        transaction.setBinding({
          profile: deps.profile,
          componentId: component.componentId,
          slot,
          resourceKey: key,
          reference,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        })
      })
    } catch (error) {
      try {
        if (previousSecret === undefined) await backend.delete(secretKey)
        else await backend.set(secretKey, previousSecret)
      } catch {
        throw new SecurityFailure('io')
      }
      throw error instanceof SecurityFailure ? error : new SecurityFailure('io')
    }
    return reference
  }

  return Object.freeze({
    port(component: BoundComponent, authorization: CredentialAuthorization): OperationCredentialPort {
      return Object.freeze({
        read: <T>(slot: string, resourceKey: string, consume: (values: CredentialValues) => T | Promise<T>) =>
          read(component, authorization, slot, resourceKey, consume),
        write: (slot: string, resourceKey: string, values: CredentialValues) => {
          if (!authorization.canWrite)
            return Promise.reject(new SecurityFailure('access-denied', { reason: 'credential-write-requires-root' }))
          return write(component, authorization, slot, resourceKey, values)
        },
      })
    },
    async listCredentials() {
      return deps.transaction(transaction => transaction.listCredentials(deps.profile))
    },
    async listBindings() {
      return deps.transaction(transaction => transaction.listBindings(deps.profile))
    },
    async deleteCredential(reference: CredentialRef): Promise<void> {
      assertCredentialRef(reference)
      const backend = provider()
      const key = deps.transaction(transaction => {
        const metadata = transaction.getCredential(deps.profile, reference)
        if (metadata !== undefined && metadata.providerId !== backend.id)
          throw new SecurityFailure('provider-unavailable')
        return providerKey(transaction, reference)
      })
      // 先撤销元数据与绑定；删除失败留下的 Provider 条目只允许由 cleanup 清理。
      deps.transaction(transaction => transaction.deleteCredential(deps.profile, reference))
      try {
        await backend.delete(key)
      } catch (error) {
        throw providerFailure(error)
      }
    },
    async unbindCredential(input: UnbindCredentialInput): Promise<boolean> {
      assertBindingInput(input.componentId, input.slot, input.resourceKey)
      return deps.transaction(transaction => {
        const existing = transaction.getBinding(deps.profile, input.componentId, input.slot, input.resourceKey)
        if (existing === undefined) return false
        transaction.deleteBinding(deps.profile, input.componentId, input.slot, input.resourceKey)
        return true
      })
    },
    async credentialStatus(reference: CredentialRef): Promise<CredentialStatus> {
      assertCredentialRef(reference)
      const backend = provider()
      const { metadata, key } = deps.transaction(transaction => {
        const metadata = transaction.getCredential(deps.profile, reference)
        if (metadata === undefined) throw new SecurityFailure('credential-missing')
        if (metadata.providerId !== backend.id) throw new SecurityFailure('provider-unavailable')
        return { metadata, key: providerKey(transaction, reference) }
      })
      try {
        return Object.freeze({ metadata, present: (await backend.get(key)) !== undefined })
      } catch (error) {
        throw providerFailure(error)
      }
    },
    async cleanupCredentialOrphans(apply: boolean): Promise<CredentialCleanupResult> {
      const backend = provider()
      if (backend.list === undefined) throw new SecurityFailure('provider-unavailable')
      const { service: namespace, known } = deps.transaction(transaction => ({
        service: service(transaction),
        known: new Set(
          transaction.listCredentials(deps.profile).map(metadata => metadata.reference.slice('credential:'.length)),
        ),
      }))
      let accounts: readonly string[]
      try {
        accounts = await backend.list(namespace)
      } catch (error) {
        throw providerFailure(error)
      }
      const orphans = accounts.filter(account => !known.has(account))
      if (!apply)
        return Object.freeze({
          service: namespace,
          orphans: Object.freeze(orphans),
          removed: 0,
          remaining: orphans.length,
        })
      let removed = 0
      for (const account of orphans) {
        try {
          await backend.delete({ service: namespace, account })
          removed += 1
        } catch (error) {
          throw providerFailure(error)
        }
      }
      let remaining: number
      try {
        remaining = (await backend.list(namespace)).filter(account => !known.has(account)).length
      } catch (error) {
        throw providerFailure(error)
      }
      return Object.freeze({ service: namespace, orphans: Object.freeze(orphans), removed, remaining })
    },
  })
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  )
}

function fieldValues(credential: ComponentCredential, values: CredentialValues): NormalizedCredentialValues {
  if (!isPlainRecord(values)) deny('invalid-request')
  const declared = new Map(credential.fields.map(field => [field.name, field]))
  const present = new Map<string, string>()
  for (const [name, value] of Object.entries(values)) {
    const field = declared.get(name)
    if (field === undefined || !FIELD_NAME.test(name) || typeof value !== 'string') deny('invalid-request')
    if (value.length === 0) {
      if (field.required) deny('invalid-request')
      continue
    }
    present.set(name, value)
  }
  for (const field of credential.fields) {
    if (field.required && !present.has(field.name)) deny('invalid-request')
  }
  const publicFields: Record<string, string> = Object.create(null) as Record<string, string>
  const secretFields: Record<string, string> = Object.create(null) as Record<string, string>
  for (const field of credential.fields) {
    const value = present.get(field.name)
    if (value === undefined) continue
    if (field.secret) secretFields[field.name] = value
    else publicFields[field.name] = value
  }
  return { publicFields: Object.freeze(publicFields), secretFields: Object.freeze(secretFields) }
}

function parseSecretFields(credential: ComponentCredential, raw: string): Readonly<Record<string, string>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new SecurityFailure('credential-fields-mismatch')
  }
  if (!isPlainRecord(parsed)) throw new SecurityFailure('credential-fields-mismatch')
  const declared = new Map(credential.fields.map(field => [field.name, field]))
  const values: Record<string, string> = Object.create(null) as Record<string, string>
  for (const [name, value] of Object.entries(parsed)) {
    const field = declared.get(name)
    if (field === undefined || !field.secret || typeof value !== 'string' || value.length === 0) {
      throw new SecurityFailure('credential-fields-mismatch')
    }
    values[name] = value
  }
  for (const field of credential.fields) {
    if (field.secret && field.required && values[field.name] === undefined)
      throw new SecurityFailure('credential-fields-mismatch')
  }
  return Object.freeze(values)
}

function mergeCredentialValues(
  credential: ComponentCredential,
  publicFields: Readonly<Record<string, string>>,
  rawSecret: string,
): CredentialValues {
  if (!isPlainRecord(publicFields)) throw new SecurityFailure('credential-fields-mismatch')
  const declared = new Map(credential.fields.map(field => [field.name, field]))
  for (const [name, value] of Object.entries(publicFields)) {
    const field = declared.get(name)
    if (field === undefined || field.secret || typeof value !== 'string' || value.length === 0) {
      throw new SecurityFailure('credential-fields-mismatch')
    }
  }
  for (const field of credential.fields) {
    if (!field.secret && field.required && publicFields[field.name] === undefined)
      throw new SecurityFailure('credential-fields-mismatch')
  }
  return Object.freeze({ ...publicFields, ...parseSecretFields(credential, rawSecret) })
}
