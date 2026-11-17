#!/usr/bin/env node
/**
 * 快速备份：把 `--env` 解析出的整个 Locus 数据目录复制到 `temp/locus-backup/<时间戳>`。
 *
 * 用法：
 *   node scripts/backup.mjs [--env <文件>] [--dest <目录>]
 *
 * 默认环境文件为仓库根 `.env.pro`，默认目标为 `temp/locus-backup`。
 * 备份要求没有 Locus 写者；复制期间源目录发生变化时删除不完整副本并失败。
 * 退出码：0 成功；1 参数、前置条件或文件操作失败。
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readlinkSync, rmSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  DEFAULT_ENV_FILE,
  REPO,
  readEnvironment,
  resolveDataDirectory,
} from './local-environment.mjs'

function usageError(message) {
  return new Error(
    `${message}\n\n用法：node scripts/backup.mjs [--env <文件>] [--dest <目录>]\n` +
      `默认环境文件：${DEFAULT_ENV_FILE}；默认目标：${join(REPO, 'temp', 'locus-backup')}`,
  )
}

function parseArguments(argv) {
  const options = { env: DEFAULT_ENV_FILE, dest: join(REPO, 'temp', 'locus-backup') }
  while (argv.length > 0) {
    const argument = argv.shift()
    if (argument === '--help' || argument === '-h') {
      console.log(`用法：node scripts/backup.mjs [--env <文件>] [--dest <目录>]`)
      console.log(`默认环境文件：${DEFAULT_ENV_FILE}`)
      console.log(`默认目标：${join(REPO, 'temp', 'locus-backup')}`)
      return undefined
    }
    if (argument === '--env' || argument === '--dest') {
      const value = argv.shift()
      if (value === undefined || value.length === 0) throw usageError(`${argument} 需要非空路径`)
      options[argument === '--env' ? 'env' : 'dest'] = resolve(value)
      continue
    }
    throw usageError(`未知参数：${argument}`)
  }
  return options
}

/** 冲突时追加序号；不使用毫秒，保持目录名可读。 */
function uniqueTarget(dest) {
  const now = new Date()
  const pad = (value, width = 2) => String(value).padStart(width, '0')
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  let target = join(dest, stamp)
  let suffix = 1
  while (existsSync(target)) target = join(dest, `${stamp}-${++suffix}`)
  return target
}

function insideChild(parent, child) {
  const offset = relative(parent, child)
  return offset.length > 0 && !offset.startsWith('..') && !isAbsolute(offset)
}

/** 记录相对路径、类型与大小/链接目标；用于确认复制期间源目录没有变化。 */
function snapshot(root) {
  const entries = new Map()
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name)
      const name = relative(root, full)
      if (entry.isDirectory()) {
        entries.set(name, { type: 'directory' })
        walk(full)
      } else if (entry.isSymbolicLink()) {
        entries.set(name, { type: 'link', target: readlinkSync(full) })
      } else if (entry.isFile()) {
        const stat = statSync(full)
        entries.set(name, { type: 'file', size: stat.size, seconds: Math.floor(stat.mtimeMs / 1000) })
      } else {
        entries.set(name, { type: 'other' })
      }
    }
  }
  walk(root)
  return entries
}

function compareSnapshots(source, copy) {
  if (source.size !== copy.size) return `条目数量不同：${source.size} → ${copy.size}`
  for (const [name, expected] of source) {
    const actual = copy.get(name)
    if (actual === undefined) return `缺少条目：${name}`
    if (actual.type !== expected.type) return `类型不同：${name}`
    if (expected.type === 'file' && (actual.size !== expected.size || actual.seconds !== expected.seconds)) {
      return `文件在复制期间发生变化：${name}`
    }
    if (expected.type === 'link' && actual.target !== expected.target) return `链接目标不同：${name}`
  }
  return undefined
}

function humanBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function main(argv) {
  const options = parseArguments([...argv])
  if (options === undefined) return 0
  const dataDirectory = resolveDataDirectory(readEnvironment(options.env))
  if (!existsSync(dataDirectory) || !statSync(dataDirectory).isDirectory()) {
    throw new Error(`数据目录不存在：${dataDirectory}\n先运行 locus init，或确认 --env 指向正确的环境文件。`)
  }
  if (resolve(options.dest) === resolve(dataDirectory) || insideChild(dataDirectory, options.dest)) {
    throw new Error(`备份目标不能与数据目录重叠：${options.dest}`)
  }
  const target = uniqueTarget(options.dest)
  mkdirSync(dirname(target), { recursive: true })
  const before = snapshot(dataDirectory)
  try {
    cpSync(dataDirectory, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
    const after = snapshot(dataDirectory)
    const copy = snapshot(target)
    const changed = compareSnapshots(before, after) ?? compareSnapshots(after, copy)
    if (changed !== undefined) throw new Error(`备份期间数据目录发生变化：${changed}\n请停止全部 Locus 写者后重试。`)
  } catch (error) {
    rmSync(target, { recursive: true, force: true })
    throw error
  }
  if (process.platform !== 'win32') chmodSync(target, 0o700)
  const files = [...before.values()].filter((entry) => entry.type === 'file')
  const bytes = files.reduce((total, entry) => total + entry.size, 0)
  console.log(`已备份 ${dataDirectory}`)
  console.log(`- 目标：${target}`)
  console.log(`- 文件：${files.length} 个，${humanBytes(bytes)}`)
  console.log('备份包含 Root 离线验证材料，不包含 OS Keyring 秘密或外部挂载目录。')
  return 0
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
