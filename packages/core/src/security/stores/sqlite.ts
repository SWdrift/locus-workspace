import { statSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openCoreDatabase } from '../../storage/database.ts'
import { SecurityFailure } from '../errors.ts'
import {
  assertStoredBinding as assertBinding,
  assertStoredBindingKey,
  assertStoredFields as assertFields,
  assertStoredInstallation as assertInstallation,
  assertStoredLevel as assertLevel,
  assertStoredMetadata as assertMetadata,
  assertStoredOperationKey,
  assertStoredProfile as assertProfile,
  assertStoredReference as assertReference,
  assertStoredRoot as assertRoot,
  compareBindings,
  corruptSecurityStore as corrupt,
} from '../policy.ts'
import type {
  CredentialBinding,
  CredentialMetadata,
  OperationLevelRecord,
  RootAuthenticationState,
  RootPasswordVerifier,
  SecurityInstallation,
  SecurityStore,
  SecurityStoreTransaction,
} from '../types.ts'

type Row = Record<string, unknown>

/**
 * 与 Workspace 共用 core.sqlite，但独立拥有连接。构造不 IO；空目录的只读事务不建库，
 * 首次写入才建立结构。Profile 首次成功写入时登记，安装 UUID 与 Root 在同一目录内共享。
 */
export function createSqliteSecurityStore(dataDirectory: string, profile = 'production'): SecurityStore {
  assertProfile(profile)
  const filename = join(dataDirectory, 'core.sqlite')
  let database: DatabaseSync | undefined
  let disposed = false
  let inTransaction = false

  return {
    transaction<T>(operation: (transaction: SecurityStoreTransaction) => T): T {
      if (disposed) throw new SecurityFailure('security-disposed')
      if (inTransaction) throw new SecurityFailure('io')
      let begun = false
      let active = true
      let written = false
      inTransaction = true
      function assertActive(): void {
        if (!active) throw new SecurityFailure('io')
      }
      function writable(): DatabaseSync {
        assertActive()
        if (!begun) {
          database ??= openCoreDatabase(dataDirectory)
          database.exec('BEGIN IMMEDIATE')
          begun = true
          // 回调先前读取的是不存在的库；其他进程抢先初始化时，不能用旧空快照覆盖。
          if (assertPersistentState(database) !== undefined) throw new SecurityFailure('io')
        }
        written = true
        return database!
      }
      function registerProfile(connection: DatabaseSync, name: string): void {
        const installation = readInstallation(connection)
        if (installation === undefined) corrupt()
        connection
          .prepare(
            `INSERT INTO security_profiles (name, installation_id) VALUES (?, ?)
          ON CONFLICT (name) DO NOTHING`,
          )
          .run(name, installation.installationId)
      }
      try {
        if (database === undefined && statSync(filename, { throwIfNoEntry: false }) !== undefined) {
          database = openCoreDatabase(dataDirectory)
        }
        if (database !== undefined) {
          database.exec('BEGIN IMMEDIATE')
          begun = true
          assertPersistentState(database)
        }
        const transaction: SecurityStoreTransaction = {
          getInstallation() {
            assertActive()
            return begun ? readInstallation(database!) : undefined
          },
          setInstallation(value) {
            assertActive()
            assertInstallation(value)
            const connection = writable()
            const previous = readInstallation(connection)
            if (previous !== undefined && previous.installationId !== value.installationId) corrupt()
            connection
              .prepare(
                `INSERT INTO security_installation (singleton, installation_id) VALUES (1, ?)
              ON CONFLICT (singleton) DO NOTHING`,
              )
              .run(value.installationId)
          },
          getRoot() {
            assertActive()
            return begun ? readRoot(database!) : undefined
          },
          setRoot(value) {
            assertActive()
            assertRoot(value)
            const connection = writable()
            if (readInstallation(connection) === undefined) corrupt()
            connection
              .prepare(
                `INSERT INTO security_root_authentication
              (singleton, generation, verifier_version, algorithm, scrypt_n, scrypt_r, scrypt_p,
               scrypt_maxmem, salt, derived_key, failed_attempts, locked_until, attempt_id, attempt_expires_at)
              VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (singleton) DO UPDATE SET
                generation = excluded.generation, verifier_version = excluded.verifier_version,
                algorithm = excluded.algorithm, scrypt_n = excluded.scrypt_n, scrypt_r = excluded.scrypt_r,
                scrypt_p = excluded.scrypt_p, scrypt_maxmem = excluded.scrypt_maxmem,
                salt = excluded.salt, derived_key = excluded.derived_key,
                failed_attempts = excluded.failed_attempts, locked_until = excluded.locked_until,
                attempt_id = excluded.attempt_id, attempt_expires_at = excluded.attempt_expires_at`,
              )
              .run(
                value.generation,
                value.verifier.version,
                value.verifier.algorithm,
                value.verifier.N,
                value.verifier.r,
                value.verifier.p,
                value.verifier.maxmem,
                value.verifier.salt,
                value.verifier.derivedKey,
                value.failedAttempts,
                value.lockedUntil ?? null,
                value.attempt?.id ?? null,
                value.attempt?.expiresAt ?? null,
              )
          },
          getCredential(name, reference) {
            assertActive()
            assertProfile(name)
            assertReference(reference)
            const row = begun
              ? database!
                  .prepare('SELECT * FROM security_credentials WHERE profile = ? AND reference = ?')
                  .get(name, reference)
              : undefined
            return row === undefined ? undefined : readMetadata(row)
          },
          listCredentials(name) {
            assertActive()
            assertProfile(name)
            return Object.freeze(
              begun
                ? database!
                    .prepare('SELECT * FROM security_credentials WHERE profile = ? ORDER BY reference')
                    .all(name)
                    .map(readMetadata)
                : [],
            )
          },
          setCredential(value) {
            assertActive()
            assertMetadata(value)
            const connection = writable()
            registerProfile(connection, value.profile)
            connection
              .prepare(
                `INSERT INTO security_credentials (profile, reference, provider_id, fields, created_at, updated_at, owner_component)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (profile, reference) DO UPDATE SET provider_id = excluded.provider_id,
                fields = excluded.fields, created_at = excluded.created_at, updated_at = excluded.updated_at,
                owner_component = excluded.owner_component`,
              )
              .run(
                value.profile,
                value.reference,
                value.providerId,
                JSON.stringify(value.fields),
                value.createdAt,
                value.updatedAt,
                value.owner,
              )
          },
          deleteCredential(name, reference) {
            assertActive()
            assertProfile(name)
            assertReference(reference)
            if (!begun) return
            written = true
            database!
              .prepare('DELETE FROM security_credential_bindings WHERE profile = ? AND reference = ?')
              .run(name, reference)
            database!
              .prepare('DELETE FROM security_credentials WHERE profile = ? AND reference = ?')
              .run(name, reference)
          },
          getBinding(name, componentId, slot, resourceKey) {
            assertActive()
            assertStoredBindingKey(name, componentId, slot, resourceKey)
            if (!begun) return undefined
            const row = database!
              .prepare(
                `SELECT * FROM security_credential_bindings
              WHERE profile = ? AND component_id = ? AND slot = ? AND resource_key = ?`,
              )
              .get(name, componentId, slot, resourceKey)
            return row === undefined ? undefined : readBinding(row)
          },
          listBindings(name) {
            assertActive()
            assertProfile(name)
            return Object.freeze(
              begun
                ? database!
                    .prepare(
                      `SELECT * FROM security_credential_bindings
              WHERE profile = ?`,
                    )
                    .all(name)
                    .map(readBinding)
                    .sort(compareBindings)
                : [],
            )
          },
          setBinding(value) {
            assertActive()
            assertBinding(value)
            const connection = writable()
            registerProfile(connection, value.profile)
            connection
              .prepare(
                `INSERT INTO security_credential_bindings
              (profile, component_id, slot, resource_key, reference, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (profile, component_id, slot, resource_key) DO UPDATE SET
                reference = excluded.reference, created_at = excluded.created_at, updated_at = excluded.updated_at`,
              )
              .run(
                value.profile,
                value.componentId,
                value.slot,
                value.resourceKey,
                value.reference,
                value.createdAt,
                value.updatedAt,
              )
          },
          deleteBinding(name, componentId, slot, resourceKey) {
            assertActive()
            assertStoredBindingKey(name, componentId, slot, resourceKey)
            if (!begun) return
            written = true
            database!
              .prepare(
                `DELETE FROM security_credential_bindings
              WHERE profile = ? AND component_id = ? AND slot = ? AND resource_key = ?`,
              )
              .run(name, componentId, slot, resourceKey)
          },
          getOperationLevel(name, componentId, operation) {
            assertActive()
            assertStoredOperationKey(name, componentId, operation)
            if (!begun) return undefined
            const row = database!
              .prepare(
                `SELECT * FROM security_operation_levels
              WHERE profile = ? AND component_id = ? AND operation = ?`,
              )
              .get(name, componentId, operation)
            if (row === undefined) return undefined
            return readLevel(row).level
          },
          listOperationLevels(name) {
            assertActive()
            assertProfile(name)
            return Object.freeze(
              begun
                ? database!
                    .prepare(
                      `SELECT * FROM security_operation_levels
              WHERE profile = ? ORDER BY component_id, operation`,
                    )
                    .all(name)
                    .map(readLevel)
                : [],
            )
          },
          setOperationLevel(value) {
            assertActive()
            assertLevel(value)
            const connection = writable()
            registerProfile(connection, value.profile)
            connection
              .prepare(
                `INSERT INTO security_operation_levels
              (profile, component_id, operation, level, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (profile, component_id, operation) DO UPDATE SET
                level = excluded.level, updated_at = excluded.updated_at`,
              )
              .run(value.profile, value.componentId, value.operation, value.level, value.updatedAt)
          },
          deleteOperationLevel(name, componentId, operation) {
            assertActive()
            assertStoredOperationKey(name, componentId, operation)
            if (!begun) return
            written = true
            database!
              .prepare(
                `DELETE FROM security_operation_levels
              WHERE profile = ? AND component_id = ? AND operation = ?`,
              )
              .run(name, componentId, operation)
          },
        }
        const result = operation(transaction)
        if (result !== null && (typeof result === 'object' || typeof result === 'function') && 'then' in result)
          throw new SecurityFailure('io')
        if (begun) {
          const installation = assertPersistentState(database!)
          if (written && installation !== undefined) registerProfile(database!, profile)
          database!.exec('COMMIT')
          begun = false
        }
        return result
      } catch (error) {
        if (begun) {
          try {
            database!.exec('ROLLBACK')
          } catch {
            throw new SecurityFailure('io')
          }
        }
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
      database?.close()
      database = undefined
    },
  }
}

function parseFields(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'string') corrupt()
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    corrupt()
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) corrupt()
  const fields = parsed as Record<string, string>
  assertFields(fields)
  return Object.freeze(fields)
}

