import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SQLOutputValue, StatementSync } from 'node:sqlite'
import type {
  MachineAddress,
  MachineAddressInput,
  MachineAddressKind,
  MachineAddressUpdate,
  RemoteMachine,
  RemoteMachineUpdate,
} from '@locus/contracts'

interface MachineRow {
  id: string
  name: string
  description: string
  created_at: string
  updated_at: string
}

interface AddressRow {
  id: string
  machine_id: string
  kind: MachineAddressKind
  value: string
  port: number
  label: string
  created_at: string
}

interface Connection {
  readonly database: DatabaseSync
  readonly byId: StatementSync
  readonly listMachines: StatementSync
  readonly listAddresses: StatementSync
  readonly addressById: StatementSync
  readonly addressByValue: StatementSync
  readonly insertMachine: StatementSync
  readonly updateMachine: StatementSync
  readonly touchMachine: StatementSync
  readonly insertAddress: StatementSync
  readonly updateAddress: StatementSync
  readonly deleteAddress: StatementSync
}

const MACHINE_COLUMNS = 'id, name, description, created_at, updated_at'
const ADDRESS_COLUMNS = 'id, machine_id, kind, value, port, label, created_at'
const KIND: readonly MachineAddressKind[] = ['ssh', 'hostname', 'ip', 'other']

