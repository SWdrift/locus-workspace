import type { ComponentSpec } from '@locus/core'

export type PackageDomain = 'none' | 'templates' | 'remote-targets' | 'postgres' | 'gitea' | 'all'

function firstPositional(argv: readonly string[]): { readonly command: string; readonly index: number } | undefined {
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === undefined) continue
    if (argument === '--json' || argument === '-h' || argument === '--help') continue
    if (argument === '--profile' || argument === '--grant-scope') {
      index += 1
      continue
    }
    if (argument.startsWith('--profile=') || argument.startsWith('--grant-scope=')) continue
    if (argument.startsWith('-')) continue
    return { command: argument, index }
  }
  return undefined
}

/** 顶层命令决定需要预加载的组件包；未知顶层命令可能是包组件，按全集处理。 */
export function packageDomain(argv: readonly string[]): PackageDomain {
  const first = firstPositional(argv)
  if (first === undefined) return 'none'
  switch (first.command) {
    case 'pg':
      return 'postgres'
    case 'remote-targets':
    case 'rt':
      return 'remote-targets'
    case 'template':
      return 'templates'
    case 'component':
      return 'all'
    case 'security': {
      const rest = firstPositional(argv.slice(first.index + 1))
      return rest?.command === 'capability' ? 'all' : 'none'
    }
    case 'version':
    case 'workspace':
    case 'shell':
    case 'init':
    case 'credential':
    case 'help':
      return 'none'
    default:
      return 'all'
  }
}

/**
 * 按命令域动态加载组件包，返回交给 Core 装配的组件定义。
 * 同一个包的后续 `import()` 命中 ESM 缓存，命令处理函数不再重复解析。
 */
export async function loadComponentDefinitions(
  domain: PackageDomain,
): Promise<{ readonly components: readonly ComponentSpec[] }> {
  const components: ComponentSpec[] = []
  if (domain === 'templates' || domain === 'all') {
    const templates = await import('@locus/templates')
    components.push(templates.component)
  }
  if (domain === 'remote-targets' || domain === 'all') {
    const remoteTargets = await import('@locus/remote-targets')
    components.push(remoteTargets.component)
  }
  if (domain === 'postgres' || domain === 'all') {
    const postgres = await import('@locus/postgres')
    components.push(postgres.component)
  }
  if (domain === 'gitea' || domain === 'all') {
    const gitea = await import('@locus/gitea')
    components.push(gitea.component)
  }
  return { components }
}
