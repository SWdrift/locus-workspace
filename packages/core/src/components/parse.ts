import { createRequire } from 'node:module'
import type * as Yaml from 'yaml'
import { i18n } from '../i18n/core.ts'
import { ComponentFailure } from './errors.ts'
import type { ComponentSpec } from './types.ts'
import { validateComponent } from './validation.ts'

let yaml: Pick<typeof Yaml, 'parse'> | undefined

/**
 * 解析可序列化组件定义。字符串走 YAML；默认拒绝 operations/credentials，
 * 防止可编辑 YAML 形成第二份 operation 或凭据真源。YAML 解析器只在解析字符串时加载。
 */
export function parseComponent(input: unknown, options: { readonly allowContract?: boolean } = {}): ComponentSpec {
  const value = typeof input === 'string' ? parseYaml(input) : input
  if (value === null || value === undefined)
    throw new ComponentFailure('invalid-spec', i18n.t('component.empty-definition'))
  return validateComponent(value, {
    executable: false,
    allowContract: options.allowContract === true,
  }).spec
}

function parseYaml(text: string): unknown {
  try {
    if (yaml === undefined) {
      const require = createRequire(import.meta.url)
      yaml = require('yaml') as Pick<typeof Yaml, 'parse'>
    }
    return yaml.parse(text)
  } catch (error) {
    throw new ComponentFailure(
      'invalid-spec',
      i18n.t('component.yaml-parse-failed', {
        detail: error instanceof Error ? error.message : String(error),
      }),
    )
  }
}
