import { randomUUID } from 'node:crypto'
import type { ComponentSpec } from '../components/types.ts'
import { createAuthorization } from './authorization.ts'
import type { Authorization } from './authorization.ts'
import { createCredentialService } from './credentials.ts'
import type { CredentialService } from './credentials.ts'
import { deny, domainOrOperationFailure, operationFailure, providerFailure, SecurityFailure } from './errors.ts'
import { operationHash, snapshotRequest } from './policy.ts'
import type { BoundComponent } from './policy.ts'
import { createRootAuthentication, requireRoot } from './root-auth.ts'
import type { RootAuthentication } from './root-auth.ts'
import type {
  ComponentSecurity,
  HostSecurity,
  OperationCredentialPort,
  SecurityChallenge,
  SecurityGrant,
  SecurityGrantScope,
  SecurityHost,
  SecurityOptions,
  SecurityRequest,
  SecurityService,
  SecuritySession,
  SecuritySource,
  SecurityStoreTransaction,
} from './types.ts'

const CHALLENGE_TTL = 300_000
const GRANT_TTL = 60_000
const IDENTITIES = Object.freeze([
  Object.freeze({ id: 'root' as const, level: 'root' as const }),
  Object.freeze({ id: 'user' as const, level: 'user' as const }),
])

type ChallengeState = 'active' | 'authenticating' | 'used' | 'expired' | 'revoked' | 'cancelled'
type GrantState = 'active' | 'consumed' | 'expired' | 'revoked'

interface SessionRecord {
  readonly session: SecuritySession
  endedAt: number | undefined
  readonly pending: Set<PendingOperation>
}

interface ChallengeRecord {
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
  readonly request: SecurityRequest
  readonly parametersHash: string
  readonly generation: number
  execute: (() => unknown | Promise<unknown>) | undefined
  challenge: ChallengeRecord
  grant: GrantRecord | undefined
  timer: NodeJS.Timeout | undefined
}

