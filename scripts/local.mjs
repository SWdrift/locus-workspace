#!/usr/bin/env node
/**
 * 本机注册：把 Locus Skill 与 `locus` 启动器安装到用户目录，并提供取消注册与本机删除。
 *
 * 用法：
 *   node scripts/local.mjs register [--env <文件>] [--agent-dir <目录>] [--bin-dir <目录>] [--force]
 *   node scripts/local.mjs unregister [--agent-dir <目录>] [--bin-dir <目录>] [--force]
 *   node scripts/local.mjs purge --yes [--env <文件>] [--agent-dir <目录>] [--bin-dir <目录>]
 *
 * 默认环境文件为仓库根 `.env.pro`；`register` 把解析出的数据目录写入启动器，
 * `purge` 删除同一数据目录。退出码：0 成功；1 参数、前置条件或文件操作失败。
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import {
  assertSafeDataDirectory,
  CLI,
  DEFAULT_ENV_FILE,
  INSTALL_MARKER,
  readEnvironment,
  resolveDataDirectory,
  SKILL_SOURCE,
} from './local-environment.mjs'

const USAGE = `用法：
  node scripts/local.mjs register [--env <文件>] [--agent-dir <目录>] [--bin-dir <目录>] [--force]
  node scripts/local.mjs unregister [--agent-dir <目录>] [--bin-dir <目录>] [--force]
  node scripts/local.mjs purge --yes [--env <文件>] [--agent-dir <目录>] [--bin-dir <目录>]

register 安装 Skill 与 locus 启动器；unregister 只删除注册；purge 同时删除数据目录。
默认环境文件：${DEFAULT_ENV_FILE}；测试数据使用 --env .env.dev。`

function usageError(message) {
  return new Error(`${message}\n\n${USAGE}`)
}

function canonicalAction(value) {
  if (value === 'register' || value === 'install') return 'register'
  if (value === 'unregister' || value === 'uninstall') return 'unregister'
  if (value === 'purge' || value === 'remove') return 'purge'
  throw usageError(`未知操作：${value ?? '（缺少操作）'}`)
}

function parseArguments(argv) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    console.log(USAGE)
    return undefined
  }
  const options = {
    action: canonicalAction(argv.shift()),
    env: DEFAULT_ENV_FILE,
    agentDir: undefined,
    binDir: undefined,
    force: false,
    yes: false,
  }
  while (argv.length > 0) {
    const argument = argv.shift()
    if (argument === '--env' || argument === '--agent-dir' || argument === '--bin-dir') {
      const value = argv.shift()
      if (value === undefined || value.length === 0) throw usageError(`${argument} 需要非空路径`)
      const key = argument === '--env' ? 'env' : argument === '--agent-dir' ? 'agentDir' : 'binDir'
      options[key] = resolve(value)
    } else if (argument === '--force') {
      options.force = true
    } else if (argument === '--yes') {
      options.yes = true
    } else {
      throw usageError(`未知参数：${argument}`)
    }
  }
  return options
}

function agentDirectory(option) {
  if (option !== undefined) return option
  const configured = process.env.PI_CODING_AGENT_DIR
  return configured === undefined || configured.trim().length === 0
    ? join(homedir(), '.omp', 'agent')
    : resolve(configured)
}

function binDirectory(option) {
  return option ?? join(homedir(), '.local', 'bin')
}

function launcherPath(binDir) {
  return join(binDir, process.platform === 'win32' ? 'locus.cmd' : 'locus')
}

function readMarker(skillTarget) {
  try {
    return JSON.parse(readFileSync(join(skillTarget, INSTALL_MARKER), 'utf8'))
  } catch {
    return undefined
  }
}

function managedLauncher(file) {
  try {
    return readFileSync(file, 'utf8').includes('locus-registered')
  } catch {
    return false
  }
}

function shQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function launcherContent(dataDirectory) {
  if (process.platform === 'win32') {
    const home = dataDirectory.replaceAll('%', '%%')
    return [
      '@echo off',
      'rem locus-registered',
      'if not defined LOCUS_HOME (',
      `  set "LOCUS_HOME=${home}"`,
      '  set "LOCUS_FOLDER_NAME="',
      ')',
      `node "${CLI}" %*`,
      '',
    ].join('\r\n')
  }
  return [
    '#!/bin/sh',
    '# locus-registered',
    'if [ -z "${LOCUS_HOME:-}" ]; then',
    `  LOCUS_HOME=${shQuote(dataDirectory)}`,
    '  export LOCUS_HOME',
    '  unset LOCUS_FOLDER_NAME',
    'fi',
    `exec node ${shQuote(CLI)} "$@"`,
    '',
  ].join('\n')
}

function binOnPath(binDir) {
  const normalize = process.platform === 'win32' ? (value) => value.toLowerCase() : (value) => value
  const target = normalize(resolve(binDir))
  return (process.env.PATH ?? '')
    .split(delimiter)
    .filter((entry) => entry.length > 0)
    .some((entry) => normalize(resolve(entry)) === target)
}

function installSkill(agentDir, envFile, dataDirectory, force) {
  const target = join(agentDir, 'skills', 'locus')
  if (existsSync(target) && readMarker(target) === undefined && !force) {
    throw new Error(`已存在非本脚本注册的 Skill 目录：${target}\n确认可以覆盖后重新执行并加 --force。`)
  }
  rmSync(target, { recursive: true, force: true })
  mkdirSync(dirname(target), { recursive: true })
  cpSync(SKILL_SOURCE, target, { recursive: true })
  writeFileSync(
    join(target, INSTALL_MARKER),
    `${JSON.stringify({ cli: CLI, dataDirectory, envFile, registeredAt: new Date().toISOString() }, null, 2)}\n`,
  )
  return target
}

function installLauncher(binDir, dataDirectory, force) {
  const target = launcherPath(binDir)
  if (existsSync(target) && !managedLauncher(target) && !force) {
    throw new Error(`已存在非本脚本创建的启动器：${target}\n确认可以覆盖后重新执行并加 --force。`)
  }
  mkdirSync(binDir, { recursive: true })
  writeFileSync(target, launcherContent(dataDirectory))
  if (process.platform !== 'win32') chmodSync(target, 0o755)
  return target
}

function register(options) {
  if (!existsSync(CLI)) throw new Error(`未找到 CLI 构建产物：${CLI}\n请先执行 pnpm build。`)
  const dataDirectory = resolveDataDirectory(readEnvironment(options.env))
  const agentDir = agentDirectory(options.agentDir)
  const binDir = binDirectory(options.binDir)
  const skill = installSkill(agentDir, options.env, dataDirectory, options.force)
  const launcher = installLauncher(binDir, dataDirectory, options.force)
  console.log('已注册 Locus：')
  console.log(`- Skill：${skill}`)
  console.log(`- 启动器：${launcher}`)
  console.log(`- 数据目录：${dataDirectory}`)
  console.log(`- 环境文件：${options.env}`)
  console.log('运行 `locus --help` 验证；Skill 脚本通过安装标记找到同一构建产物。')
  console.log('重启 OMP 或开始新会话后由 Agent 加载 Skill。')
  if (!binOnPath(binDir)) {
    console.log(`提示：${binDir} 不在 PATH；把该目录加入 PATH 后才能在任意目录直接运行 locus。`)
  }
}

function unregister(options) {
  const agentDir = agentDirectory(options.agentDir)
  const binDir = binDirectory(options.binDir)
  const skill = join(agentDir, 'skills', 'locus')
  const launcher = launcherPath(binDir)
  const removed = []
  if (existsSync(skill)) {
    if (readMarker(skill) === undefined && !options.force) {
      throw new Error(`已存在非本脚本注册的 Skill 目录：${skill}\n不会自动删除；确认后加 --force。`)
    }
    rmSync(skill, { recursive: true, force: true })
    removed.push(`Skill：${skill}`)
  }
  if (existsSync(launcher)) {
    if (!managedLauncher(launcher) && !options.force) {
      throw new Error(`已存在非本脚本创建的启动器：${launcher}\n不会自动删除；确认后加 --force。`)
    }
    rmSync(launcher, { force: true })
    removed.push(`启动器：${launcher}`)
  }
  if (removed.length === 0) {
    console.log('本机未注册 Locus，无需取消。')
    return
  }
  console.log('已取消本机注册（数据目录保留）：')
  for (const entry of removed) console.log(`- ${entry}`)
}

function purge(options) {
  const dataDirectory = resolveDataDirectory(readEnvironment(options.env))
  const agentDir = agentDirectory(options.agentDir)
  const binDir = binDirectory(options.binDir)
  const skill = join(agentDir, 'skills', 'locus')
  const launcher = launcherPath(binDir)
  const plan = []
  if (existsSync(dataDirectory)) plan.push(`数据目录：${dataDirectory}`)
  if (existsSync(skill) && readMarker(skill) !== undefined) plan.push(`Skill：${skill}`)
  if (existsSync(launcher) && managedLauncher(launcher)) plan.push(`启动器：${launcher}`)
  if (!options.yes) {
    console.error('本机删除会移除：')
    for (const entry of plan) console.error(`- ${entry}`)
    if (plan.length === 0) console.error('- 没有找到可删除的数据目录或注册')
    console.error('确认后重新执行并加 --yes；OS Keyring 中的凭据秘密不在此命令范围内。')
    return 1
  }
  assertSafeDataDirectory(dataDirectory)
  if (existsSync(dataDirectory)) rmSync(dataDirectory, { recursive: true, force: true })
  if (existsSync(skill) && readMarker(skill) !== undefined) rmSync(skill, { recursive: true, force: true })
  if (existsSync(launcher) && managedLauncher(launcher)) rmSync(launcher, { force: true })
  console.log('已删除本机 Locus 数据与注册：')
  for (const entry of plan) console.log(`- ${entry}`)
  if (plan.length === 0) console.log('- 没有找到可删除的数据目录或注册')
  if (existsSync(skill)) console.log(`- 保留非本脚本注册的 Skill：${skill}`)
  if (existsSync(launcher)) console.log(`- 保留非本脚本创建的启动器：${launcher}`)
  console.log('OS Keyring 中的凭据秘密未删除；需要时使用 credential remove/cleanup。')
  return 0
}

function main(argv) {
  const options = parseArguments([...argv])
  if (options === undefined) return 0
  if (options.action === 'register') {
    register(options)
    return 0
  }
  if (options.action === 'unregister') {
    unregister(options)
    return 0
  }
  return purge(options)
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
