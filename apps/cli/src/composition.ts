import { Command } from 'commander'
import { createLocusCore } from '@locus/core'
import type { LocusCore } from '@locus/core'
import type { DefinedComponent } from '@locus/core/components'
import type { SecurityHost } from '@locus/core/security'
import { resolve } from 'node:path'
import { reportError, usageErrorText } from './output/errors.ts'
import { configureGlobalOptions } from './global-options.ts'
import type { GlobalOptions } from './global-options.ts'
import { createProgram } from './program.ts'

type ComponentLoader = () => Promise<DefinedComponent>

/** 这里只登记定义加载器；组件标识与 URL 路由由组件声明唯一维护。 */
const componentLoaders: readonly ComponentLoader[] = [
  async () => {
    const { component, operations } = await import('@locus/templates')
    return { component, operations }
  },
  async () => {
    const { component, operations } = await import('@locus/remote-targets')
    return { component, operations }
  },
  async () => {
    const { component, operations } = await import('@locus/postgres')
    return { component, operations }
  },
  async () => {
    const { component, operations } = await import('@locus/gitea')
    return { component, operations }
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
      debug: process.env.LOCUS_DEBUG === 'true',
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
    new Command()
      .helpOption(false)
      .allowUnknownOption()
      .allowExcessArguments()
      .exitOverride()
      .configureOutput({ outputError: (text, write) => write(usageErrorText(text)) }),
  )
  parser.parse([...argv], { from: 'user' })
  return parser.opts<GlobalOptions>()
}

/** URL 调用与发现装配完整声明；本机专用入口不加载领域包。 */
async function loadComponentDefinitions(argv: readonly string[]): Promise<readonly DefinedComponent[]> {
  const command = firstPositional(argv)
  switch (command) {
    case 'version':
    case 'shell':
    case 'init':
    case 'security':
      return []
    default:
      return Promise.all(componentLoaders.map(load => load()))
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