class SecurityRuntime {
  readonly service: SecurityService
  readonly host: SecurityHost
  readonly #options: SecurityOptions
  readonly #profile: string
  readonly #clock: () => number
  readonly #authorization: Authorization
  readonly #credentials: CredentialService
  readonly #rootAuthentication: RootAuthentication
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
    this.#authorization = createAuthorization({
      profile: this.#profile,
      definitions,
      clock: this.#clock,
      transaction: operation => this.#transaction(operation),
    })
    this.#credentials = createCredentialService({
      profile: this.#profile,
      clock: this.#clock,
      provider: options.provider,
      transaction: operation => this.#transaction(operation),
    })
    this.#rootAuthentication = createRootAuthentication({
      clock: this.#clock,
      transaction: operation => this.#transaction(operation),
      assertHost: () => this.#assertHost(),
      revokeGrants: () => this.#revokeAllGrants(),
    })
    this.service = Object.freeze({
      status: async () =>
        this.#transaction(transaction => ({
          initialized: transaction.getRoot() !== undefined,
          profile: this.#profile,
          installationId: transaction.getInstallation()?.installationId,
          identities: IDENTITIES,
        })),
      providerStatus: async () => {
        this.#assertActive()
        const provider = this.#options.provider
        if (provider === undefined)
          return {
            id: 'unconfigured',
            backend: 'unconfigured',
            state: 'unavailable' as const,
            nativeBinding: 'not-applicable' as const,
          }
        try {
          return provider.status === undefined
            ? {
                id: provider.id,
                backend: 'injected',
                state: 'unverified' as const,
                nativeBinding: 'not-applicable' as const,
              }
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
      initializeRoot: this.#rootAuthentication.initialize,
      resetRoot: this.#rootAuthentication.replace,
      authenticate: (challenge: SecurityChallenge, password: string, scope?: SecurityGrantScope) =>
        this.#authenticate(challenge, password, scope),
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
      sessionId: randomUUID(),
      userId: 'user',
      source,
      startedAt: this.#clock(),
      get endedAt() {
        return record.endedAt
      },
      get active() {
        return record.endedAt === undefined
      },
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

  #bindComponent(session: SecuritySession, componentId: string): ComponentSecurity {
    this.#assertHost()
    this.#session(session)
    const component = this.#authorization.bind(componentId)
    return Object.freeze({
      execute: <T>(request: SecurityRequest, run: AuthorizedRun<T>) => this.#execute(session, component, request, run),
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
    const { level, generation } = this.#authorization.evaluate(component, request)
    if (level === 'user') {
      return this.#run(session, component, run, false, generation)
    }
    if (generation === 0) throw new SecurityFailure('security-uninitialized')
    const sessionGrant = this.#sessionGrant(current, request, generation)
    if (sessionGrant !== undefined) {
      return this.#run(session, component, run, true, generation)
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
    const record: ChallengeRecord = { state: 'active', operation: undefined, attemptId: undefined }
    const operation: PendingOperation = {
      session: current,
      request,
      parametersHash: operationHash(request),
      generation,
      execute: () => run(this.#credentialPort(session, component, generation, true)),
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
    return this.#credentials.port(component, {
      canWrite,
      assert: transaction => this.#authorizeGeneration(transaction, session, generation),
    })
  }

  #authorizeGeneration(transaction: SecurityStoreTransaction, session: SecuritySession, generation: number): void {
    this.#session(session)
    if (requireRoot(transaction).generation !== generation) throw new SecurityFailure('grant-revoked')
  }

  /** Session Grant 只复用同一真实 Session 内、同组件/operation/参数的授权。 */
  #sessionGrant(session: SessionRecord, request: SecurityRequest, generation: number): GrantRecord | undefined {
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

  #forSession(session: SecuritySession): HostSecurity {
    this.#assertHost()
    this.#session(session)
    return this.#management()
  }

  #management(): HostSecurity {
    this.#assertHost()
    return Object.freeze({
      listCredentials: this.#credentials.listCredentials,
      listBindings: this.#credentials.listBindings,
      deleteCredential: this.#credentials.deleteCredential,
      unbindCredential: this.#credentials.unbindCredential,
      credentialStatus: this.#credentials.credentialStatus,
      cleanupCredentialOrphans: this.#credentials.cleanupCredentialOrphans,
      changeRootPassword: this.#rootAuthentication.replace,
      setOperationLevel: this.#authorization.setOperationLevel,
      clearOperationLevel: this.#authorization.clearOperationLevel,
      listOperationAuthorities: this.#authorization.listOperationAuthorities,
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
    const attempt = this.#rootAuthentication.beginAttempt(operation.generation, password)
    record.state = 'authenticating'
    record.attemptId = attempt.id
    let verified: boolean
    try {
      verified = await this.#rootAuthentication.verify(attempt, password)
    } catch (error) {
      this.#cancelAttempt(record)
      if (record.state === 'authenticating') record.state = 'active'
      if (error instanceof SecurityFailure) throw error
      throw new SecurityFailure('authentication-unavailable')
    }
    this.#assertHost()
    this.#assertAuthenticationPending(record, operation)
    try {
      this.#rootAuthentication.finishAttempt(attempt, verified)
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
    this.#rootAuthentication.cancelAttempt(attemptId)
    record.attemptId = undefined
  }

  #challenge(challenge: SecurityChallenge): { record: ChallengeRecord; operation: PendingOperation } {
    this.#assertHost()
    const record = this.#challenges.get(challenge)
    if (record === undefined) deny('invalid-challenge')
    if (record.state === 'cancelled') throw new SecurityFailure('authentication-cancelled')
    if (record.state === 'expired') throw new SecurityFailure('challenge-expired')
    if (record.state === 'used' || record.state === 'revoked' || record.operation === undefined)
      throw new SecurityFailure('challenge-revoked')
    const operation = record.operation
    if (this.#clock() >= challenge.expiresAt) {
      this.#terminate(operation, 'expired')
      throw new SecurityFailure('challenge-expired')
    }
    this.#session(operation.session.session)
    if (this.#transaction(transaction => requireRoot(transaction).generation) !== operation.generation) {
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
      this.#transaction(transaction => {
        if (requireRoot(transaction).generation !== record.generation) {
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
        return (await execute()) as T
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
    this.#transaction(transaction => {
      if (requireRoot(transaction).generation !== pending.generation) {
        this.#terminate(pending, 'revoked')
        throw new SecurityFailure('grant-revoked')
      }
    })
    const execute = pending.execute!
    this.#terminate(pending, 'consumed')
    try {
      return (await execute()) as T
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

  #revokeAllGrants(): void {
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
      try {
        this.#endSession(session.session)
      } catch (error) {
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
      try {
        this.#closeHost()
      } catch (error) {
        failure = operationFailure(error)
      }
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