function readInstallation(database: DatabaseSync): SecurityInstallation | undefined {
  const rows = database.prepare('SELECT singleton, installation_id FROM security_installation').all()
  if (rows.length === 0) return undefined
  const row = rows[0]!
  if (rows.length !== 1 || row.singleton !== 1 || typeof row.installation_id !== 'string') corrupt()
  const value = Object.freeze({ installationId: row.installation_id })
  assertInstallation(value)
  return value
}

function readRoot(database: DatabaseSync): RootAuthenticationState | undefined {
  const rows = database.prepare('SELECT * FROM security_root_authentication').all()
  if (rows.length === 0) return undefined
  const row = rows[0]!
  if (rows.length !== 1 || row.singleton !== 1 || (row.attempt_id === null) !== (row.attempt_expires_at === null))
    corrupt()
  const verifier = Object.freeze({
    version: row.verifier_version,
    algorithm: row.algorithm,
    N: row.scrypt_n,
    r: row.scrypt_r,
    p: row.scrypt_p,
    maxmem: row.scrypt_maxmem,
    salt: row.salt,
    derivedKey: row.derived_key,
  }) as RootPasswordVerifier
  const value = Object.freeze({
    generation: row.generation,
    verifier,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until === null ? undefined : row.locked_until,
    attempt:
      row.attempt_id === null ? undefined : Object.freeze({ id: row.attempt_id, expiresAt: row.attempt_expires_at }),
  }) as RootAuthenticationState
  assertRoot(value)
  return value
}

