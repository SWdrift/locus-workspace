import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { SecurityFailure } from './errors.ts'
import type { RootPasswordVerifier } from './types.ts'

const SCRYPT = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 67108864 } as const)

function derive(password: string, salt: Buffer): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>()
  scrypt(password, salt, 32, SCRYPT, (error, key) => {
    if (error !== null) reject(new SecurityFailure('authentication-unavailable'))
    else resolve(key)
  })
  return promise
}

export function assertNewPassword(password: string, confirmation: string): void {
  if (typeof password !== 'string' || password.length === 0 || typeof confirmation !== 'string' || password !== confirmation) {
    throw new SecurityFailure('authentication-failed')
  }
}

export async function createRootVerifier(password: string): Promise<RootPasswordVerifier> {
  const salt = randomBytes(16)
  let derived: Buffer | undefined
  try {
    derived = await derive(password, salt)
    return Object.freeze({ version: 1, algorithm: 'scrypt', ...SCRYPT, salt: salt.toString('hex'), derivedKey: derived.toString('hex') })
  } finally {
    salt.fill(0)
    derived?.fill(0)
  }
}

export async function verifyRootPassword(password: string, verifier: RootPasswordVerifier): Promise<boolean> {
  if (
    verifier.version !== 1 || verifier.algorithm !== 'scrypt' || verifier.N !== SCRYPT.N || verifier.r !== SCRYPT.r ||
    verifier.p !== SCRYPT.p || verifier.maxmem !== SCRYPT.maxmem || !/^[a-f0-9]{32}$/.test(verifier.salt) ||
    !/^[a-f0-9]{64}$/.test(verifier.derivedKey)
  ) throw new SecurityFailure('security-unavailable')
  const salt = Buffer.from(verifier.salt, 'hex')
  const expected = Buffer.from(verifier.derivedKey, 'hex')
  let actual: Buffer | undefined
  try {
    actual = await derive(password, salt)
    return timingSafeEqual(actual, expected)
  } finally {
    salt.fill(0)
    expected.fill(0)
    actual?.fill(0)
  }
}
