import type { ComponentDefinition, DefinedComponent } from './types.ts'
import { validateComponent } from './validation.ts'

/**
 * 定义组件的唯一可信入口：同时产出可序列化 component 与 operation handler 表。
 * 不写文件、不注册全局状态。
 */
export function defineComponent(input: ComponentDefinition): DefinedComponent {
  const result = validateComponent(input, { executable: true, allowContract: true })
  // 元数据已深冻结；schema 属于外部执行对象，可能在首次 parse 时建立内部缓存。
  return Object.freeze({
    component: result.spec,
    operations: result.operations ?? Object.freeze([]),
  })
}
