import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SQLOutputValue, StatementSync } from 'node:sqlite'
import type {
  ConnectionProfile,
  ConnectionProfileInput,
  ConnectionProfileUpdate,
  ConnectionTransport,
} from '@locus/contracts'

interface ProfileRow {
  id: string
  machine_id: string
  name: string
  transport: ConnectionTransport
  target: string
  port: number
  user: string
  proxy_jump: string
  identity_file: string
  known_hosts_file: string
  ssh_config_file: string
  created_at: string
  updated_at: string
}

interface Connection {
  readonly database: DatabaseSync
  readonly byId: StatementSync
  readonly listAll: StatementSync
  readonly listByMachine: StatementSync
  readonly byName: StatementSync
  readonly insert: StatementSync
  readonly update: StatementSync
  readonly remove: StatementSync
}

const COLUMNS =
  'id, machine_id, name, transport, target, port, user, proxy_jump, identity_file, known_hosts_file, ssh_config_file, created_at, updated_at'
const TRANSPORTS: readonly ConnectionTransport[] = ['direct', 'proxy-jump', 'frp']
const SCHEMA_VERSION = 1

function requireText(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${field} 必须是字符串`)
  const trimmed = value.trim()
  if (!allowEmpty && trimmed.length === 0) throw new Error(`${field} 必须是非空字符串`)
  if (value.includes('\0')) throw new Error(`${field} 不能包含 NUL 字符`)
  return trimmed
}

function requirePath(value: unknown, field: string): string {
  return requireText(value, field)
}

function optionalPath(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  return requirePath(value, field)
}

function requireTarget(value: unknown): string {
  const target = requireText(value, 'Connection target')
  if (/[\s\p{Cc}]/u.test(target)) throw new Error('Connection target 不能包含空白或控制字符')
  if (target.startsWith('-')) throw new Error('Connection target 不能以 - 开头')
  return target
}

function optionalTarget(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  const target = requireText(value, field)
  if (/[\s\p{Cc}]/u.test(target)) throw new Error(`${field} 不能包含空白或控制字符`)
  if (target.startsWith('-')) throw new Error(`${field} 不能以 - 开头`)
  return target
}

function requireTransport(value: unknown): ConnectionTransport {
  if (typeof value !== 'string' || !TRANSPORTS.includes(value as ConnectionTransport)) {
    throw new Error(`无效 Connection transport：${String(value)}；必须是 ${TRANSPORTS.join(', ')}`)
  }
  return value as ConnectionTransport
}

function normalizePort(value: unknown): number {
  if (value === undefined || value === null) return 0
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('SSH 端口必须是 1–65535 的整数')
  }
  return value
}

function normalizeProfile(
  input: ConnectionProfileInput,
): Omit<ConnectionProfile, 'id' | 'machineId' | 'createdAt' | 'updatedAt'> {
  const name = requireText(input.name, 'Connection Profile 名称')
  const transport = requireTransport(input.transport)
  const target = requireTarget(input.target)
  const port = normalizePort(input.port)
  const user = optionalTarget(input.user, 'SSH user')
  const proxyJump = optionalTarget(input.proxyJump, 'ProxyJump')
  const identityFile = optionalPath(input.identityFile, 'SSH identity file')
  const knownHostsFile = optionalPath(input.knownHostsFile, 'SSH known_hosts file')
  const sshConfigFile = optionalPath(input.sshConfigFile, 'SSH config file')
  if (transport === 'proxy-jump' && proxyJump === undefined) {
    throw new Error('proxy-jump Profile 必须提供 ProxyJump')
  }
  if (transport !== 'proxy-jump' && proxyJump !== undefined) {
    throw new Error('只有 proxy-jump Profile 可以设置 ProxyJump')
  }
  if (transport === 'frp' && port === 0) {
    throw new Error('frp Profile 必须提供本地 visitor 端口')
  }
  return {
    name,
    transport,
    target,
    ...(port === 0 ? {} : { port }),
    ...(user === undefined ? {} : { user }),
    ...(proxyJump === undefined ? {} : { proxyJump }),
    ...(identityFile === undefined ? {} : { identityFile }),
    ...(knownHostsFile === undefined ? {} : { knownHostsFile }),
    ...(sshConfigFile === undefined ? {} : { sshConfigFile }),
  }
}

function profileFromRow(row: ProfileRow): ConnectionProfile {
  return {
    id: row.id,
    machineId: row.machine_id,
    name: row.name,
    transport: row.transport,
    target: row.target,
    ...(row.port === 0 ? {} : { port: row.port }),
    ...(row.user === '' ? {} : { user: row.user }),
    ...(row.proxy_jump === '' ? {} : { proxyJump: row.proxy_jump }),
    ...(row.identity_file === '' ? {} : { identityFile: row.identity_file }),
    ...(row.known_hosts_file === '' ? {} : { knownHostsFile: row.known_hosts_file }),
    ...(row.ssh_config_file === '' ? {} : { sshConfigFile: row.ssh_config_file }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function decodeRow(row: Record<string, SQLOutputValue>): ProfileRow {
  const {
    id, machine_id, name, transport, target, port, user, proxy_jump,
    identity_file, known_hosts_file, ssh_config_file, created_at, updated_at,
  } = row
  if (
    typeof id !== 'string' || typeof machine_id !== 'string' || typeof name !== 'string' ||
    typeof transport !== 'string' || !TRANSPORTS.includes(transport as ConnectionTransport) ||
    typeof target !== 'string' || typeof port !== 'number' || typeof user !== 'string' ||
    typeof proxy_jump !== 'string' || typeof identity_file !== 'string' ||
    typeof known_hosts_file !== 'string' || typeof ssh_config_file !== 'string' ||
    typeof created_at !== 'string' || typeof updated_at !== 'string'
  ) {
    throw new Error('Connection Profile 记录格式损坏，已保留原数据')
  }
  return {
    id,
    machine_id,
    name,
    transport: transport as ConnectionTransport,
    target,
    port,
    user,
    proxy_jump,
    identity_file,
    known_hosts_file,
    ssh_config_file,
    created_at,
    updated_at,
  }
}

function transaction<T>(database: DatabaseSync, action: () => T): T {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = action()
    database.exec('COMMIT')
    return result
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Connectivity 事务失败，且无法回滚')
    }
    throw error
  }
}

/** 只保存连接约定；不保存凭据、连接结果或外部隧道状态。 */
export class ConnectivityStore {
  private connection: Connection | undefined

  constructor(private readonly dataDirectory: string) {}

  private open(): Connection {
    if (this.connection) return this.connection
    mkdirSync(this.dataDirectory, { recursive: true })
    const filename = join(this.dataDirectory, 'connectivity.sqlite')
    let database: DatabaseSync | undefined
    try {
      database = new DatabaseSync(filename, { timeout: 1000 })
      const integrity = database.prepare('PRAGMA integrity_check').all()
      if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
        throw new Error('Connectivity 数据库完整性检查失败，已保留原数据')
      }
      const version = database.prepare('PRAGMA user_version').get()?.user_version
      const objects = database.prepare('SELECT name FROM sqlite_schema').all()
      if (version !== SCHEMA_VERSION) {
        if (version !== 0 || objects.length !== 0) {
          throw new Error(
            version === 0
              ? 'Connectivity 数据库已有结构但无版本，拒绝覆盖；请备份后手工处理'
              : `Connectivity 数据格式版本 ${String(version)} 不受支持，需要版本 ${SCHEMA_VERSION}；已保留原数据`,
          )
        }
      }
      if (database.prepare('PRAGMA journal_mode = DELETE').get()?.journal_mode !== 'delete') {
        throw new Error('Connectivity 数据库无法采用 journal_mode=DELETE')
      }
      database.exec('PRAGMA synchronous = FULL')
      if (version === 0) {
        transaction(database, () => {
          const current = database?.prepare('PRAGMA user_version').get()?.user_version
          if (current === SCHEMA_VERSION) return
          if (current !== 0 || database?.prepare('SELECT name FROM sqlite_schema').all().length !== 0) {
            throw new Error('拒绝初始化已有结构或未知版本的 Connectivity 数据库')
          }
          database?.exec(`
            CREATE TABLE profiles (
              id TEXT PRIMARY KEY NOT NULL,
              machine_id TEXT NOT NULL,
              name TEXT NOT NULL CHECK (length(trim(name)) > 0),
              transport TEXT NOT NULL CHECK (transport IN ('direct', 'proxy-jump', 'frp')),
              target TEXT NOT NULL CHECK (length(trim(target)) > 0),
              port INTEGER NOT NULL DEFAULT 0 CHECK (port BETWEEN 0 AND 65535),
              user TEXT NOT NULL DEFAULT '',
              proxy_jump TEXT NOT NULL DEFAULT '',
              identity_file TEXT NOT NULL DEFAULT '',
              known_hosts_file TEXT NOT NULL DEFAULT '',
              ssh_config_file TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE (machine_id, name)
            ) STRICT;
            PRAGMA user_version = ${SCHEMA_VERSION};
          `)
        })
      }
      const connection: Connection = {
        database,
        byId: database.prepare(`SELECT ${COLUMNS} FROM profiles WHERE id = ?`),
        listAll: database.prepare(`SELECT ${COLUMNS} FROM profiles ORDER BY rowid`),
        listByMachine: database.prepare(`SELECT ${COLUMNS} FROM profiles WHERE machine_id = ? ORDER BY rowid`),
        byName: database.prepare(`SELECT ${COLUMNS} FROM profiles WHERE machine_id = ? AND name = ?`),
        insert: database.prepare(
          `INSERT INTO profiles (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ),
        update: database.prepare(
          `UPDATE profiles SET name = ?, transport = ?, target = ?, port = ?, user = ?, proxy_jump = ?,
           identity_file = ?, known_hosts_file = ?, ssh_config_file = ?, updated_at = ? WHERE id = ?`,
        ),
        remove: database.prepare('DELETE FROM profiles WHERE id = ?'),
      }
      this.connection = connection
      return connection
    } catch (error) {
      database?.close()
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`无法打开 Connectivity 数据库 ${filename}：${detail}`, { cause: error })
    }
  }

  private require(connection: Connection, profileId: string): ConnectionProfile {
    const row = connection.byId.get(profileId)
    if (!row) throw new Error(`找不到 Connection Profile：${profileId}`)
    return profileFromRow(decodeRow(row))
  }

  add(machineId: string, input: ConnectionProfileInput): ConnectionProfile {
    const machine = requireText(machineId, 'Machine id')
    const profile = normalizeProfile(input)
    const connection = this.open()
    if (connection.byName.get(machine, profile.name)) {
      throw new Error(`Machine ${machine} 已存在同名 Connection Profile：${profile.name}`)
    }
    const id = randomUUID()
    const now = new Date().toISOString()
    transaction(connection.database, () => {
      connection.insert.run(
        id, machine, profile.name, profile.transport, profile.target, profile.port ?? 0,
        profile.user ?? '', profile.proxyJump ?? '', profile.identityFile ?? '',
        profile.knownHostsFile ?? '', profile.sshConfigFile ?? '', now, now,
      )
    })
    return this.require(connection, id)
  }

  list(machineId?: string): readonly ConnectionProfile[] {
    const connection = this.open()
    const rows = machineId === undefined
      ? connection.listAll.all()
      : connection.listByMachine.all(requireText(machineId, 'Machine id'))
    return rows.map((row) => profileFromRow(decodeRow(row)))
  }

  get(profileId: string): ConnectionProfile {
    return this.require(this.open(), requireText(profileId, 'Connection Profile id'))
  }

  update(profileId: string, changes: ConnectionProfileUpdate): ConnectionProfile {
    const current = this.get(profileId)
    const merged: ConnectionProfileInput = {
      name: changes.name ?? current.name,
      transport: changes.transport ?? current.transport,
      target: changes.target ?? current.target,
      ...(changes.port === null
        ? {}
        : { port: changes.port ?? current.port }),
      ...(changes.user === null
        ? {}
        : { user: changes.user ?? current.user }),
      ...(changes.proxyJump === null
        ? {}
        : { proxyJump: changes.proxyJump ?? current.proxyJump }),
      ...(changes.identityFile === null
        ? {}
        : { identityFile: changes.identityFile ?? current.identityFile }),
      ...(changes.knownHostsFile === null
        ? {}
        : { knownHostsFile: changes.knownHostsFile ?? current.knownHostsFile }),
      ...(changes.sshConfigFile === null
        ? {}
        : { sshConfigFile: changes.sshConfigFile ?? current.sshConfigFile }),
    }
    const profile = normalizeProfile(merged)
    const connection = this.open()
    const duplicate = connection.byName.get(current.machineId, profile.name)
    if (duplicate && decodeRow(duplicate).id !== current.id) {
      throw new Error(`Machine ${current.machineId} 已存在同名 Connection Profile：${profile.name}`)
    }
    transaction(connection.database, () => {
      connection.update.run(
        profile.name, profile.transport, profile.target, profile.port ?? 0,
        profile.user ?? '', profile.proxyJump ?? '', profile.identityFile ?? '',
        profile.knownHostsFile ?? '', profile.sshConfigFile ?? '', new Date().toISOString(), current.id,
      )
    })
    return this.require(connection, current.id)
  }

  remove(profileId: string): void {
    const id = requireText(profileId, 'Connection Profile id')
    const connection = this.open()
    this.require(connection, id)
    connection.remove.run(id)
  }

  close(): void {
    this.connection?.database.close()
    this.connection = undefined
  }
}
