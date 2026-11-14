#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = manifest.version

if (typeof version !== 'string' || version.trim().length === 0) {
  throw new Error('根 package.json 的 version 必须是非空字符串')
}

const target = path.join(root, 'packages/core/src/version.generated.ts')
const source = `// 由 scripts/version.mjs 从根 package.json 生成，请勿手工编辑。
/** Locus 产品版本，也是仓库唯一版本。 */
export const LOCUS_VERSION = ${JSON.stringify(version)}
`

let current
try {
  current = readFileSync(target, 'utf8')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

if (current !== source) writeFileSync(target, source)
