#!/usr/bin/env node
/**
 * 系统性测试统一入口。
 *
 * 时间限制（同类测试在上次开始后的窗口内拒绝执行）：
 *
 *   suite  window   内容
 *   all    0        全量进程内测试；只记录，不锁定
 *   e2e    7200 s   CLI 端到端场景；跨进程
 *
 * 每次运行自动写入 temp/test-runs.log。历史 temp/e2e-runs.log 的 start
 * 记录仍计入 e2e 冷却，升级入口后不会立即解锁。
 *
 * 用法：
 *   node tests/run.mjs <all|e2e> [--force] [--reason <文本>]
 *   pnpm test:all
 *   pnpm e2e --force
 *   pnpm verify:full --force
 *
 * 退出码：0 通过；1 测试失败；2 用法或启动前置失败；3 冷却未解除。
 * 冷却是对开始时间的限制；失败、中断与 --force 运行同样占用窗口。
 */

import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LOG = join(REPO, 'temp', 'test-runs.log')
const LEGACY_E2E_LOG = join(REPO, 'temp', 'e2e-runs.log')
const HOUR = 60 * 60 * 1000

const SUITES = {
  all: { windowMs: 0, run: runAll },
  e2e: { windowMs: 2 * HOUR, run: runE2E },
}

// 新记录：<UTC> suite=e2e start ...；历史 e2e-runs.log：<UTC> start ...
const START_RECORD = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+(?:suite=(\S+)\s+)?start\b/

function iso(milliseconds = Date.now()) {
  return new Date(milliseconds).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function usage(message) {
  if (message) console.error(message)
  console.error('用法：node tests/run.mjs <all|e2e> [--force] [--reason <文本>]')
  process.exit(2)
}

function parseArguments(argv) {
  const suite = argv.shift()
  if (suite === undefined || !(suite in SUITES)) usage(suite === undefined ? undefined : `未知测试类型：${suite}`)
  let force = false
  let reason = ''
  while (argv.length > 0) {
    const argument = argv.shift()
    if (argument === '--force') {
      force = true
    } else if (argument === '--reason') {
      if (argv.length === 0) usage('--reason 需要一段文本')
      reason = argv.shift()
    } else {
      usage(`未知参数：${argument}`)
    }
  }
  return { suite, force, reason: reason.replace(/\s+/g, ' ').trim() }
}

function appendRecord(fields) {
  mkdirSync(dirname(LOG), { recursive: true })
  appendFileSync(LOG, `${iso()} ${fields.join(' ')}\n`, 'utf8')
}

function startTimes(file, suite) {
  if (!existsSync(file)) return []
  const times = []
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = START_RECORD.exec(line.trim())
    if (!match) continue
    const recordSuite = match[2] ?? 'e2e'
    if (recordSuite !== suite) continue
    const time = Date.parse(match[1])
    if (Number.isFinite(time)) times.push(time)
  }
  return times
}

function lastStart(suite) {
  const files = suite === 'e2e' ? [LOG, LEGACY_E2E_LOG] : [LOG]
  let latest = null
  for (const file of files) {
    for (const time of startTimes(file, suite)) {
      if (latest === null || time > latest) latest = time
    }
  }
  return latest
}

function remainingLock(suite, now = Date.now()) {
  const { windowMs } = SUITES[suite]
  if (windowMs === 0) return null
  const last = lastStart(suite)
  if (last === null) return null
  const remaining = last + windowMs - now
  return remaining > 0 ? { last, remaining } : null
}

function formatRemaining(milliseconds) {
  const total = Math.ceil(milliseconds / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return `${hours}h${String(minutes).padStart(2, '0')}m${String(seconds).padStart(2, '0')}s`
}

function runNode(argumentsList) {
  const result = spawnSync(process.execPath, argumentsList, {
    cwd: REPO,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) {
    console.error(`启动失败：${result.error.message}`)
    return 1
  }
  return result.status ?? 1
}

function collectPackageTests(group) {
  const files = []
  const base = join(REPO, group)
  if (!existsSync(base)) return files
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = join(base, entry.name, 'test')
    if (!existsSync(directory)) continue
    for (const file of readdirSync(directory)) {
      if (file.endsWith('.test.mjs')) files.push(join(directory, file))
    }
  }
  return files
}

function testFiles() {
  const files = [...collectPackageTests('packages'), ...collectPackageTests('apps')]
  const tests = join(REPO, 'tests')
  for (const file of readdirSync(tests)) {
    if (file.endsWith('.test.mjs')) files.push(join(tests, file))
  }
  if (files.length === 0) {
    console.error('未发现测试文件')
    return []
  }
  return files.sort()
}

function runAll() {
  const files = testFiles()
  if (files.length === 0) return 1
  return runNode(['--test', ...files])
}

function e2eScripts() {
  const directory = join(REPO, 'tests', 'e2e')
  if (!existsSync(directory)) return []
  return readdirSync(directory)
    .filter((file) => file.endsWith('.mjs'))
    .sort()
    .map((file) => join(directory, file))
}

function runE2E() {
  if (!process.env.npm_execpath) {
    console.error('e2e 需要 pnpm 注入 npm_execpath：请使用 `pnpm e2e` 或 `pnpm verify:full`。')
    return 2
  }
  const scripts = e2eScripts()
  if (scripts.length === 0) {
    console.error('未发现 tests/e2e/*.mjs')
    return 1
  }
  for (const script of scripts) {
    const code = runNode([script])
    if (code !== 0) return code
  }
  return 0
}

function runSuite(suite, options) {
  const started = Date.now()
  const start = [`suite=${suite}`, 'start']
  if (options.force) start.push('forced=true')
  if (options.reason) start.push(`reason=${options.reason}`)
  appendRecord(start)

  let code = 1
  try {
    code = SUITES[suite].run()
  } catch (error) {
    console.error(error)
  }

  const result = [
    `suite=${suite}`,
    code === 0 ? 'passed' : 'failed',
    `duration=${((Date.now() - started) / 1000).toFixed(1)}`,
  ]
  if (code !== 0) result.push(`code=${code}`)
  if (options.force) result.push('forced=true')
  appendRecord(result)
  return code
}

function main(argv) {
  const { suite, force, reason } = parseArguments(argv)
  const lock = remainingLock(suite)
  if (lock !== null && !force) {
    console.error(`${suite} 冷却中：上次开始 ${iso(lock.last)}，剩余 ${formatRemaining(lock.remaining)}。`)
    console.error(`使用 \`pnpm ${suite === 'all' ? 'test:all' : suite} --force\` 强制执行。`)
    return 3
  }
  return runSuite(suite, { force, reason })
}

process.exitCode = main(process.argv.slice(2))
