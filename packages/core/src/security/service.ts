import { randomUUID } from 'node:crypto'
import type { ComponentCredential, ComponentSpec } from '../components/spec.ts'
import { assertNewPassword, createRootVerifier, verifyRootPassword } from './authenticator.ts'
import { deny, domainOrOperationFailure, operationFailure, providerFailure, SecurityFailure } from './errors.ts'
import {
  assertCredentialRef,
  assertResourceKey,
  bindTrustedComponent,
  credentialDeclaration,
  operationHash,
  requiredLevel,
  snapshotRequest,
  type BoundComponent,
} from './policy.ts'
import type {
  ClearOperationLevelInput,
  ComponentSecurity,
  CredentialCleanupResult,
  CredentialProviderKey,
  CredentialRef,
  CredentialStatus,
  CredentialValues,
  HostSecurity,
  OperationAuthority,
  OperationCredentialPort,
  RootAuthenticationState,
  SecurityChallenge,
  SecurityGrant,
  SecurityGrantScope,
  SecurityHost,
  SecurityLevel,
  SecurityOptions,
  SecurityRequest,
  SecurityService,
  SecuritySession,
  SecuritySource,
  SecurityStoreTransaction,
  SetOperationLevelInput,
  UnbindCredentialInput,
} from './types.ts'

const CHALLENGE_TTL = 300_000
const GRANT_TTL = 60_000
const AUTHENTICATION_LEASE = 60_000
const LOCK_TTL = 60_000
const IDENTITIES = Object.freeze([
  Object.freeze({ id: 'root' as const, level: 'root' as const }),
  Object.freeze({ id: 'user' as const, level: 'user' as const }),
])
const COMPONENT_ID = /^[a-z][a-z0-9-]{0,63}$/
const OPERATION = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const FIELD_NAME = /^[a-z][a-zA-Z0-9]{0,63}$/

type ChallengeState = 'active' | 'authenticating' | 'used' | 'expired' | 'revoked' | 'cancelled'
type GrantState = 'active' | 'consumed' | 'expired' | 'revoked'

interface SessionRecord {
  readonly session: SecuritySession
  endedAt: number | undefined
  readonly pending: Set<PendingOperation>
}

interface ChallengeRecord {
  readonly challenge: SecurityChallenge
  state: ChallengeState
  operation: PendingOperation | undefined
  attemptId: string | undefined
}

interface GrantRecord {
  readonly grant: SecurityGrant
  readonly session: SessionRecord
  readonly parametersHash: string
  readonly generation: number
  state: GrantState
  operation: PendingOperation | undefined
}

type AuthorizedRun<T> = (credential: OperationCredentialPort) => T | Promise<T>

interface PendingOperation {
  readonly session: SessionRecord
  readonly component: BoundComponent
  readonly request: SecurityRequest
  readonly parametersHash: string
  readonly generation: number
  execute: (() => unknown | Promise<unknown>) | undefined
  challenge: ChallengeRecord
  grant: GrantRecord | undefined
  timer: NodeJS.Timeout | undefined
}

interface NormalizedCredentialValues {
  readonly publicFields: Readonly<Record<string, string>>
  readonly secretFields: Readonly<Record<string, string>>
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function fieldValues(
  credential: ComponentCredential,
  values: CredentialValues,
): NormalizedCredentialValues {
  if (!isPlainRecord(values)) deny('invalid-request')
  const declared = new Map(credential.fields.map((field) => [field.name, field]))
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
  return {
    publicFields: Object.freeze(publicFields),
    secretFields: Object.freeze(secretFields),
  }
}

function parseSecretFields(credential: ComponentCredential, raw: string): Readonly<Record<string, string>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new SecurityFailure('credential-fields-mismatch')
  }
  if (!isPlainRecord(parsed)) throw new SecurityFailure('credential-fields-mismatch')
  const declared = new Map(credential.fields.map((field) => [field.name, field]))
  const values: Record<string, string> = Object.create(null) as Record<string, string>
  for (const [name, value] of Object.entries(parsed)) {
    const field = declared.get(name)
    if (field === undefined || !field.secret || typeof value !== 'string' || value.length === 0) {
      throw new SecurityFailure('credential-fields-mismatch')
    }
    values[name] = value
  }
  for (const field of credential.fields) {
    if (field.secret && field.required && values[field.name] === undefined) {
      throw new SecurityFailure('credential-fields-mismatch')
    }
  }
  return Object.freeze(values)
}

function mergeCredentialValues(
  credential: ComponentCredential,
  publicFields: Readonly<Record<string, string>>,
  rawSecret: string,
): CredentialValues {
  if (!isPlainRecord(publicFields)) throw new SecurityFailure('credential-fields-mismatch')
  const declared = new Map(credential.fields.map((field) => [field.name, field]))
  for (const [name, value] of Object.entries(publicFields)) {
    const field = declared.get(name)
    if (field === undefined || field.secret || typeof value !== 'string' || value.length === 0) {
      throw new SecurityFailure('credential-fields-mismatch')
    }
  }
  for (const field of credential.fields) {
    if (!field.secret && field.required && publicFields[field.name] === undefined) {
      throw new SecurityFailure('credential-fields-mismatch')
    }
  }
  return Object.freeze({ ...publicFields, ...parseSecretFields(credential, rawSecret) })
}

