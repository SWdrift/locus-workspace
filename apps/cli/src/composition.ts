import { Command } from 'commander'
import { createLocusCore } from '@locus/core'
import type { LocusCore } from '@locus/core'
import type { DefinedComponent } from '@locus/core/components'
import { createI18nRegistry } from '@locus/core/i18n'
import type { I18nCatalog } from '@locus/core/i18n'
import type { SecurityHost } from '@locus/core/security'
import { resolve } from 'node:path'
import { i18n } from './i18n.ts'
import { reportError, usageErrorText } from './output/errors.ts'
import { configureGlobalOptions } from './global-options.ts'
import type { GlobalOptions } from './global-options.ts'
import { createProgram } from './program.ts'

type ComponentModule = DefinedComponent & { readonly i18n: I18nCatalog<any> }
type ComponentLoader = () => Promise<ComponentModule>

/** 这里只登记定义加载器；组件标识与 URL 路由由组件声明唯一维护。 */
const componentLoaders: readonly ComponentLoader[] = [
  async () => import('@locus/templates'),
  async () => import('@locus/remote-targets'),
]

/** 环境、全局参数、包组件与可信 Host 都由这一入口装配。 */
export async function runCli(argv: readonly string[]): Promise<number> {
  let locus: LocusCore | undefined
  let globalOptions: GlobalOptions | undefined
  try {
    loadEnvironment()
    globalOptions = parseGlobalOptions(argv)
    const modules = await loadComponentDefinitions(argv)
    // 装配期校验 namespace 与 key 归属；新增组件只扩展 loader，不改 Core。
    createI18nRegistry([...modules.map(module => module.i18n), i18n])
    const components = modules.map(({ component, operations }) => ({ component, operations }))
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
async function loadComponentDefinitions(argv: readonly string[]): Promise<readonly ComponentModule[]> {
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