function readMetadata(row: Row): CredentialMetadata {
  const value = Object.freeze({
    reference: row.reference,
    profile: row.profile,
    owner: row.owner_component,
    providerId: row.provider_id,
    fields: parseFields(row.fields),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }) as CredentialMetadata
  assertMetadata(value)
  return value
}

function readBinding(row: Row): CredentialBinding {
  const value = Object.freeze({
    profile: row.profile,
    componentId: row.component_id,
    slot: row.slot,
    resourceKey: row.resource_key,
    reference: row.reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }) as CredentialBinding
  assertBinding(value)
  return value
}

function readLevel(row: Row): OperationLevelRecord {
  const value = Object.freeze({
    profile: row.profile,
    componentId: row.component_id,
    operation: row.operation,
    level: row.level,
    updatedAt: row.updated_at,
  }) as OperationLevelRecord
  assertLevel(value)
  return value
}

/** 安装与 Root 必须一起提交；只有元数据恢复绝不表示资源秘密也已恢复。 */
function assertPersistentState(database: DatabaseSync): SecurityInstallation | undefined {
  const installation = readInstallation(database)
  const root = readRoot(database)
  if ((installation === undefined) !== (root === undefined)) corrupt()
  for (const row of database.prepare('SELECT name, installation_id FROM security_profiles').all()) {
    if (typeof row.name !== 'string') corrupt()
    assertProfile(row.name)
    if (installation === undefined || row.installation_id !== installation.installationId) corrupt()
  }
  if (root === undefined && database.prepare('SELECT 1 FROM security_credentials LIMIT 1').get() !== undefined)
    corrupt()
  return installation
}
