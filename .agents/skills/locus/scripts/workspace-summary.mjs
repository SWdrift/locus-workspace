#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs'
import { resolveWorkspace } from './_cli.mjs'

function main() {
  const reference = process.argv[2]
  if (reference === undefined) {
    throw new Error('用法：node workspace-summary.mjs <workspace-id-or-name>')
  }
  const workspace = resolveWorkspace(reference)
  console.log(`Workspace: ${workspace.name}`)
  console.log(`Identity: ${workspace.id}`)
  console.log('挂载:')
  if (workspace.mounts.length === 0) {
    console.log('  无')
  }
  for (const mount of workspace.mounts) {
    const available = existsSync(mount.path) && statSync(mount.path).isDirectory()
    console.log(`  ${mount.name}\t${mount.path}${available ? '' : '\t[缺失]'}`)
  }
  console.log('长期关系:')
  if (workspace.relations.length === 0) {
    console.log('  无')
  }
  for (const relation of workspace.relations) {
    console.log(`  ${relation.kind}\t${relation.target.namespace}:${relation.target.id}\t${relation.source.kind}`)
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
