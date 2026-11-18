import { Option } from 'commander'
import type { Command } from 'commander'
import type { SecurityGrantScope } from '@locus/core/security'
import { addOutputOptions } from './output/output.ts'
import type { OutputFlags } from './output/output.ts'

export interface GlobalOptions extends OutputFlags {
  readonly profile: 'production' | 'development'
  readonly grantScope: SecurityGrantScope
}

/** 预解析与正式命令树共用同一组全局选项声明。 */
export function configureGlobalOptions(
  command: Command,
  defaults: Pick<GlobalOptions, 'profile' | 'grantScope'> = { profile: 'production', grantScope: 'operation' },
): Command {
  return addOutputOptions(command)
    .addOption(
      new Option('--grant-scope <scope>', 'Root 提权范围')
        .choices(['operation', 'session'])
        .default(defaults.grantScope),
    )
    .addOption(
      new Option('--profile <profile>', '隔离安全 Profile 与 development 数据目录')
        .choices(['production', 'development'])
        .default(defaults.profile),
    )
}
