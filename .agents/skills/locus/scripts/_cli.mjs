import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const localCli = fileURLToPath(new URL('../../../../apps/cli/lib/index.js', import.meta.url))
const installMarker = fileURLToPath(new URL('../.locus-install.json', import.meta.url))

/** 本机注册写入的安装标记；源码目录中没有该文件。 */
function installInfo() {
  try {
    const info = JSON.parse(readFileSync(installMarker, 'utf8'))
    return typeof info === 'object' && info !== null ? info : undefined
  } catch {
    return undefined
  }
}

function cliPath(info) {
  if (process.env.LOCUS_CLI) return process.env.LOCUS_CLI
  if (typeof info?.cli === 'string' && existsSync(info.cli)) return info.cli
  if (existsSync(localCli)) return localCli
  throw new Error('未找到 locus CLI：请设置 LOCUS_CLI，或运行 pnpm locus:register 完成本机注册')
}

function childEnvironment(info) {
  if (process.env.LOCUS_HOME !== undefined) return process.env
  if (typeof info?.dataDirectory !== 'string' || info.dataDirectory.length === 0) return process.env
  return { ...process.env, LOCUS_HOME: info.dataDirectory, LOCUS_FOLDER_NAME: undefined }
}

export function runJson(args) {
  const info = installInfo()
  const result = spawnSync(process.execPath, [cliPath(info), ...args], {
    encoding: 'utf8',
    env: childEnvironment(info),
    timeout: 30000,
    windowsHide: true,
  })
  if (result.error) {
    throw new Error(`无法启动 locus：${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(
      `locus ${args.join(' ')} 失败（退出 ${String(result.status)}）：${(result.stderr || result.stdout).trim()}`,
    )
  }
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(`locus ${args.join(' ')} 未返回 JSON：${result.stdout.trim()}`, { cause: error })
  }
}

export function workspaceList() {
  return runJson(['--json', 'workspace', 'list'])
}

export function resolveWorkspace(reference) {
  return runJson(['--json', 'workspace', 'show', reference])
}
