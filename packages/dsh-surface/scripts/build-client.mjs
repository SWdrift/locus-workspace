import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
mkdirSync(join(root, 'lib'), { recursive: true })
copyFileSync(join(root, 'client', 'client.js'), join(root, 'lib', 'client.js'))
copyFileSync(join(root, 'client', 'client.d.ts'), join(root, 'lib', 'client.d.ts'))
