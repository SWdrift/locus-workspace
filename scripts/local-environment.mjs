/**
 * 本机注册与备份脚本共用的环境文件解析。
 *
 * 环境文件只读取 `KEY=VALUE` 行；`~` 由本脚本展开，因此 `.env.pro` 可以直接写
 * `LOCUS_HOME=~/.locus`。数据目录解析与 Core 保持一致，见
 * `packages/core/src/index.ts` 的 `resolveDataDirectory`。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓库根目录。 */
export const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
/** 本机脚本默认读取的生产环境文件。 */
export const DEFAULT_ENV_FILE = join(REPO, '.env.pro')
/** 构建后的 CLI 入口。 */
export const CLI = join(REPO, 'apps', 'cli', 'lib', 'index.js')
/** 仓库内的 Locus Skill 源目录。 */
export const SKILL_SOURCE = join(REPO, '.agents', 'skills', 'locus')
/** 注册时写入 Skill 的安装标记；`_cli.mjs` 用它找到构建后的 CLI。 */
export const INSTALL_MARKER = '.locus-install.json'

/** 展开路径开头的 `~`；其余部分保持原样。 */
function expandHome(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

/** 文件夹名规则与 Core 的 `assertFolderName` 一致。 */
function assertFolderName(folder) {
  if (folder.trim().length === 0 || folder !== folder.trim() || folder === '.' || folder === '..' || /[\\/:\u0000]/.test(folder)) {
    throw new Error('LOCUS_FOLDER_NAME 必须是非空文件夹名')
  }
}

/** 解析环境文件为 Map；不支持变量插入、多行值与行尾注释。 */
export function parseEnvironmentFile(file) {
  const environment = new Map()
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (match === null) continue
    let value = match[2]
    const first = value[0]
    if ((first === '"' || first === "'") && value.length >= 2 && value.endsWith(first)) {
      value = value.slice(1, -1)
    }
    environment.set(match[1], value)
  }
  return environment
}

/** 读取环境文件；缺失时提示创建并给出最小内容。 */
export function readEnvironment(file) {
  if (!existsSync(file)) {
    throw new Error(
      `未找到环境文件：${file}\n` +
        '请创建该文件（结构参考仓库根 .env.example），至少包含：\n' +
        '  LOCUS_HOME=~/.locus\n' +
        '  _LOCUS_ROOT_PASSWORD=<Root 密码>\n' +
        '或使用 --env 指定其他环境文件；测试数据使用 .env.dev。',
    )
  }
  return parseEnvironmentFile(file)
}

/**
 * 按 Core 的规则解析数据目录：显式 `LOCUS_HOME` 完整决定目录，否则以用户主目录
 * 为基目录并叠加 `LOCUS_FOLDER_NAME`。相对 `LOCUS_HOME` 按当前工作目录解析。
 */
export function resolveDataDirectory(environment) {
  const home = environment.get('LOCUS_HOME')
  const folder = environment.get('LOCUS_FOLDER_NAME')
  if (home !== undefined && home.trim().length === 0) throw new Error('LOCUS_HOME 必须是非空路径')
  if (folder !== undefined) assertFolderName(folder)
  const base = home === undefined ? homedir() : resolve(expandHome(home))
  if (folder !== undefined) return join(base, folder)
  return home === undefined ? join(base, '.locus-workspace') : base
}

/** 拒绝删除文件系统根、用户主目录以及包含仓库的目录。 */
export function assertSafeDataDirectory(directory) {
  const target = resolve(directory)
  if (target === resolve(target, '..')) throw new Error(`拒绝删除文件系统根目录：${target}`)
  if (target === resolve(homedir())) throw new Error(`拒绝删除用户主目录：${target}`)
  const normalize = process.platform === 'win32' ? (value) => value.toLowerCase() : (value) => value
  if (normalize(REPO) === normalize(target) || normalize(REPO).startsWith(`${normalize(target)}\\`) || normalize(REPO).startsWith(`${normalize(target)}/`)) {
    throw new Error(`拒绝删除包含仓库的目录：${target}`)
  }
}
