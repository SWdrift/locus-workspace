import { parse } from 'yaml'
import { ComponentFailure, validateComponent } from './spec.ts'
import type { ComponentSpec } from './spec.ts'

function parseYaml(text: string): unknown {
  try {
    return parse(text)
  } catch (error) {
    throw new ComponentFailure(
      'invalid-spec',
      `YAML 解析失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * 解析可序列化组件定义。字符串走 YAML；默认拒绝 capabilities/credentials，
 * 防止可编辑 YAML 形成第二份能力或凭据真源。
 */
export function parseComponent(
  input: unknown,
  options: { readonly allowCapabilities?: boolean } = {},
): ComponentSpec {
  const value = typeof input === 'string' ? parseYaml(input) : input
  if (value === null || value === undefined) throw new ComponentFailure('invalid-spec', '组件定义不能为空')
  return validateComponent(value, {
    executable: false,
    allowCapabilities: options.allowCapabilities === true,
  }).spec
}
