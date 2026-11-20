import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = join(root, 'dist/locus')
const coreRequire = createRequire(new URL('../packages/core/package.json', import.meta.url))
const keyringEntry = coreRequire.resolve('@napi-rs/keyring')
const keyringRequire = createRequire(keyringEntry)
const keyringPackage = JSON.parse(await readFile(join(dirname(keyringEntry), 'package.json'), 'utf8'))
const nativePackages = []

// 只携带当前安装环境已有的原生包；未安装的其他平台可选依赖不进入产物。
for (const name of Object.keys(keyringPackage.optionalDependencies)) {
  try {
    nativePackages.push([name, dirname(keyringRequire.resolve(`${name}/package.json`))])
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error
  }
}
if (nativePackages.length === 0) throw new Error('打包失败：未找到已安装的 Keyring 原生依赖')

await rm(output, { recursive: true, force: true })
await mkdir(join(output, 'bin'), { recursive: true })
await mkdir(join(output, 'node_modules/yaml'), { recursive: true })

const common = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  target: 'node24',
  logLevel: 'info',
}
const esm = {
  ...common,
  format: 'esm',
  external: ['@napi-rs/keyring', 'yaml'],
  banner: {
    js: "import { createRequire as __locusCreateRequire } from 'node:module'; const require = __locusCreateRequire(import.meta.url);",
  },
}

// 保留同步懒加载，共享块避免主入口与服务出现不同的类、单例身份。
// 块与入口同目录，维持 import.meta.url 相对资源及 createRequire 的解析位置。
await Promise.all([
  build({
    ...esm,
    entryPoints: {
      index: 'apps/cli/lib/index.js',
      service: 'packages/core/lib/components/service.js',
    },
    outdir: join(output, 'bin'),
    splitting: true,
    chunkNames: 'chunk-[hash]',
  }),
  build({
    ...common,
    format: 'cjs',
    entryPoints: [coreRequire.resolve('yaml')],
    outfile: join(output, 'node_modules/yaml/index.cjs'),
  }),
])

await writeFile(join(output, 'package.json'), '{"private":true,"type":"module"}\n')
await writeFile(join(output, 'node_modules/yaml/package.json'), '{"main":"index.cjs"}\n')
await cp(join(root, 'components/templates/templates'), join(output, 'templates'), { recursive: true })
await cp(dirname(keyringEntry), join(output, 'node_modules/@napi-rs/keyring'), { recursive: true })
for (const [name, directory] of nativePackages) {
  await cp(directory, join(output, 'node_modules', name), { recursive: true })
}
console.log(`打包完成：${output}\n运行：node dist/locus/bin/index.js --help`)
