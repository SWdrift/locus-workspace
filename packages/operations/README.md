# @locus/operations

## 简述与职责

公共 Operation Catalog：注册领域契约、按调用解析当前 Provider、校验输入输出，并返回结构化的调用结果或调用错误。它不拥有领域语义、不授予权限，也不包含 CLI 语法或任何应用投影。

## 使用

```ts
import { createOperationCatalog } from '@locus/operations'

const catalog = createOperationCatalog({
  isCapabilitySelected: (workspaceId, capability) =>
    workspaces.get(workspaceId).capabilities.some((entry) =>
      entry.id === capability.id && entry.provider === capability.provider),
})

const definitions = catalog.list()
const result = await catalog.invoke('machine.observe', { machine: machineId })
```

`register(definition, bind)` 返回取消注册的函数；`bind` 在每次调用时解析当前 Provider，因此插件缺省与热更新不要求重新注册 Definition。Provider 未加载返回 `provider-missing`，Definition 未安装返回 `definition-missing`，两者不能混为一谈。

## 契约与结果

Definition 只包含操作身份、版本、JSON Schema、能力依赖、前置条件、效果与 Outcome 说明。输入不符合 Schema 返回 `invalid-input`；返回值不符合 Schema 返回 `invalid-output`；领域执行抛错返回 `invocation-error`。

领域 Outcome 仍作为 `ok: true` 的 `value` 返回。例如 `machine.observe` 的 `state: 'unreachable'` 是成功调用得到的不利结果，不是调用错误；CLI 投影仍按既有规则把非 `observed` 映射为退出码 2。

`availability()` 暴露当前发现、Provider、版本、能力选择与提供方自报可用性；`invoke()` 只在 Definition、Provider 与能力选择不满足时拒绝，外部不可达等条件由领域操作返回自己的 Outcome。`isCapabilitySelected` 只在调用上下文带 `workspaceId` 时使用。

## 限制

Catalog 只在进程内存在，不提供持久化、中央 Registry、权限模型或跨进程 RPC。Provider 自报可用性不是调用保证；Schema 校验不证明业务条件。Definition 与 Provider 的版本必须一致，调用期间替换不会静默切换语义。
