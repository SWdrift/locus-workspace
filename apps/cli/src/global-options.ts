import { Option } from 'commander'
import type { Command } from 'commander'
import type { SecurityGrantScope } from '@locus/core/security'
import { i18n } from './i18n.ts'
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
      new Option('--grant-scope <scope>', i18n.t('option.grant-scope'))
        .choices(['operation', 'session'])
        .default(defaults.grantScope),
    )
    .addOption(
      new Option('--profile <profile>', i18n.t('option.profile'))
        .choices(['production', 'development'])
        .default(defaults.profile),
    )
}
