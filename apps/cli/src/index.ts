#!/usr/bin/env node
import { CommanderError } from 'commander'
import { createLocusCore } from '@locus/core'
import type { LocusCore } from '@locus/core'
import { resolve } from 'node:path'
import { createProgram } from './commands.ts'

/** 读取工作目录的 `.env`；已存在的环境变量优先，缺少文件不算失败。 */
function loadEnvironment(): void {
  try {
    process.loadEnvFile(resolve('.env'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function main(argv: readonly string[]): Promise<number> {
  let locus: LocusCore | undefined
  try {
    loadEnvironment()
    locus = createLocusCore()
    const program = createProgram(locus)
    program.exitOverride()
    await program.parseAsync([...argv], { from: 'user' })
    return typeof process.exitCode === 'number' ? process.exitCode : 0
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode
    }
    process.stderr.write(`Locus 操作失败：${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  } finally {
    await locus?.dispose()
  }
}

process.exitCode = await main(process.argv.slice(2))
