import { createRequire } from 'node:module'
import type { parse, stringify } from 'yaml'

type YamlModule = {
  readonly parse: typeof parse
  readonly stringify: typeof stringify
}

// yaml 只在读写组件定义时使用；用同步 require 保持现有同步契约，
// 同时避免普通 CLI 命令支付其模块解析成本。
const require = createRequire(import.meta.url)
let binding: YamlModule | undefined

function load(): YamlModule {
  binding ??= require('yaml') as YamlModule
  return binding
}

export function parseYamlDocument(text: string): unknown {
  return load().parse(text)
}

export function stringifyYamlDocument(value: unknown): string {
  return load().stringify(value)
}