class SecurityRuntime {
  readonly service: SecurityService
  readonly host: SecurityHost
  readonly #options: SecurityOptions
  readonly #profile: string
  readonly #clock: () => number
  readonly #definitions: ReadonlyMap<string, ComponentSpec>
  readonly #sessions = new WeakMap<SecuritySession, SessionRecord>()
  readonly #liveSessions = new Set<SessionRecord>()
  readonly #challenges = new WeakMap<SecurityChallenge, ChallengeRecord>()
  readonly #grants = new WeakMap<SecurityGrant, GrantRecord>()
  readonly #sessionGrants = new WeakMap<SessionRecord, Map<string, GrantRecord>>()
  #disposed = false
  #hostClosed = false

  constructor(options: SecurityOptions, definitions: readonly ComponentSpec[]) {
    this.#options = options
    this.#profile = options.profile ?? 'production'
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(this.#profile)) deny('invalid-request')
    this.#clock = options.clock ?? Date.now
    const byId = new Map<string, ComponentSpec>()
    for (const definition of definitions) {
      if (byId.has(definition.id)) deny('invalid-request')
      byId.set(definition.id, definition)
    }
    this.#definitions = byId
    this.service = Object.freeze({
      status: async () => this.#transaction((transaction) => ({
        initialized: transaction.getRoot() !== undefined,
        profile: this.#profile,
        installationId: transaction.getInstallation()?.installationId,
        identities: IDENTITIES,
      })),
      providerStatus: async () => {
        this.#assertActive()
        const provider = this.#options.provider
        if (provider === undefined) return { id: 'unconfigured', backend: 'unconfigured', state: 'unavailable' as const, nativeBinding: 'not-applicable' as const }
        try {
          return provider.status === undefined
            ? { id: provider.id, backend: 'injected', state: 'unverified' as const, nativeBinding: 'not-applicable' as const }
            : await provider.status()
        } catch (error) {
          throw providerFailure(error)
        }
      },
    })
    this.host = Object.freeze({
      createSession: (source: SecuritySource) => this.#createSession(source),
      endSession: (session: SecuritySession) => this.#endSession(session),
      bindComponent: (session: SecuritySession, componentId: string) => this.#bindComponent(session, componentId),
      forSession: (session: SecuritySession) => this.#forSession(session),
      management: () => this.#management(),
      initializeRoot: (password: string, confirmation: string) => this.#initializeRoot(password, confirmation),
      resetRoot: (password: string, confirmation: string) => this.#replaceRoot(password, confirmation),
      authenticate: (challenge: SecurityChallenge, password: string, scope?: SecurityGrantScope) => (
        this.#authenticate(challenge, password, scope)
      ),
      cancelChallenge: (challenge: SecurityChallenge) => this.#cancelChallenge(challenge),
      resume: <T>(grant: SecurityGrant) => this.#resume<T>(grant),
      close: () => this.#closeHost(),
    })
  }

  #assertActive(): void {
    if (this.#disposed) throw new SecurityFailure('security-disposed')
    if (this.#options.store === undefined) throw new SecurityFailure('security-unavailable')
  }

  #assertHost(): void {
    this.#assertActive()
    if (this.#hostClosed) throw new SecurityFailure('authentication-unavailable')
  }

  #transaction<T>(operation: (transaction: SecurityStoreTransaction) => T): T {
    this.#assertActive()
    try {
      return this.#options.store!.transaction(operation)
    } catch (error) {
      if (error instanceof SecurityFailure) throw error
      throw new SecurityFailure('io')
    }
  }

  #root(transaction: SecurityStoreTransaction): RootAuthenticationState {
    const root = transaction.getRoot()
    if (root === undefined) throw new SecurityFailure('security-uninitialized')
    if (!Number.isSafeInteger(root.generation) || root.generation < 1 || !Number.isInteger(root.failedAttempts) || root.failedAttempts < 0 || root.failedAttempts > 5) {
      throw new SecurityFailure('security-unavailable')
    }
    return root
  }

  #session(session: SecuritySession): SessionRecord {
    this.#assertActive()
    const record = this.#sessions.get(session)
    if (record === undefined) deny('invalid-session')
    if (record.endedAt !== undefined) deny('session-ended')
    return record
  }

  #createSession(source: SecuritySource): SecuritySession {
    this.#assertHost()
    if (source !== 'human' && source !== 'agent' && source !== 'component') deny('invalid-request')
    let record: SessionRecord
    const session: SecuritySession = Object.freeze({
      sessionId: randomUUID(), userId: 'user', source, startedAt: this.#clock(),
      get endedAt() { return record.endedAt },
      get active() { return record.endedAt === undefined },
    })
    record = { session, endedAt: undefined, pending: new Set() }
    this.#sessions.set(session, record)
    this.#liveSessions.add(record)
    return session
  }

  #endSession(session: SecuritySession): void {
    this.#assertHost()
    const record = this.#session(session)
    let failure: SecurityFailure | undefined
    for (const operation of record.pending) {
      try {
        this.#cancelAttempt(operation.challenge)
      } catch (error) {
        failure ??= operationFailure(error)
      } finally {
        this.#terminate(operation, 'revoked')
      }
    }
    this.#revokeSessionGrants(record)
    record.endedAt = this.#clock()
    this.#liveSessions.delete(record)
    if (failure !== undefined) throw failure
  }

  #definition(componentId: string): ComponentSpec {
    if (typeof componentId !== 'string' || !COMPONENT_ID.test(componentId)) deny('invalid-request')
    const definition = this.#definitions.get(componentId)
    if (definition === undefined) deny('untrusted-component')
    return definition
  }

  #bound(componentId: string): BoundComponent {
    return bindTrustedComponent(this.#definition(componentId))
  }

  #bindComponent(session: SecuritySession, componentId: string): ComponentSecurity {
    this.#assertHost()
    this.#session(session)
    const component = this.#bound(componentId)
    return Object.freeze({
      execute: <T>(request: SecurityRequest, run: AuthorizedRun<T>) => (
        this.#execute(session, component, request, run)
      ),
    })
  }

  async #execute<T>(
    session: SecuritySession,
    component: BoundComponent,
    input: SecurityRequest,
    run: AuthorizedRun<T>,
  ): Promise<T> {
    const current = this.#session(session)
    const request = snapshotRequest(input)
    if (request.component !== component.componentId) deny('untrusted-component')
    const { root, override } = this.#transaction((transaction) => ({
      root: transaction.getRoot(),
      override: transaction.getOperationLevel(this.#profile, component.componentId, request.operation),
    }))
    const level = requiredLevel(component, request, override)
    const generation = root?.generation ?? 0
    if (level === 'user') {
      return this.#run(session, component, run, false, generation)
    }
    if (root === undefined) throw new SecurityFailure('security-uninitialized')
    const sessionGrant = this.#sessionGrant(current, request, root.generation)
    if (sessionGrant !== undefined) {
      return this.#run(session, component, run, true, root.generation)
    }
    const challenge: SecurityChallenge = Object.freeze({
      challengeId: randomUUID(),
      sessionId: session.sessionId,
      subject: 'user',
      componentId: component.componentId,
      operation: request.operation,
      parameters: request.parameters,
      expiresAt: this.#clock() + CHALLENGE_TTL,
    })
    const record: ChallengeRecord = { challenge, state: 'active', operation: undefined, attemptId: undefined }
    const operation: PendingOperation = {
      session: current,
      component,
      request,
      parametersHash: operationHash(request),
      generation: root.generation,
      execute: () => run(this.#credentialPort(session, component, root.generation, true)),
      challenge: record,
      grant: undefined,
      timer: undefined,
    }
    record.operation = operation
    this.#challenges.set(challenge, record)
    current.pending.add(operation)
    this.#expireAfter(operation, CHALLENGE_TTL)
    throw new SecurityFailure('authentication-required', { challenge })
  }

  async #run<T>(
    session: SecuritySession,
    component: BoundComponent,
    run: AuthorizedRun<T>,
    canWrite: boolean,
    generation: number,
  ): Promise<T> {
    this.#session(session)
    try {
      return await run(this.#credentialPort(session, component, generation, canWrite))
    } catch (error) {
      domainOrOperationFailure(error)
    }
  }

  #credentialPort(
    session: SecuritySession,
    component: BoundComponent,
    generation: number,
    canWrite: boolean,
  ): OperationCredentialPort {
    return Object.freeze({
      read: <T>(
        slot: string,
        resourceKey: string,
        consume: (values: CredentialValues) => T | Promise<T>,
      ) => this.#readCredential(session, component, slot, resourceKey, generation, consume),
      write: (slot: string, resourceKey: string, values: CredentialValues) => {
        if (!canWrite) return Promise.reject(new SecurityFailure('access-denied', { reason: 'credential-write-requires-root' }))
        return this.#writeCredential(session, component, slot, resourceKey, values, generation)
      },
    })
  }

  #authorizeGeneration(
    transaction: SecurityStoreTransaction,
    session: SecuritySession,
    generation: number,
  ): void {
    this.#session(session)
    if (this.#root(transaction).generation !== generation) throw new SecurityFailure('grant-revoked')
  }

  /** Session Grant 只复用同一真实 Session 内、同组件/operation/参数的授权。 */
  #sessionGrant(
    session: SessionRecord,
    request: SecurityRequest,
    generation: number,
  ): GrantRecord | undefined {
    const grants = this.#sessionGrants.get(session)
    if (grants === undefined) return undefined
    const key = operationHash(request)
    const grant = grants.get(key)
    if (grant === undefined) return undefined
    if (grant.state !== 'active' || grant.generation !== generation) {
      grant.state = 'revoked'
      grant.operation = undefined
      grants.delete(key)
      return undefined
    }
    return grant
  }

  async #readCredential<T>(
    session: SecuritySession,
    component: BoundComponent,
    slot: string,
    resourceKey: string,
    generation: number,
    consume: (values: CredentialValues) => T | Promise<T>,
  ): Promise<T> {
    const declaration = credentialDeclaration(component, slot)
    const key = assertResourceKey(resourceKey)
    const provider = this.#options.provider
    if (provider === undefined) throw new SecurityFailure('provider-unavailable')
    const { metadata, providerKey } = this.#transaction((transaction) => {
      this.#authorizeGeneration(transaction, session, generation)
      const binding = transaction.getBinding(this.#profile, component.componentId, slot, key)
      if (binding === undefined) throw new SecurityFailure('credential-missing')
      const metadata = transaction.getCredential(this.#profile, binding.reference)
      if (metadata === undefined) throw new SecurityFailure('credential-missing')
      if (metadata.owner !== component.componentId) deny('credential-reference-owned')
      if (metadata.providerId !== provider.id) throw new SecurityFailure('provider-unavailable')
      return { metadata, providerKey: this.#providerKey(transaction, binding.reference) }
    })
    let raw: string | undefined
    try {
      raw = await provider.get(providerKey)
    } catch (error) {
      throw providerFailure(error)
    }
    if (raw === undefined) throw new SecurityFailure('credential-missing')
    let values: CredentialValues | undefined
    try {
      values = mergeCredentialValues(declaration, metadata.fields, raw)
      this.#transaction((transaction) => this.#authorizeGeneration(transaction, session, generation))
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

  async #writeCredential(
    session: SecuritySession,
    component: BoundComponent,
    slot: string,
    resourceKey: string,
    values: CredentialValues,
    generation: number,
  ): Promise<CredentialRef> {
    const declaration = credentialDeclaration(component, slot)
    const key = assertResourceKey(resourceKey)
    const normalized = fieldValues(declaration, values)
    const provider = this.#options.provider
    if (provider === undefined) throw new SecurityFailure('provider-unavailable')
    const secretJson = JSON.stringify(normalized.secretFields)
    const { reference, providerKey, previousSecretWanted } = this.#transaction((transaction) => {
      this.#authorizeGeneration(transaction, session, generation)
      const binding = transaction.getBinding(this.#profile, component.componentId, slot, key)
      const reference = binding?.reference ?? `credential:${randomUUID()}` as CredentialRef
      const metadata = transaction.getCredential(this.#profile, reference)
      if (metadata !== undefined && metadata.owner !== component.componentId) deny('credential-reference-owned')
      if (metadata !== undefined && metadata.providerId !== provider.id) throw new SecurityFailure('provider-unavailable')
      return {
        reference,
        providerKey: this.#providerKey(transaction, reference),
        previousSecretWanted: metadata !== undefined,
      }
    })
    let previousSecret: string | undefined
    let written = false
    try {
      if (previousSecretWanted) previousSecret = await provider.get(providerKey)
      await provider.set(providerKey, secretJson)
      written = true
      if (await provider.get(providerKey) !== secretJson) throw new SecurityFailure('provider-unavailable')
    } catch (error) {
      if (written) {
        try {
          if (previousSecret === undefined) await provider.delete(providerKey)
          else await provider.set(providerKey, previousSecret)
        } catch {
          throw new SecurityFailure('io')
        }
      }
      throw providerFailure(error)
    }
    try {
      this.#transaction((transaction) => {
        this.#authorizeGeneration(transaction, session, generation)
        const current = transaction.getCredential(this.#profile, reference)
        if (current !== undefined && current.owner !== component.componentId) deny('credential-reference-owned')
        if (current !== undefined && current.providerId !== provider.id) throw new SecurityFailure('provider-unavailable')
        const now = this.#clock()
        transaction.setCredential({
          reference,
          profile: this.#profile,
          owner: current?.owner ?? component.componentId,
          providerId: provider.id,
          fields: normalized.publicFields,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
        })
        const existing = transaction.getBinding(this.#profile, component.componentId, slot, key)
        transaction.setBinding({
          profile: this.#profile,
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
        if (previousSecret === undefined) await provider.delete(providerKey)
        else await provider.set(providerKey, previousSecret)
      } catch {
        throw new SecurityFailure('io')
      }
      throw error instanceof SecurityFailure ? error : new SecurityFailure('io')
    }
    return reference
  }

  #forSession(session: SecuritySession): HostSecurity {
    this.#assertHost()
    this.#session(session)
    return this.#management()
  }

  #management(): HostSecurity {
    this.#assertHost()
    return Object.freeze({
      listCredentials: async () => this.#transaction((transaction) => transaction.listCredentials(this.#profile)),
      listBindings: async () => this.#transaction((transaction) => transaction.listBindings(this.#profile)),
      deleteCredential: (reference: CredentialRef) => this.#deleteCredential(reference),
      unbindCredential: (input: UnbindCredentialInput) => this.#unbindCredential(input),
      credentialStatus: (reference: CredentialRef) => this.#credentialStatus(reference),
      cleanupCredentialOrphans: (apply: boolean) => this.#cleanupCredentialOrphans(apply),
      changeRootPassword: async (password: string, confirmation: string) => {
        assertNewPassword(password, confirmation)
        await this.#replaceRoot(password, confirmation)
      },
      setOperationLevel: (input: SetOperationLevelInput) => this.#setOperationLevel(input),
      clearOperationLevel: (input: ClearOperationLevelInput) => this.#clearOperationLevel(input),
      listOperationAuthorities: async () => this.#listOperationAuthorities(),
    })
  }

  async #deleteCredential(reference: CredentialRef): Promise<void> {
    assertCredentialRef(reference)
    const provider = this.#options.provider
    if (provider === undefined) throw new SecurityFailure('provider-unavailable')
    const key = this.#transaction((transaction) => {
      const metadata = transaction.getCredential(this.#profile, reference)
      if (metadata !== undefined && metadata.providerId !== provider.id) throw new SecurityFailure('provider-unavailable')
      return this.#providerKey(transaction, reference)
    })
    // 先移除授权与元数据，确保删除中途失败时该引用不能被继续使用；残留条目交由 cleanup 处理。
    this.#transaction((transaction) => transaction.deleteCredential(this.#profile, reference))
    try {
      await provider.delete(key)
    } catch (error) {
      throw providerFailure(error)
    }
  }

  async #unbindCredential(input: UnbindCredentialInput): Promise<boolean> {
    return this.#transaction((transaction) => {
      const existing = transaction.getBinding(
        this.#profile,
        input.componentId,
        input.slot,
        input.resourceKey,
      )
      if (existing === undefined) return false
      transaction.deleteBinding(this.#profile, input.componentId, input.slot, input.resourceKey)
      return true
    })
  }

  async #credentialStatus(reference: CredentialRef): Promise<CredentialStatus> {
    assertCredentialRef(reference)
    const provider = this.#options.provider
    if (provider === undefined) throw new SecurityFailure('provider-unavailable')
    const { metadata, key } = this.#transaction((transaction) => {
      const metadata = transaction.getCredential(this.#profile, reference)
      if (metadata === undefined) throw new SecurityFailure('credential-missing')
      if (metadata.providerId !== provider.id) throw new SecurityFailure('provider-unavailable')
      return { metadata, key: this.#providerKey(transaction, reference) }
    })
    let present = false
    try {
      present = (await provider.get(key)) !== undefined
    } catch (error) {
      throw providerFailure(error)
    }
    return Object.freeze({ metadata, present })
  }

  async #cleanupCredentialOrphans(apply: boolean): Promise<CredentialCleanupResult> {
    const provider = this.#options.provider
    if (provider === undefined || provider.list === undefined) throw new SecurityFailure('provider-unavailable')
    const { service, known } = this.#transaction((transaction) => ({
      service: this.#service(transaction),
      known: new Set(transaction.listCredentials(this.#profile).map((metadata) => metadata.reference.slice('credential:'.length))),
    }))
    let accounts: readonly string[]
    try {
      accounts = await provider.list(service)
    } catch (error) {
      throw providerFailure(error)
    }
    const orphans = accounts.filter((account) => !known.has(account))
    if (!apply) return Object.freeze({ service, orphans: Object.freeze(orphans), removed: 0, remaining: orphans.length })
    let removed = 0
    for (const account of orphans) {
      try {
        await provider.delete({ service, account })
        removed += 1
      } catch (error) {
        throw providerFailure(error)
      }
    }
    let remaining = 0
    try {
      remaining = (await provider.list(service)).filter((account) => !known.has(account)).length
    } catch (error) {
      throw providerFailure(error)
    }
    return Object.freeze({ service, orphans: Object.freeze(orphans), removed, remaining })
  }

  #operationDefinition(componentId: string, operation: string): { component: ComponentSpec; auth: SecurityLevel } {
    if (!COMPONENT_ID.test(componentId) || !OPERATION.test(operation)) deny('invalid-request')
    const component = this.#definition(componentId)
    const found = (component.operations ?? []).find((value) => value.id === operation)
    if (found === undefined) deny('unsupported-operation')
    if (found.auth === 'none') deny('unsupported-operation')
    return { component, auth: found.auth }
  }

  #authority(component: ComponentSpec, operation: string, override: SecurityLevel | undefined): OperationAuthority {
    const declaration = (component.operations ?? []).find((value) => value.id === operation)
    if (declaration === undefined || declaration.auth === 'none') deny('unsupported-operation')
    return Object.freeze({
      componentId: component.id,
      operation,
      defaultAuthLevel: declaration.auth,
      effectiveAuthLevel: override ?? declaration.auth,
      source: override !== undefined ? 'override' : 'operation',
    })
  }

  async #setOperationLevel(input: SetOperationLevelInput): Promise<OperationAuthority> {
    const { component } = this.#operationDefinition(input.componentId, input.operation)
    if (input.level !== 'user' && input.level !== 'root') deny('invalid-request')
    return this.#transaction((transaction) => {
      transaction.setOperationLevel({
        profile: this.#profile,
        componentId: input.componentId,
        operation: input.operation,
        level: input.level,
        updatedAt: this.#clock(),
      })
      return this.#authority(component, input.operation, input.level)
    })
  }

  async #clearOperationLevel(input: ClearOperationLevelInput): Promise<OperationAuthority> {
    const { component } = this.#operationDefinition(input.componentId, input.operation)
    return this.#transaction((transaction) => {
      transaction.deleteOperationLevel(this.#profile, input.componentId, input.operation)
      return this.#authority(component, input.operation, undefined)
    })
  }

  async #listOperationAuthorities(): Promise<readonly OperationAuthority[]> {
    return this.#transaction((transaction) => {
      const overrides = new Map(transaction.listOperationLevels(this.#profile).map((record) => [
        JSON.stringify([record.componentId, record.operation]),
        record.level,
      ]))
      const authorities: OperationAuthority[] = []
      for (const component of this.#definitions.values()) {
        for (const operation of component.operations ?? []) {
          if (operation.auth === 'none') continue
          authorities.push(this.#authority(
            component,
            operation.id,
            overrides.get(JSON.stringify([component.id, operation.id])),
          ))
        }
      }
      return Object.freeze(authorities.sort((left, right) => (
        JSON.stringify([left.componentId, left.operation]).localeCompare(JSON.stringify([right.componentId, right.operation]))
      )))
    })
  }

  async #authenticate(
    challenge: SecurityChallenge,
    password: string,
    scope: SecurityGrantScope = 'operation',
  ): Promise<SecurityGrant> {
    if (scope !== 'operation' && scope !== 'session') deny('invalid-request')
    const { record, operation } = this.#challenge(challenge)
    if (record.state === 'authenticating') throw new SecurityFailure('authentication-unavailable')
    if (typeof password !== 'string') throw new SecurityFailure('authentication-failed')
    const now = this.#clock()
    const attemptId = randomUUID()
    const verifier = this.#transaction((transaction) => {
      const root = this.#root(transaction)
      if (root.generation !== operation.generation) throw new SecurityFailure('challenge-revoked')
      if (root.lockedUntil !== undefined && now < root.lockedUntil) throw new SecurityFailure('authentication-rate-limited')
      if (root.attempt !== undefined && now < root.attempt.expiresAt) throw new SecurityFailure('authentication-unavailable')
      const failedAttempts = root.lockedUntil !== undefined ? 1 : Math.min(root.failedAttempts + 1, 5)
      transaction.setRoot({ ...root, failedAttempts, lockedUntil: failedAttempts >= 5 ? now + LOCK_TTL : undefined, attempt: { id: attemptId, expiresAt: now + AUTHENTICATION_LEASE } })
      return root.verifier
    })
    record.state = 'authenticating'
    record.attemptId = attemptId
    let verified: boolean
    try {
      verified = await verifyRootPassword(password, verifier)
    } catch (error) {
      this.#cancelAttempt(record)
      if (record.state === 'authenticating') record.state = 'active'
      if (error instanceof SecurityFailure) throw error
      throw new SecurityFailure('authentication-unavailable')
    }
    this.#assertHost()
    this.#assertAuthenticationPending(record, operation)
    try {
      this.#transaction((transaction) => {
        const root = this.#root(transaction)
        if (root.generation !== operation.generation) throw new SecurityFailure('challenge-revoked')
        if (root.attempt?.id !== attemptId) throw new SecurityFailure('authentication-unavailable')
        transaction.setRoot({ ...root, failedAttempts: verified ? 0 : root.failedAttempts, lockedUntil: verified ? undefined : root.lockedUntil, attempt: undefined })
      })
    } catch (error) {
      record.attemptId = undefined
      record.state = 'active'
      if (error instanceof SecurityFailure && error.code === 'challenge-revoked') this.#terminate(operation, 'revoked')
      throw error
    }
    record.attemptId = undefined
    record.state = 'active'
    if (!verified) throw new SecurityFailure('authentication-failed')
    this.#challenge(challenge)
    const grant: SecurityGrant = Object.freeze({
      grantId: randomUUID(),
      challengeId: challenge.challengeId,
      sessionId: challenge.sessionId,
      subject: 'user',
      authorizedBy: 'root',
      componentId: challenge.componentId,
      operation: challenge.operation,
      parameters: challenge.parameters,
      scope,
      expiresAt: scope === 'operation' ? this.#clock() + GRANT_TTL : null,
    })
    const grantRecord: GrantRecord = {
      grant,
      session: operation.session,
      parametersHash: operation.parametersHash,
      generation: operation.generation,
      state: 'active',
      operation,
    }
    operation.grant = grantRecord
    record.state = 'used'
    record.operation = undefined
    this.#grants.set(grant, grantRecord)
    if (scope === 'session') {
      const key = operationHash(operation.request)
      let grants = this.#sessionGrants.get(operation.session)
      if (grants === undefined) {
        grants = new Map()
        this.#sessionGrants.set(operation.session, grants)
      }
      grants.set(key, grantRecord)
      clearTimeout(operation.timer)
      operation.timer = undefined
    } else {
      this.#expireAfter(operation, GRANT_TTL)
    }
    return grant
  }

  #assertAuthenticationPending(record: ChallengeRecord, operation: PendingOperation): void {
    if (record.state === 'authenticating' && record.operation === operation) return
    this.#cancelAttempt(record)
    if (record.state === 'cancelled') throw new SecurityFailure('authentication-cancelled')
    if (record.state === 'expired') throw new SecurityFailure('challenge-expired')
    throw new SecurityFailure('challenge-revoked')
  }

  #cancelAttempt(record: ChallengeRecord): void {
    const attemptId = record.attemptId
    if (attemptId === undefined) return
    this.#transaction((transaction) => {
      const root = transaction.getRoot()
      if (root?.attempt?.id === attemptId) transaction.setRoot({ ...root, failedAttempts: Math.max(0, root.failedAttempts - 1), lockedUntil: undefined, attempt: undefined })
    })
    record.attemptId = undefined
  }

  #challenge(challenge: SecurityChallenge): { record: ChallengeRecord; operation: PendingOperation } {
    this.#assertHost()
    const record = this.#challenges.get(challenge)
    if (record === undefined) deny('invalid-challenge')
    if (record.state === 'cancelled') throw new SecurityFailure('authentication-cancelled')
    if (record.state === 'expired') throw new SecurityFailure('challenge-expired')
    if (record.state === 'used' || record.state === 'revoked' || record.operation === undefined) throw new SecurityFailure('challenge-revoked')
    const operation = record.operation
    if (this.#clock() >= challenge.expiresAt) {
      this.#terminate(operation, 'expired')
      throw new SecurityFailure('challenge-expired')
    }
    this.#session(operation.session.session)
    if (this.#transaction((transaction) => this.#root(transaction).generation) !== operation.generation) {
      this.#terminate(operation, 'revoked')
      throw new SecurityFailure('challenge-revoked')
    }
    return { record, operation }
  }

  #cancelChallenge(challenge: SecurityChallenge): void {
    this.#assertHost()
    const record = this.#challenges.get(challenge)
    if (record === undefined) deny('invalid-challenge')
    const operation = record.operation
    if (operation === undefined) {
      if (record.state === 'cancelled') throw new SecurityFailure('authentication-cancelled')
      if (record.state === 'expired') throw new SecurityFailure('challenge-expired')
      throw new SecurityFailure('challenge-revoked')
    }
    try {
      this.#cancelAttempt(record)
    } finally {
      this.#terminate(operation, 'cancelled')
    }
  }

  async #resume<T>(grant: SecurityGrant): Promise<T> {
    this.#assertHost()
    const record = this.#grants.get(grant)
    if (record === undefined) deny('invalid-grant')
    if (grant.scope !== record.grant.scope) throw new SecurityFailure('grant-revoked')
    if (record.state === 'consumed') throw new SecurityFailure('grant-consumed')
    if (record.state === 'expired') throw new SecurityFailure('grant-expired')
    if (record.state === 'revoked') throw new SecurityFailure('grant-revoked')
    const operation = record.operation
    this.#session(record.session.session)
    if (grant.scope === 'session') {
      if (record.state !== 'active') throw new SecurityFailure('grant-consumed')
      this.#transaction((transaction) => {
        if (this.#root(transaction).generation !== record.generation) {
          this.#revokeSessionGrant(record)
          throw new SecurityFailure('grant-revoked')
        }
      })
      if (operation === undefined) throw new SecurityFailure('grant-consumed')
      const execute = operation.execute!
      operation.session.pending.delete(operation)
      clearTimeout(operation.timer)
      operation.timer = undefined
      operation.execute = undefined
      operation.grant = undefined
      record.operation = undefined
      try {
        return await execute() as T
      } catch (error) {
        domainOrOperationFailure(error)
      }
    }
    if (record.operation === undefined) throw new SecurityFailure('grant-revoked')
    const pending = record.operation
    if (grant.expiresAt === null) throw new SecurityFailure('grant-revoked')
    if (this.#clock() >= grant.expiresAt) {
      this.#terminate(pending, 'expired')
      throw new SecurityFailure('grant-expired')
    }
    if (record.parametersHash !== pending.parametersHash) {
      this.#terminate(pending, 'revoked')
      throw new SecurityFailure('grant-revoked')
    }
    this.#transaction((transaction) => {
      if (this.#root(transaction).generation !== pending.generation) {
        this.#terminate(pending, 'revoked')
        throw new SecurityFailure('grant-revoked')
      }
    })
    const execute = pending.execute!
    this.#terminate(pending, 'consumed')
    try {
      return await execute() as T
    } catch (error) {
      domainOrOperationFailure(error)
    }
  }

  #revokeSessionGrant(record: GrantRecord): void {
    if (record.state === 'active') record.state = 'revoked'
    record.operation = undefined
    const grants = this.#sessionGrants.get(record.session)
    if (grants === undefined) return
    for (const [key, value] of grants) {
      if (value === record) grants.delete(key)
    }
  }

  #revokeSessionGrants(session: SessionRecord): void {
    const grants = this.#sessionGrants.get(session)
    if (grants === undefined) return
    for (const record of grants.values()) {
      if (record.state === 'active') record.state = 'revoked'
      record.operation = undefined
    }
    grants.clear()
  }

  #expireAfter(operation: PendingOperation, milliseconds: number): void {
    clearTimeout(operation.timer)
    operation.timer = setTimeout(() => this.#terminate(operation, 'expired'), milliseconds)
    operation.timer.unref()
  }

  #terminate(operation: PendingOperation, state: 'expired' | 'revoked' | 'consumed' | 'cancelled'): void {
    clearTimeout(operation.timer)
    operation.timer = undefined
    operation.execute = undefined
    operation.session.pending.delete(operation)
    if (operation.grant !== undefined) {
      operation.grant.state = state === 'cancelled' ? 'revoked' : state
      operation.grant.operation = undefined
    } else {
      operation.challenge.state = state === 'consumed' ? 'used' : state
    }
    operation.challenge.operation = undefined
  }

  #service(transaction: SecurityStoreTransaction): string {
    const installation = transaction.getInstallation()
    if (installation === undefined) throw new SecurityFailure('security-uninitialized')
    return `locus:${installation.installationId}:${this.#profile}`
  }

  #providerKey(transaction: SecurityStoreTransaction, reference: CredentialRef): CredentialProviderKey {
    return Object.freeze({ service: this.#service(transaction), account: reference.slice('credential:'.length) })
  }

  async #initializeRoot(password: string, confirmation: string): Promise<void> {
    this.#assertHost()
    assertNewPassword(password, confirmation)
    this.#transaction((transaction) => { if (transaction.getRoot() !== undefined) throw new SecurityFailure('security-already-initialized') })
    const verifier = await createRootVerifier(password)
    this.#assertHost()
    this.#transaction((transaction) => {
      if (transaction.getRoot() !== undefined) throw new SecurityFailure('security-already-initialized')
      if (transaction.getInstallation() === undefined) transaction.setInstallation({ installationId: randomUUID() })
      transaction.setRoot({ generation: 1, verifier, failedAttempts: 0, lockedUntil: undefined, attempt: undefined })
    })
  }

  async #replaceRoot(password: string, confirmation: string): Promise<void> {
    this.#assertHost()
    assertNewPassword(password, confirmation)
    const generation = this.#transaction((transaction) => this.#root(transaction).generation)
    const verifier = await createRootVerifier(password)
    this.#assertHost()
    this.#transaction((transaction) => {
      if (this.#root(transaction).generation !== generation) throw new SecurityFailure('grant-revoked')
      transaction.setRoot({ generation: generation + 1, verifier, failedAttempts: 0, lockedUntil: undefined, attempt: undefined })
    })
    for (const session of this.#liveSessions) {
      for (const operation of session.pending) this.#terminate(operation, 'revoked')
      this.#revokeSessionGrants(session)
    }
  }

  #closeHost(): void {
    this.#assertActive()
    if (this.#hostClosed) return
    let failure: SecurityFailure | undefined
    for (const session of this.#liveSessions) {
      try { this.#endSession(session.session) } catch (error) {
        failure ??= operationFailure(error)
      }
    }
    this.#hostClosed = true
    if (failure !== undefined) throw failure
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    let failure: SecurityFailure | undefined
    if (this.#options.store !== undefined) {
      try { this.#closeHost() } catch (error) { failure = operationFailure(error) }
    }
    this.#disposed = true
    try {
      await this.#options.provider?.dispose?.()
    } catch (error) {
      failure ??= providerFailure(error)
    }
    try {
      this.#options.store?.dispose?.()
    } catch {
      failure ??= new SecurityFailure('io')
    }
    if (failure !== undefined) throw failure
  }
}

/** 装配保持同步；构造与取得服务不会打开存储，也不会加载真实 Keyring。 */
export function createSecurityRuntime(
  options: SecurityOptions = {},
  definitions: readonly ComponentSpec[] = [],
): { readonly service: SecurityService; readonly host: SecurityHost; dispose(): Promise<void> } {
  const runtime = new SecurityRuntime(options, definitions)
  options.receiveHost?.(runtime.host)
  return { service: runtime.service, host: runtime.host, dispose: () => runtime.dispose() }
}
