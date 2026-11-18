import { Command } from 'commander'
import { createLocusCore } from '@locus/core'
import type { LocusCore } from '@locus/core'
import type { DefinedComponent } from '@locus/core/components'
import type { SecurityHost } from '@locus/core/security'
import { resolve } from 'node:path'
import { reportError } from './output/errors.ts'
import { configureGlobalOptions } from './global-options.ts'
import type { GlobalOptions } from './global-options.ts'
import { createProgram } from './program.ts'

interface PackageComponent {
  readonly id: string
  readonly aliases: readonly string[]
  readonly load: () => Promise<DefinedComponent>
}

/** 包组件的标识、命令别名与加载入口只在组合根登记一次。 */
const packageComponents: readonly PackageComponent[] = [
  {
    id: 'template',
    aliases: [],
    async load() {
      const { component, operations } = await import('@locus/templates')
      return { component, operations }
    },
  },
  {
    id: 'remote-targets',
    aliases: ['rt'],
    async load() {
      const { component, operations } = await import('@locus/remote-targets')
      return { component, operations }
    },
  },
  {
    id: 'postgres',
    aliases: ['pg'],
    async load() {
      const { component, operations } = await import('@locus/postgres')
      return { component, operations }
    },
  },
  {
    id: 'gitea',
    aliases: [],
    async load() {
      const { component, operations } = await import('@locus/gitea')
      return { component, operations }
    },
  },
]

/** 环境、全局参数、包组件与可信 Host 都由这一入口装配。 */
export async function runCli(argv: readonly string[]): Promise<number> {
  let locus: LocusCore | undefined
  let globalOptions: GlobalOptions | undefined
  try {
    loadEnvironment()
    globalOptions = parseGlobalOptions(argv)
    const components = await loadComponentDefinitions(argv)
    let host: SecurityHost | undefined
    locus = createLocusCore({
      components,
      security: {
        profile: globalOptions.profile,
        receiveHost(value) {
          host = value
        },
      },
    })
    const program = createProgram(locus, {
      profile: globalOptions.profile,
      grantScope: globalOptions.grantScope,
      isPackageComponentId,
      ...(host === undefined ? {} : { host }),
    })
    await program.parseAsync([...argv], { from: 'user' })
    return typeof process.exitCode === 'number' ? process.exitCode : 0
  } catch (error) {
    return reportError(error, globalOptions ?? {})
  } finally {
    await locus?.dispose()
  }
}

function isPackageComponentId(id: string): boolean {
  return packageComponents.some(entry => entry.id === id)
}

/** 已存在的环境变量优先，缺少 `.env` 不算失败。 */
function loadEnvironment(): void {
  try {
    process.loadEnvFile(resolve('.env'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function parseGlobalOptions(argv: readonly string[]): GlobalOptions {
  const parser = configureGlobalOptions(
    new Command().helpOption(false).allowUnknownOption().allowExcessArguments().exitOverride(),
  )
  parser.parse([...argv], { from: 'user' })
  return parser.opts<GlobalOptions>()
}

/** 未知顶层入口可能是动态组件；只加载定义，不触发组件物化。 */
async function loadComponentDefinitions(argv: readonly string[]): Promise<readonly DefinedComponent[]> {
  const command = firstPositional(argv)
  if (command === undefined) return []
  const selected = packageComponents.find(entry => entry.id === command || entry.aliases.includes(command))
  if (selected !== undefined) return [await selected.load()]
  switch (command) {
    case 'version':
    case 'workspace':
    case 'shell':
    case 'init':
    case 'credential':
    case 'help':
      return []
    default:
      return Promise.all(packageComponents.map(entry => entry.load()))
  }
}

function firstPositional(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === undefined) continue
    if (argument === '--profile' || argument === '--grant-scope') {
      index += 1
      continue
    }
    if (argument.startsWith('-')) continue
    return argument
  }
  return undefined
}