function requireText(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${field} 必须是字符串`)
  const trimmed = value.trim()
  if (!allowEmpty && trimmed.length === 0) throw new Error(`${field} 必须是非空字符串`)
  if (value.includes('\0')) throw new Error(`${field} 不能包含 NUL 字符`)
  return trimmed
}

function requireAddressValue(value: unknown): string {
  const text = requireText(value, 'Machine 地址')
  if (/[\s\p{Cc}]/u.test(text)) throw new Error('Machine 地址不能包含空白或控制字符')
  if (text.startsWith('-')) throw new Error('Machine 地址不能以 - 开头')
  return text
}

function requireKind(value: unknown): MachineAddressKind {
  if (typeof value !== 'string' || !KIND.includes(value as MachineAddressKind)) {
    throw new Error(`无效 Machine 地址类型：${String(value)}；必须是 ${KIND.join(', ')}`)
  }
  return value as MachineAddressKind
}

function requirePort(value: unknown, kind: MachineAddressKind): number | undefined {
  if (value === undefined) {
    if (kind !== 'ssh') return undefined
    return undefined
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('SSH 端口必须是 1–65535 的整数')
  }
  if (kind !== 'ssh') throw new Error('只有 ssh 地址可以携带端口')
  return value
}

function optionalLabel(value: unknown): string | undefined {
  if (value === undefined) return undefined
  const label = requireText(value, 'Machine 地址标签', true)
  return label.length === 0 ? undefined : label
}

function normalizeAddress(input: MachineAddressInput): Omit<MachineAddress, 'id' | 'createdAt'> {
  const kind = requireKind(input.kind)
  const value = requireAddressValue(input.value)
  const port = requirePort(input.port, kind)
  const label = optionalLabel(input.label)
  return {
    kind,
    value,
    ...(port === undefined ? {} : { port }),
    ...(label === undefined ? {} : { label }),
  }
}

function addressFromRow(row: AddressRow): MachineAddress {
  return {
    id: row.id,
    kind: row.kind,
    value: row.value,
    ...(row.port === 0 ? {} : { port: row.port }),
    ...(row.label === '' ? {} : { label: row.label }),
    createdAt: row.created_at,
  }
}

function decodeMachineRow(row: Record<string, SQLOutputValue>): MachineRow {
  const { id, name, description, created_at, updated_at } = row
  if (
    typeof id !== 'string' || typeof name !== 'string' || typeof description !== 'string' ||
    typeof created_at !== 'string' || typeof updated_at !== 'string'
  ) {
    throw new Error('Remote Machine 记录格式损坏，已保留原数据')
  }
  return { id, name, description, created_at, updated_at }
}

function decodeAddressRow(row: Record<string, SQLOutputValue>): AddressRow {
  const { id, machine_id, kind, value, port, label, created_at } = row
  if (
    typeof id !== 'string' || typeof machine_id !== 'string' || typeof kind !== 'string' ||
    typeof value !== 'string' || typeof port !== 'number' || typeof label !== 'string' ||
    typeof created_at !== 'string' || !KIND.includes(kind as MachineAddressKind)
  ) {
    throw new Error('Remote Machine 地址记录格式损坏，已保留原数据')
  }
  return {
    id,
    machine_id,
    kind: kind as MachineAddressKind,
    value,
    port,
    label,
    created_at,
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
      throw new AggregateError([error, rollbackError], 'Remote Machine 事务失败，且无法回滚')
    }
    throw error
  }
}

/** 只保存 Locus 管理的机器资料和地址；观察、SSH 配置与外部生命周期不进入此库。 */
export class RemoteMachineStore {
  private connection: Connection | undefined

  constructor(private readonly dataDirectory: string) {}

  private open(): Connection {
    if (this.connection) return this.connection
    mkdirSync(this.dataDirectory, { recursive: true })
    const filename = join(this.dataDirectory, 'remote-machine.sqlite')
    let database: DatabaseSync | undefined
    try {
      database = new DatabaseSync(filename, { timeout: 1000, enableForeignKeyConstraints: true })
      const integrity = database.prepare('PRAGMA integrity_check').all()
      if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
        throw new Error('Remote Machine 数据库完整性检查失败，已保留原数据')
      }
      const version = database.prepare('PRAGMA user_version').get()?.user_version
      const objects = database.prepare('SELECT name FROM sqlite_schema').all()
      if (version !== 1) {
        if (version !== 0 || objects.length !== 0) {
          throw new Error(
            version === 0
              ? 'Remote Machine 数据库已有结构但无版本，拒绝覆盖；请备份后手工处理'
              : `Remote Machine 数据格式版本 ${String(version)} 不受支持，需要版本 1；已保留原数据`,
          )
        }
      }
      if (database.prepare('PRAGMA journal_mode = DELETE').get()?.journal_mode !== 'delete') {
        throw new Error('Remote Machine 数据库无法采用 journal_mode=DELETE')
      }
      database.exec('PRAGMA synchronous = FULL')
      if (version === 0) {
        transaction(database, () => {
          const current = database!.prepare('PRAGMA user_version').get()?.user_version
          if (current === 1) return
          if (current !== 0 || database!.prepare('SELECT name FROM sqlite_schema').all().length !== 0) {
            throw new Error('拒绝初始化已有结构或未知版本的 Remote Machine 数据库')
          }
          database!.exec(`
            CREATE TABLE machines (
              id TEXT PRIMARY KEY NOT NULL,
              name TEXT NOT NULL CHECK (length(trim(name)) > 0),
              description TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            ) STRICT;
            CREATE TABLE addresses (
              id TEXT PRIMARY KEY NOT NULL,
              machine_id TEXT NOT NULL REFERENCES machines(id),
              kind TEXT NOT NULL CHECK (kind IN ('ssh', 'hostname', 'ip', 'other')),
              value TEXT NOT NULL CHECK (length(trim(value)) > 0),
              port INTEGER NOT NULL DEFAULT 0 CHECK (port BETWEEN 0 AND 65535),
              label TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              UNIQUE (machine_id, kind, value, port)
            ) STRICT;
            PRAGMA user_version = 1;
          `)
        })
      }
      const connection: Connection = {
        database,
        byId: database.prepare(`SELECT ${MACHINE_COLUMNS} FROM machines WHERE id = ?`),
        listMachines: database.prepare(`SELECT ${MACHINE_COLUMNS} FROM machines ORDER BY rowid`),
        listAddresses: database.prepare(`SELECT ${ADDRESS_COLUMNS} FROM addresses WHERE machine_id = ? ORDER BY rowid`),
        addressById: database.prepare(`SELECT ${ADDRESS_COLUMNS} FROM addresses WHERE machine_id = ? AND id = ?`),
        addressByValue: database.prepare(`SELECT ${ADDRESS_COLUMNS} FROM addresses WHERE machine_id = ? AND kind = ? AND value = ? AND port = ?`),
        insertMachine: database.prepare(
          'INSERT INTO machines (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ),
        updateMachine: database.prepare('UPDATE machines SET name = ?, description = ?, updated_at = ? WHERE id = ?'),
        touchMachine: database.prepare('UPDATE machines SET updated_at = ? WHERE id = ?'),
        insertAddress: database.prepare(
          `INSERT INTO addresses (${ADDRESS_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ),
        updateAddress: database.prepare(
          'UPDATE addresses SET kind = ?, value = ?, port = ?, label = ? WHERE machine_id = ? AND id = ?',
        ),
        deleteAddress: database.prepare('DELETE FROM addresses WHERE machine_id = ? AND id = ?'),
      }
      this.connection = connection
      return connection
    } catch (error) {
      database?.close()
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`无法打开 Remote Machine 数据库 ${filename}：${detail}`, { cause: error })
    }
  }

  private machine(connection: Connection, row: MachineRow): RemoteMachine {
    const addresses = connection.listAddresses
      .all(row.id)
      .map((address) => addressFromRow(decodeAddressRow(address)))
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      addresses,
    }
  }

  private require(connection: Connection, machineId: string): RemoteMachine {
    const row = connection.byId.get(machineId)
    if (!row) throw new Error(`找不到 Remote Machine：${machineId}`)
    return this.machine(connection, decodeMachineRow(row))
  }

  register(name: string, description = ''): RemoteMachine {
    const machineName = requireText(name, 'Machine 名称')
    const machineDescription = requireText(description, 'Machine 描述', true)
    const connection = this.open()
    const now = new Date().toISOString()
    const id = randomUUID()
    transaction(connection.database, () => {
      connection.insertMachine.run(id, machineName, machineDescription, now, now)
    })
    return this.require(connection, id)
  }

  list(): readonly RemoteMachine[] {
    const connection = this.open()
    return connection.listMachines
      .all()
      .map((row) => this.machine(connection, decodeMachineRow(row)))
  }

  get(machineId: string): RemoteMachine {
    const id = requireText(machineId, 'Machine id')
    return this.require(this.open(), id)
  }

  update(machineId: string, changes: RemoteMachineUpdate): RemoteMachine {
    const current = this.get(machineId)
    const name = changes.name === undefined
      ? current.name
      : requireText(changes.name, 'Machine 名称')
    const description = changes.description === undefined
      ? current.description
      : requireText(changes.description, 'Machine 描述', true)
    if (name === current.name && description === current.description) return current
    const connection = this.open()
    transaction(connection.database, () => {
      connection.updateMachine.run(name, description, new Date().toISOString(), current.id)
    })
    return this.require(connection, current.id)
  }

  addAddress(machineId: string, address: MachineAddressInput): RemoteMachine {
    const current = this.get(machineId)
    const normalized = normalizeAddress(address)
    const connection = this.open()
    const port = normalized.port ?? 0
    const existing = connection.addressByValue.get(current.id, normalized.kind, normalized.value, port)
    if (existing) return current
    const now = new Date().toISOString()
    transaction(connection.database, () => {
      connection.insertAddress.run(
        randomUUID(), current.id, normalized.kind, normalized.value, port, normalized.label ?? '', now,
      )
      connection.touchMachine.run(now, current.id)
    })
    return this.require(connection, current.id)
  }

  updateAddress(machineId: string, addressId: string, changes: MachineAddressUpdate): RemoteMachine {
    const current = this.get(machineId)
    const existing = current.addresses.find((address) => address.id === addressId)
    if (!existing) throw new Error(`Remote Machine ${current.id} 中不存在地址：${addressId}`)
    const kind = requireKind(changes.kind ?? existing.kind)
    const value = requireAddressValue(changes.value ?? existing.value)
    if (changes.port !== undefined && kind !== 'ssh') {
      throw new Error('只有 ssh 地址可以携带端口')
    }
    const port = kind === 'ssh' ? requirePort(changes.port ?? existing.port, kind) : undefined
    const label = changes.label === undefined
      ? existing.label
      : optionalLabel(changes.label)
    const connection = this.open()
    const duplicate = connection.addressByValue.get(current.id, kind, value, port ?? 0)
    if (duplicate && decodeAddressRow(duplicate).id !== addressId) {
      throw new Error(`该地址已存在于 Remote Machine ${current.id}`)
    }
    const now = new Date().toISOString()
    transaction(connection.database, () => {
      connection.updateAddress.run(kind, value, port ?? 0, label ?? '', current.id, addressId)
      connection.touchMachine.run(now, current.id)
    })
    return this.require(connection, current.id)
  }

  removeAddress(machineId: string, addressId: string): RemoteMachine {
    const current = this.get(machineId)
    if (!current.addresses.some((address) => address.id === addressId)) {
      throw new Error(`Remote Machine ${current.id} 中不存在地址：${addressId}`)
    }
    const connection = this.open()
    const now = new Date().toISOString()
    transaction(connection.database, () => {
      connection.deleteAddress.run(current.id, addressId)
      connection.touchMachine.run(now, current.id)
    })
    return this.require(connection, current.id)
  }

  close(): void {
    this.connection?.database.close()
    this.connection = undefined
  }
}
