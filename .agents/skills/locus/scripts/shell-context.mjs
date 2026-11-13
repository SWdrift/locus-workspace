#!/usr/bin/env node
import { runJson } from './_cli.mjs'

function quotePosix(value) {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function main() {
  const reference = process.argv[2]
  if (reference === undefined) {
    throw new Error('用法：node shell-context.mjs <workspace-id-or-name> [--json]')
  }
  const context = runJson(['shell', reference, '--print-env'])
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(context, null, 2))
    return
  }
  const keys = Object.keys(context.environment)
    .filter((key) => key.startsWith('LOCUS_'))
    .sort()
  for (const key of keys) {
    console.log(`export ${key}=${quotePosix(context.environment[key])}`)
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
