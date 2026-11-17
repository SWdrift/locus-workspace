#!/usr/bin/env node
import { Command, CommanderError, Option } from 'commander'
import { ComponentFailure, createLocusCore, DomainFailure, SecurityFailure } from '@locus/core'
import type { LocusCore, SecurityHost } from '@locus/core'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createProgram } from './commands.ts'
import { CliFailure, exitCodeFor } from './api.ts'
import { loadComponentDefinitions, packageDomain } from './packages.ts'

/** 读取工作目录的 `.env`；已存在的环境变量优先，缺少文件不算失败。 */
function loadEnvironment(): void {
  try {
    process.loadEnvFile(resolve('.env'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/** 先解析受限全局选项再装配 Core；帮助与未知命令不会打开安全存储。 */
function parseGlobalOptions(argv: readonly string[]): {
  profile: 'production' | 'development'
  grantScope: 'operation' | 'session'
} {
  const parser = new Command()
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments()
    .addOption(new Option('--profile <profile>').choices(['production', 'development']).default('production'))
    .addOption(new Option('--grant-scope <scope>').choices(['operation', 'session']).default('operation'))
    .exitOverride()
  parser.parse([...argv], { from: 'user' })
  return parser.opts<{ profile: 'production' | 'development'; grantScope: 'operation' | 'session' }>()
}

/** production 仍由 Core 按原规则解析；development 使用其目录下的独立子目录。 */
function developmentDataDirectory(): string {
  const home = process.env.LOCUS_HOME
  const folder = process.env.LOCUS_FOLDER_NAME
  if (home !== undefined && home.trim().length === 0) throw new Error('LOCUS_HOME 必须是非空路径')
  if (folder !== undefined && (
    folder.trim().length === 0 || folder !== folder.trim() || folder === '.' || folder === '..' || /[\\/:\u0000]/.test(folder)
  )) throw new Error('LOCUS_FOLDER_NAME 必须是非空文件夹名')
  const base = home === undefined ? homedir() : resolve(home)
  const production = folder === undefined
    ? home === undefined ? join(base, '.locus-workspace') : base
    : join(base, folder)
  return join(production, 'profiles', 'development')
}

async function main(argv: readonly string[]): Promise<number> {
  let locus: LocusCore | undefined
  try {
    loadEnvironment()
    const { profile, grantScope } = parseGlobalOptions(argv)
    const { components } = await loadComponentDefinitions(packageDomain(argv))
    let host: SecurityHost | undefined
    locus = createLocusCore({
      ...(profile === 'development' ? { dataDirectory: developmentDataDirectory() } : {}),
      components,
      security: { profile, receiveHost(value) { host = value } },
    })
    const program = createProgram(locus, {
      profile,
      grantScope,
      ...(host === undefined ? {} : { host }),
    })
    program.exitOverride()
    await program.parseAsync([...argv], { from: 'user' })
    return typeof process.exitCode === 'number' ? process.exitCode : 0
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode
    }
    if (error instanceof CliFailure) {
      if (argv.includes('--json')) {
        process.stdout.write(`${JSON.stringify({ code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) })}\n`)
      }
      process.stderr.write(`Locus 调用失败 [${error.code}]：${error.message}\n`)
      return exitCodeFor(error.code)
    }
    if (error instanceof SecurityFailure || error instanceof DomainFailure || error instanceof ComponentFailure) {
      const reason = 'reason' in error && typeof error.reason === 'string' ? error.reason : undefined
      if (argv.includes('--json')) {
        process.stdout.write(`${JSON.stringify({ code: error.code, ...(reason === undefined ? {} : { reason }) })}\n`)
      }
      const label = error instanceof SecurityFailure
        ? '安全操作'
        : error instanceof Error && error.name === 'RemoteTargetsFailure'
          ? '远程目标操作'
          : error instanceof DomainFailure
            ? '组件 operation'
            : '组件操作'
      process.stderr.write(`Locus ${label}失败 [${error.code}]：${error.message}${reason === undefined ? '' : `（${reason}）`}\n`)
      return 2
    }
    process.stderr.write(`Locus 操作失败：${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  } finally {
    await locus?.dispose()
  }
}

process.exitCode = await main(process.argv.slice(2))
