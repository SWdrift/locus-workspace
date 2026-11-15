import { randomUUID } from 'node:crypto'
import type { ComponentCapability, ComponentCredential, ComponentSpec } from '../components/spec.ts'
import { assertNewPassword, createRootVerifier, verifyRootPassword } from './authenticator.ts'
import { capabilityOrOperationFailure, deny, operationFailure, providerFailure, SecurityFailure } from './errors.ts'
import {
  assertCredentialRef,
  bindTrustedComponent,
  capabilityDeclaration,
  declaredSecret,
  hostComponent,
  operationHash,
  requiredLevel,
  snapshotRequest,
  type BoundComponent,
} from './policy.ts'
import type {
  CapabilityAuthority,
  CapabilityContext,
  ClearCapabilityLevelInput,
  ComponentSecurity,
  CredentialCleanupResult,
  CredentialProviderKey,
  CredentialRef,
  CredentialStatus,
  CredentialValues,
  HostSecurity,
  RootAuthenticationState,
  SecurityChallenge,
  SecurityGrant,
  SecurityHost,
  SecurityLevel,
  SecurityOptions,
  SecurityRequest,
  SecurityService,
  SecuritySession,
  SecuritySource,
  SecurityStoreTransaction,
  SetCapabilityLevelInput,
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
const CAPABILITY = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const SLOT = /^[a-z][a-z0-9-]{0,63}$/
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
  readonly parametersHash: string
  readonly generation: number
  state: GrantState
  operation: PendingOperation | undefined
}

