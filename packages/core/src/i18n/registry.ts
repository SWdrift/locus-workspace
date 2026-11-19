import type { I18nCatalog } from './define.ts'

export interface I18nEntry {
  readonly namespace: string
  readonly key: string
  readonly template: string
}

/** 注册器只索引与校验；不提供翻译入口，不持有任何内置文案。 */
export interface I18nRegistry {
  readonly entries: readonly I18nEntry[]
  has(namespace: string, key: string): boolean
}

/** 组合根或测试显式传入全部 catalog；namespace 冲突在装配时失败。 */
export function createI18nRegistry(catalogs: readonly I18nCatalog<any>[]): I18nRegistry {
  const byNamespace = new Map<string, I18nCatalog<any>>()
  const entries: I18nEntry[] = []
  for (const catalog of catalogs) {
    if (byNamespace.has(catalog.namespace)) {
      throw new Error(`i18n namespace duplicated: ${catalog.namespace}`)
    }
    byNamespace.set(catalog.namespace, catalog)
    for (const [key, template] of Object.entries<string>(catalog.resources)) {
      entries.push(Object.freeze({ namespace: catalog.namespace, key, template }))
    }
  }
  const frozen = Object.freeze(entries)
  return Object.freeze({
    entries: frozen,
    has(namespace: string, key: string): boolean {
      const catalog = byNamespace.get(namespace)
      return catalog !== undefined && Object.hasOwn(catalog.resources, key)
    },
  })
}
