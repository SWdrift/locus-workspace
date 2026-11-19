export type I18nValue = string | number

type PlaceholderNames<S extends string> = S extends `${string}{{${infer Name}}}${infer Rest}`
  ? Name | PlaceholderNames<Rest>
  : never

type Params<S extends string> = { readonly [K in PlaceholderNames<S>]: I18nValue }

type Args<S extends string> = [PlaceholderNames<S>] extends [never] ? [] : [params: Params<S>]

/** 一个包自己的文案表；`t` 只解析本表，不跨 namespace。 */
export interface I18nCatalog<T extends Record<string, string> = Record<string, string>> {
  readonly namespace: string
  readonly resources: T
  t<K extends keyof T & string>(key: K, ...args: Args<T[K]>): string
}

const NAMESPACE = /^[a-z][a-z0-9-]*$/
const KEY = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/
const PLACEHOLDER = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g
const UNCLOSED = /\{\{(?![a-zA-Z][a-zA-Z0-9]*\}\})/

/** 目录与键合法性在模块加载时失败；这是开发期错误，不参与运行期降级。 */
export function defineI18n<const T extends Record<string, string>>(namespace: string, resources: T): I18nCatalog<T> {
  if (!NAMESPACE.test(namespace)) throw new Error(`invalid i18n namespace: ${namespace}`)
  for (const [key, template] of Object.entries(resources)) {
    if (!KEY.test(key)) throw new Error(`invalid i18n key: ${namespace}.${key}`)
    if (template.length === 0 || template.trim() !== template) {
      throw new Error(`invalid i18n template: ${namespace}.${key}`)
    }
    if (UNCLOSED.test(template)) throw new Error(`unclosed i18n placeholder: ${namespace}.${key}`)
  }
  const frozen = Object.freeze(resources)
  return Object.freeze({
    namespace,
    resources: frozen,
    t<K extends keyof T & string>(key: K, ...args: Args<T[K]>): string {
      const params = args[0] as Readonly<Record<string, I18nValue>> | undefined
      return interpolate(frozen[key], params)
    },
  })
}

/** 只替换具名占位符；单个花括号保持字面量，缺参数保留占位符以便定位。 */
export function interpolate(template: string, params?: Readonly<Record<string, I18nValue>>): string {
  if (params === undefined) return template
  return template.replace(PLACEHOLDER, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  )
}