type AuthorizedRun<T> = (request: SecurityRequest, generation: number) => T | Promise<T>

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
  readonly #definitions: ReadonlySet<ComponentSpec>
  readonly #definitionById: ReadonlyMap<string, ComponentSpec>
  readonly #sessions = new WeakMap<SecuritySession, SessionRecord>()
  readonly #liveSessions = new Set<SessionRecord>()
  readonly #challenges = new WeakMap<SecurityChallenge, ChallengeRecord>()
  readonly #grants = new WeakMap<SecurityGrant, GrantRecord>()
  #disposed = false
  #hostClosed = false

  constructor(options: SecurityOptions, definitions: readonly ComponentSpec[]) {
    this.#options = options
    this.#profile = options.profile ?? 'production'
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(this.#profile)) deny('invalid-request')
    this.#clock = options.clock ?? Date.now
    this.#definitions = new Set(definitions)
    this.#definitionById = new Map(definitions.map((definition) => [definition.id, definition]))
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
      bindComponent: (session: SecuritySession, definition: ComponentSpec) => this.#bindComponent(session, definition),
      forSession: (session: SecuritySession) => this.#forSession(session),
      initializeRoot: (password: string, confirmation: string) => this.#initializeRoot(password, confirmation),
      resetRoot: (password: string, confirmation: string) => this.#replaceRoot(password, confirmation),
      authenticate: (challenge: SecurityChallenge, password: string) => this.#authenticate(challenge, password),
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
    record.endedAt = this.#clock()
    this.#liveSessions.delete(record)
    if (failure !== undefined) throw failure
  }

  #bindComponent(session: SecuritySession, definition: ComponentSpec): ComponentSecurity {
    this.#assertHost()
    this.#session(session)
    if (!this.#definitions.has(definition)) deny('untrusted-component')
    if (definition.id === 'host') deny('unauthorized-component')
    const component = bindTrustedComponent(definition)
    return Object.freeze({
      execute: <T>(
        request: SecurityRequest,
        operation: (context: CapabilityContext, snapshot: SecurityRequest) => T | Promise<T>,
      ) => this.#execute(session, component, request, (snapshot, generation) => {
        const context = this.#context(session, component, snapshot, generation)
        return operation(context, snapshot)
      }),
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
    const { root, override } = this.#transaction((transaction) => {
      const currentRoot = this.#root(transaction)
      return {
        root: currentRoot,
        override: component.componentId === 'host'
          ? undefined
          : transaction.getCapabilityLevel(this.#profile, component.componentId, request.capability),
      }
    })
    const level = requiredLevel(component, request, override)
    const declaration = component.componentId === 'host' ? undefined : capabilityDeclaration(component, request)
    this.#preflight(component, declaration, request)
    if (level === 'user') {
      return this.#run(session, run, request, root.generation)
    }
    const operationId = randomUUID()
    const challenge: SecurityChallenge = Object.freeze({
      challengeId: operationId,
      operationId,
      sessionId: session.sessionId,
      subject: 'user',
      componentId: component.componentId,
      capability: request.capability,
      resource: request.resource,
      expiresAt: this.#clock() + CHALLENGE_TTL,
    })
    const record: ChallengeRecord = { challenge, state: 'active', operation: undefined, attemptId: undefined }
    const operation: PendingOperation = {
      session: current,
      component,
      request,
      parametersHash: operationHash(request),
      generation: root.generation,
      execute: () => run(request, root.generation),
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
    run: AuthorizedRun<T>,
    request: SecurityRequest,
    generation: number,
  ): Promise<T> {
    this.#session(session)
    try {
      return await run(request, generation)
    } catch (error) {
      capabilityOrOperationFailure(error)
    }
  }

  #preflight(
    component: BoundComponent,
    declaration: ComponentCapability | undefined,
    request: SecurityRequest,
  ): void {
    if (declaration === undefined) return
    const reads = (declaration.secrets ?? []).filter((secret) => secret.access === 'read')
    if (reads.length === 0) return
    const provider = this.#options.provider
    if (provider === undefined) throw new SecurityFailure('provider-unavailable')
    this.#transaction((transaction) => {
      this.#root(transaction)
      for (const secret of reads) {
        const binding = transaction.getBinding(
          this.#profile,
          component.componentId,
          request.capability,
          request.resource,
          secret.slot,
        )
        if (binding === undefined) deny('credential-binding-mismatch')
        const metadata = transaction.getCredential(this.#profile, binding.reference)
        if (metadata === undefined) throw new SecurityFailure('credential-missing')
        if (metadata.providerId !== provider.id) throw new SecurityFailure('provider-unavailable')
      }
    })
  }

  #context(
    session: SecuritySession,
    component: BoundComponent,
    request: SecurityRequest,
    generation: number,
  ): CapabilityContext {
    return Object.freeze({
      registerCredential: (slot: string, reference: CredentialRef, values: CredentialValues) =>
        this.#registerCredential(session, component, request, generation, slot, reference, values),
      withCredential: <T>(
        slot: string,
        reference: CredentialRef,
        consume: (values: CredentialValues) => T | Promise<T>,
      ) => this.#withCredential(session, component, request, generation, slot, reference, consume),
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

  #credentialFor(component: BoundComponent, slot: string): ComponentCredential {
    if (typeof slot !== 'string' || !SLOT.test(slot)) deny('invalid-request')
    const credential = component.credentials.find((value) => value.id === slot)
    if (credential === undefined) deny('credential-declaration-mismatch')
    return credential
  }

  async #registerCredential(
    session: SecuritySession,
    component: BoundComponent,
    request: SecurityRequest,
    generation: number,
    slot: string,
    reference: CredentialRef,
    values: CredentialValues,
  ): Promise<void> {
    assertCredentialRef(reference)
    const declaration = capabilityDeclaration(component, request)
    if (!declaredSecret(declaration, slot, 'write')) deny('credential-declaration-mismatch')
    const credential = this.#credentialFor(component, slot)
    const normalized = fieldValues(credential, values)
    const provider = this.#options.provider
    if (provider === undefined) throw new SecurityFailure('provider-unavailable')
    const secretJson = JSON.stringify(normalized.secretFields)
    const { key, previous } = this.#transaction((transaction) => {
      this.#authorizeGeneration(transaction, session, generation)
      const previous = transaction.getCredential(this.#profile, reference)
      if (previous !== undefined && previous.providerId !== provider.id) throw new SecurityFailure('provider-unavailable')
      return { key: this.#providerKey(transaction, reference), previous }
    })
    let previousSecret: string | undefined
    try {
      previousSecret = previous === undefined ? undefined : await provider.get(key)
      await provider.set(key, secretJson)
      if (await provider.get(key) !== secretJson) throw new SecurityFailure('provider-unavailable')
    } catch (error) {
      throw providerFailure(error)
    }
    try {
      this.#transaction((transaction) => {
        this.#authorizeGeneration(transaction, session, generation)
        const current = transaction.getCredential(this.#profile, reference)
        if (current !== undefined && current.providerId !== provider.id) throw new SecurityFailure('provider-unavailable')
        const now = this.#clock()
        transaction.setCredential({
          reference,
          profile: this.#profile,
          providerId: provider.id,
          fields: normalized.publicFields,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
        })
        // 同一凭据槽可被多个能力共用；登记一次，为所有声明该槽的能力建立精确绑定。
        const shared = component.capabilities.filter((capability) => (
          (capability.secrets ?? []).some((secret) => secret.slot === slot)
        ))
        for (const capability of shared) {
          const existing = transaction.getBinding(
            this.#profile,
            component.componentId,
            capability.id,
            request.resource,
            slot,
          )
          transaction.setBinding({
            profile: this.#profile,
            componentId: component.componentId,
            capability: capability.id,
            slot,
            resource: request.resource,
            reference,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          })
        }
      })
    } catch (error) {
      try {
        if (previousSecret === undefined) await provider.delete(key)
        else await provider.set(key, previousSecret)
      } catch {
        throw new SecurityFailure('io')
      }
      throw error instanceof SecurityFailure ? error : new SecurityFailure('io')
    }
  }

  async #withCredential<T>(
    session: SecuritySession,
    component: BoundComponent,
    request: SecurityRequest,
    generation: number,
    slot: string,
    reference: CredentialRef,
    consume: (values: CredentialValues) => T | Promise<T>,
  ): Promise<T> {
    assertCredentialRef(reference)
    const declaration = capabilityDeclaration(component, request)
    if (!declaredSecret(declaration, slot, 'read')) deny('credential-declaration-mismatch')
    const credential = this.#credentialFor(component, slot)
    const provider = this.#options.provider
    if (provider === undefined) throw new SecurityFailure('provider-unavailable')
    const { metadata, key } = this.#transaction((transaction) => {
      this.#authorizeGeneration(transaction, session, generation)
      const binding = transaction.getBinding(
        this.#profile,
        component.componentId,
        request.capability,
        request.resource,
        slot,
      )
      if (binding === undefined || binding.reference !== reference) deny('credential-binding-mismatch')
      const metadata = transaction.getCredential(this.#profile, reference)
      if (metadata === undefined) throw new SecurityFailure('credential-missing')
      if (metadata.providerId !== provider.id) throw new SecurityFailure('provider-unavailable')
      return { metadata, key: this.#providerKey(transaction, reference) }
    })
    let raw: string | undefined
    try {
      raw = await provider.get(key)
    } catch (error) {
      throw providerFailure(error)
    }
    if (raw === undefined) throw new SecurityFailure('credential-missing')
    let values: CredentialValues | undefined
    try {
      values = mergeCredentialValues(credential, metadata.fields, raw)
      this.#transaction((transaction) => this.#authorizeGeneration(transaction, session, generation))
      try {
        return await consume(values)
      } catch (error) {
        capabilityOrOperationFailure(error)
      }
    } finally {
      values = undefined
      raw = undefined
    }
  }

  #forSession(session: SecuritySession): HostSecurity {
    this.#assertHost()
    this.#session(session)
    return Object.freeze({
      execute: <T>(request: SecurityRequest, operation: (snapshot: SecurityRequest) => T | Promise<T>) =>
        this.#execute(session, hostComponent(), request, (snapshot) => operation(snapshot)),
      listCredentials: async () => {
        this.#assertHost()
        this.#session(session)
        return this.#transaction((transaction) => { this.#root(transaction); return transaction.listCredentials(this.#profile) })
      },
      listBindings: async () => {
        this.#assertHost()
        this.#session(session)
        return this.#transaction((transaction) => { this.#root(transaction); return transaction.listBindings(this.#profile) })
      },
      deleteCredential: (reference: CredentialRef) => this.#deleteCredential(session, reference),
      unbindCredential: (input: UnbindCredentialInput) => this.#unbindCredential(session, input),
      credentialStatus: (reference: CredentialRef) => this.#credentialStatus(session, reference),
      cleanupCredentialOrphans: (apply: boolean) => this.#cleanupCredentialOrphans(session, apply),
      changeRootPassword: async (password: string, confirmation: string) => {
        assertNewPassword(password, confirmation)
        const request: SecurityRequest = {
          capability: 'root:password:manage',
          resource: { type: 'security', id: 'root' },
          parameters: null,
        }
        return this.#execute(session, hostComponent(), request, () => this.#replaceRoot(password, confirmation))
      },
      setCapabilityLevel: (input: SetCapabilityLevelInput) => this.#setCapabilityLevel(session, input),
      clearCapabilityLevel: (input: ClearCapabilityLevelInput) => this.#clearCapabilityLevel(session, input),
      listCapabilityAuthorities: async () => this.#listCapabilityAuthorities(),
    })
  }

  #credentialRequest(reference: CredentialRef, id = reference.slice('credential:'.length)): SecurityRequest {
    assertCredentialRef(reference)
    return snapshotRequest({
      capability: 'credential:manage',
      resource: { type: 'credential', id },
      parameters: { reference },
    })
  }

  #capabilityRequest(componentId: string, capability: string, parameters: Readonly<Record<string, string>>): SecurityRequest {
    return snapshotRequest({
      capability: 'capability:manage',
      resource: { type: 'capability', id: `${componentId}:${capability}` },
      parameters,
    })
  }

  async #deleteCredential(session: SecuritySession, reference: CredentialRef): Promise<void> {
    this.#assertHost()
    const request = this.#credentialRequest(reference)
    return this.#execute(session, hostComponent(), request, async () => {
      const provider = this.#options.provider
      if (provider === undefined) throw new SecurityFailure('provider-unavailable')
      const key = this.#transaction((transaction) => {
        this.#root(transaction)
        const metadata = transaction.getCredential(this.#profile, reference)
        if (metadata !== undefined && metadata.providerId !== provider.id) throw new SecurityFailure('provider-unavailable')
        return this.#providerKey(transaction, reference)
      })
      try {
        await provider.delete(key)
      } catch (error) {
        throw providerFailure(error)
      }
      this.#session(session)
      this.#transaction((transaction) => transaction.deleteCredential(this.#profile, reference))
    })
  }

  async #unbindCredential(session: SecuritySession, input: UnbindCredentialInput): Promise<boolean> {
    this.#assertHost()
    const request = this.#capabilityRequest(input.componentId, input.capability, { slot: input.slot })
    return this.#execute(session, hostComponent(), request, async () => this.#transaction((transaction) => {
      this.#root(transaction)
      const existing = transaction.getBinding(
        this.#profile,
        input.componentId,
        input.capability,
        input.resource,
        input.slot,
      )
      if (existing === undefined) return false
      transaction.deleteBinding(
        this.#profile,
        input.componentId,
        input.capability,
        input.resource,
        input.slot,
      )
      return true
    }))
  }

  async #credentialStatus(session: SecuritySession, reference: CredentialRef): Promise<CredentialStatus> {
    this.#assertHost()
    const request = this.#credentialRequest(reference)
    return this.#execute(session, hostComponent(), request, async () => {
      const provider = this.#options.provider
      if (provider === undefined) throw new SecurityFailure('provider-unavailable')
      const { metadata, key } = this.#transaction((transaction) => {
        this.#root(transaction)
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
    })
  }

  async #cleanupCredentialOrphans(session: SecuritySession, apply: boolean): Promise<CredentialCleanupResult> {
    this.#assertHost()
    const request = snapshotRequest({
      capability: 'credential:manage',
      resource: { type: 'credential', id: 'orphans' },
      parameters: { apply },
    })
    return this.#execute(session, hostComponent(), request, async () => {
      const provider = this.#options.provider
      if (provider === undefined || provider.list === undefined) throw new SecurityFailure('provider-unavailable')
      const { service, known } = this.#transaction((transaction) => {
        this.#root(transaction)
        return {
          service: this.#service(transaction),
          known: new Set(transaction.listCredentials(this.#profile).map((metadata) => metadata.reference.slice('credential:'.length))),
        }
      })
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
    })
  }

  #definitionFor(componentId: string, capability: string): ComponentSpec {
    if (!COMPONENT_ID.test(componentId) || !CAPABILITY.test(capability)) deny('invalid-request')
    const definition = this.#definitionById.get(componentId)
    if (definition === undefined) deny('unsupported-capability')
    if (!(definition.capabilities ?? []).some((value) => value.id === capability)) deny('unsupported-capability')
    return definition
  }

  #authority(definition: ComponentSpec, capability: string, override: SecurityLevel | undefined): CapabilityAuthority {
    const declaration = (definition.capabilities ?? []).find((value) => value.id === capability)
    if (declaration === undefined) deny('unsupported-capability')
    const defaultAuthLevel = declaration.defaultAuthLevel ?? 'user'
    const effectiveAuthLevel = override ?? defaultAuthLevel
    return Object.freeze({
      componentId: definition.id,
      capability,
      defaultAuthLevel,
      effectiveAuthLevel,
      source: override !== undefined ? 'override' : declaration.defaultAuthLevel === undefined ? 'default' : 'component',
    })
  }

  async #setCapabilityLevel(session: SecuritySession, input: SetCapabilityLevelInput): Promise<CapabilityAuthority> {
    this.#assertHost()
    const definition = this.#definitionFor(input.componentId, input.capability)
    if (input.level !== 'user' && input.level !== 'root') deny('invalid-request')
    const request = this.#capabilityRequest(input.componentId, input.capability, { level: input.level })
    return this.#execute(session, hostComponent(), request, async () => this.#transaction((transaction) => {
      this.#root(transaction)
      const now = this.#clock()
      transaction.setCapabilityLevel({
        profile: this.#profile,
        componentId: input.componentId,
        capability: input.capability,
        level: input.level,
        updatedAt: now,
      })
      return this.#authority(definition, input.capability, input.level)
    }))
  }

  async #clearCapabilityLevel(session: SecuritySession, input: ClearCapabilityLevelInput): Promise<CapabilityAuthority> {
    this.#assertHost()
    const definition = this.#definitionFor(input.componentId, input.capability)
    const request = this.#capabilityRequest(input.componentId, input.capability, { level: 'default' })
    return this.#execute(session, hostComponent(), request, async () => this.#transaction((transaction) => {
      this.#root(transaction)
      transaction.deleteCapabilityLevel(this.#profile, input.componentId, input.capability)
      return this.#authority(definition, input.capability, undefined)
    }))
  }

  async #listCapabilityAuthorities(): Promise<readonly CapabilityAuthority[]> {
    this.#assertHost()
    return this.#transaction((transaction) => {
      this.#root(transaction)
      const overrides = new Map(transaction.listCapabilityLevels(this.#profile).map((record) => [
        JSON.stringify([record.componentId, record.capability]),
        record.level,
      ]))
      const authorities: CapabilityAuthority[] = []
      for (const definition of this.#definitions) {
        for (const capability of definition.capabilities ?? []) {
          authorities.push(this.#authority(
            definition,
            capability.id,
            overrides.get(JSON.stringify([definition.id, capability.id])),
          ))
        }
      }
      return Object.freeze(authorities.sort((left, right) => (
        JSON.stringify([left.componentId, left.capability]).localeCompare(JSON.stringify([right.componentId, right.capability]))
      )))
    })
  }

  async #authenticate(challenge: SecurityChallenge, password: string): Promise<SecurityGrant> {
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
      operationId: challenge.operationId,
      sessionId: challenge.sessionId,
      subject: 'user',
      authorizedBy: 'root',
      componentId: challenge.componentId,
      capability: challenge.capability,
      resource: challenge.resource,
      expiresAt: this.#clock() + GRANT_TTL,
    })
    const grantRecord: GrantRecord = { grant, parametersHash: operation.parametersHash, generation: operation.generation, state: 'active', operation }
    operation.grant = grantRecord
    record.state = 'used'
    record.operation = undefined
    this.#grants.set(grant, grantRecord)
    this.#expireAfter(operation, GRANT_TTL)
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
    if (record.state === 'consumed') throw new SecurityFailure('grant-consumed')
    if (record.state === 'expired') throw new SecurityFailure('grant-expired')
    if (record.state === 'revoked' || record.operation === undefined) throw new SecurityFailure('grant-revoked')
    const operation = record.operation
    if (this.#clock() >= grant.expiresAt) {
      this.#terminate(operation, 'expired')
      throw new SecurityFailure('grant-expired')
    }
    this.#session(operation.session.session)
    if (record.parametersHash !== operation.parametersHash) {
      this.#terminate(operation, 'revoked')
      throw new SecurityFailure('grant-revoked')
    }
    this.#transaction((transaction) => {
      if (this.#root(transaction).generation !== operation.generation) {
        this.#terminate(operation, 'revoked')
        throw new SecurityFailure('grant-revoked')
      }
    })
    const execute = operation.execute!
    this.#terminate(operation, 'consumed')
    try {
      return await execute() as T
    } catch (error) {
      capabilityOrOperationFailure(error)
    }
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
export function createSecurityRuntime(options: SecurityOptions = {}, definitions: readonly ComponentSpec[] = []): { readonly service: SecurityService; dispose(): Promise<void> } {
  const runtime = new SecurityRuntime(options, definitions)
  options.receiveHost?.(runtime.host)
  return { service: runtime.service, dispose: () => runtime.dispose() }
}
