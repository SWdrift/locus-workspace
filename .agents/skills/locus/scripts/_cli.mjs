import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const localCli = fileURLToPath(new URL('../../../../apps/cli/lib/index.js', import.meta.url))

function cliPath() {
  if (process.env.LOCUS_CLI) return process.env.LOCUS_CLI
  if (existsSync(localCli)) return localCli
  throw new Error('未找到 locus CLI：请设置 LOCUS_CLI，或在 PATH 中安装 locus')
}

export function runJson(args) {
  const result = spawnSync(process.execPath, [cliPath(), ...args], {
    encoding: 'utf8',
    env: process.env,
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
