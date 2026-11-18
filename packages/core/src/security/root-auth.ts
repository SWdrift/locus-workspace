import { randomUUID } from 'node:crypto'
import { assertNewPassword, createRootVerifier, verifyRootPassword } from './authenticator.ts'
import { SecurityFailure } from './errors.ts'
import type { RootAuthenticationState, RootPasswordVerifier, SecurityStore, SecurityStoreTransaction } from './types.ts'

const AUTHENTICATION_LEASE = 60_000
const LOCK_TTL = 60_000

interface RootAuthenticationDependencies {
  readonly transaction: SecurityStore['transaction']
  readonly clock: () => number
  readonly assertHost: () => void
  readonly revokeGrants: () => void
}

interface AuthenticationAttempt {
  readonly id: string
  readonly generation: number
  readonly verifier: RootPasswordVerifier
}

export interface RootAuthentication {
  initialize(password: string, confirmation: string): Promise<void>
  replace(password: string, confirmation: string): Promise<void>
  beginAttempt(generation: number, password: string): AuthenticationAttempt
  verify(attempt: AuthenticationAttempt, password: string): Promise<boolean>
  finishAttempt(attempt: AuthenticationAttempt, verified: boolean): void
  cancelAttempt(id: string): void
}

export function requireRoot(transaction: SecurityStoreTransaction): RootAuthenticationState {
  const root = transaction.getRoot()
  if (root === undefined) throw new SecurityFailure('security-uninitialized')
  if (
    !Number.isSafeInteger(root.generation) ||
    root.generation < 1 ||
    !Number.isInteger(root.failedAttempts) ||
    root.failedAttempts < 0 ||
    root.failedAttempts > 5
  ) {
    throw new SecurityFailure('security-unavailable')
  }
  return root
}

/** Root 验证材料、持久锁定与 KDF 租约独立于进程内挑战身份。 */
export function createRootAuthentication(deps: RootAuthenticationDependencies): RootAuthentication {
  return Object.freeze({
    async initialize(password: string, confirmation: string): Promise<void> {
      deps.assertHost()
      assertNewPassword(password, confirmation)
      deps.transaction(transaction => {
        if (transaction.getRoot() !== undefined) throw new SecurityFailure('security-already-initialized')
      })
      const verifier = await createRootVerifier(password)
      deps.assertHost()
      deps.transaction(transaction => {
        if (transaction.getRoot() !== undefined) throw new SecurityFailure('security-already-initialized')
        if (transaction.getInstallation() === undefined) transaction.setInstallation({ installationId: randomUUID() })
        transaction.setRoot({ generation: 1, verifier, failedAttempts: 0, lockedUntil: undefined, attempt: undefined })
      })
    },
    async replace(password: string, confirmation: string): Promise<void> {
      deps.assertHost()
      assertNewPassword(password, confirmation)
      const generation = deps.transaction(transaction => requireRoot(transaction).generation)
      const verifier = await createRootVerifier(password)
      deps.assertHost()
      deps.transaction(transaction => {
        if (requireRoot(transaction).generation !== generation) throw new SecurityFailure('grant-revoked')
        transaction.setRoot({
          generation: generation + 1,
          verifier,
          failedAttempts: 0,
          lockedUntil: undefined,
          attempt: undefined,
        })
      })
      deps.revokeGrants()
    },
    beginAttempt(generation: number, password: string): AuthenticationAttempt {
      if (typeof password !== 'string') throw new SecurityFailure('authentication-failed')
      const now = deps.clock()
      const id = randomUUID()
      const verifier = deps.transaction(transaction => {
        const root = requireRoot(transaction)
        if (root.generation !== generation) throw new SecurityFailure('challenge-revoked')
        if (root.lockedUntil !== undefined && now < root.lockedUntil)
          throw new SecurityFailure('authentication-rate-limited')
        if (root.attempt !== undefined && now < root.attempt.expiresAt)
          throw new SecurityFailure('authentication-unavailable')
        const failedAttempts = root.lockedUntil !== undefined ? 1 : Math.min(root.failedAttempts + 1, 5)
        transaction.setRoot({
          ...root,
          failedAttempts,
          lockedUntil: failedAttempts >= 5 ? now + LOCK_TTL : undefined,
          attempt: { id, expiresAt: now + AUTHENTICATION_LEASE },
        })
        return root.verifier
      })
      return { id, generation, verifier }
    },
    async verify(attempt: AuthenticationAttempt, password: string): Promise<boolean> {
      try {
        return await verifyRootPassword(password, attempt.verifier)
      } catch (error) {
        if (error instanceof SecurityFailure) throw error
        throw new SecurityFailure('authentication-unavailable')
      }
    },
    finishAttempt(attempt: AuthenticationAttempt, verified: boolean): void {
      deps.transaction(transaction => {
        const root = requireRoot(transaction)
        if (root.generation !== attempt.generation) throw new SecurityFailure('challenge-revoked')
        if (root.attempt?.id !== attempt.id) throw new SecurityFailure('authentication-unavailable')
        transaction.setRoot({
          ...root,
          failedAttempts: verified ? 0 : root.failedAttempts,
          lockedUntil: verified ? undefined : root.lockedUntil,
          attempt: undefined,
        })
      })
    },
    cancelAttempt(id: string): void {
      deps.transaction(transaction => {
        const root = transaction.getRoot()
        if (root?.attempt?.id === id) {
          transaction.setRoot({
            ...root,
            failedAttempts: Math.max(0, root.failedAttempts - 1),
            lockedUntil: undefined,
            attempt: undefined,
          })
        }
      })
    },
  })
}
