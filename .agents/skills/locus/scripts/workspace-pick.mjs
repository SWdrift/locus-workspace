#!/usr/bin/env node
import { workspaceList } from './_cli.mjs'

function main() {
  const query = process.argv[2]
  const workspaces = workspaceList()
  if (query === undefined) {
    for (const workspace of workspaces) {
      console.log(`${workspace.id}\t${workspace.name}\t${workspace.mounts.length} 挂载`)
    }
    return
  }
  const byId = workspaces.find((workspace) => workspace.id === query)
  if (byId !== undefined) {
    console.log(byId.id)
    return
  }
  const byName = workspaces.filter((workspace) => workspace.name === query)
  if (byName.length === 1 && byName[0] !== undefined) {
    console.log(byName[0].id)
    return
  }
  if (byName.length > 1) {
    throw new Error(`Workspace 名称不唯一：${query}；请使用 Identity`)
  }
  throw new Error(`找不到 Workspace：${query}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
