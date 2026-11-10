# 决策记录：Operation Catalog 纵向切片

Status: implemented

## 问题

CLI 命令树原先全部手写，领域能力与命令结构混在一起；`packages/contracts` 同时承担公共契约与各领域接口，新增领域要修改公共包、CLI 装配和 profile。提案[领域生成、操作契约与应用投影](../../proposed/architecture/2026-11-09-domain-generation.md)需要先证明：Definition 可以独立安装，Provider 可以按调用解析，同一契约可以被 CLI 与非 CLI 消费方共同使用。

本轮只交付一个纵向切片，不建设完整领域生成或应用框架。

## 决定

### 公共类型与领域契约

`@locus/contracts` 新增 `OperationDefinition`、`OperationProvider`、`OperationAvailability`、`OperationInvocationResult` 与 `OperationCatalogService`，只描述身份、版本、JSON Schema、能力依赖、前置条件、效果、Outcome 与调用结果，不含领域操作或运行逻辑。

`machine.observe` 与 `connect.verify` 分别由 `@locus/remote-machine/contract` 与 `@locus/connectivity/contract` 导出。两个领域包新增 `capability.ts` 共享提供方声明，`contract.ts` 只依赖 contracts 类型，不加载领域实现。具体操作没有加入公共 `packages/contracts`。

### Catalog、Definition 与 Provider

新增 `@locus/operations`：进程内 Catalog，使用 Ajv 校验输入输出；`register` 保存 Definition 与惰性 binder，`bind` 在每次调用时解析当前 Provider。Definition 未安装返回 `definition-missing`，Definition 已安装但 Provider 未加载返回 `provider-missing`，两者不合并。

Provider 必须声明与 Definition 一致的 `operationId` 与 `version`；不匹配返回 `contract-mismatch`。调用期间不静默切换版本。`availability()` 暴露 Provider 自报条件，`invoke()` 不据此提前拒绝，避免把 `unreachable`、`unavailable` 等领域 Outcome 改写成调用错误。

能力选择只在调用上下文带 `workspaceId` 时检查；未选择返回 `capability-not-selected`。Catalog 不授予权限，也不替代 Core 的能力选择。

`@locus/host-dsh` 创建 Catalog 并提供 `locusOperations`，Workspace 能力检查复用 Core 的保存快照，Catalog 与 Core 随 fiber 释放。

### Definition 安装与发现

两个 `contract` 作为独立 DSH profile 插件行安装，只注入 `locusOperations`，不注入 Provider 服务。Provider 缺省时 Definition 仍可发现；Provider 插件卸载后 Definition 保留并明确失败。第一轮没有 Manifest、中央 Registry、持久化或跨进程发现。

### CLI 投影

`plugins/cli/src/operation-projection.ts` 根据已安装的 Definition 与 CLI 投影声明构造 Commander 命令。CLI 保留操作路径、位置参数、帮助、文本渲染与退出码映射；Schema、能力依赖与领域 Outcome 来自领域契约。

`machine observe` 与 `connect verify` 改为生成命令，保留原语法、行为、JSON 输出与退出码。Definition 未安装时不创建命令；Provider 未加载时命令存在并失败。长驻 shell 每行重新创建命令树，并在调用时重新解析 Provider。其余命令继续手写。

### 非 CLI 消费入口

`createOperationCatalog()` 与 `locusOperations` 直接提供 `list`、`get`、`availability` 与 `invoke`，返回结构化结果。测试以同一 Catalog 调用 Remote Machine 与 Connectivity 契约，并按 `workspaceId` 验证能力选择；不依赖 Commander。

### 暂未包含

UI/MCP 投影、可复用应用组合提取、查询/状态/失效契约、其他命令迁移、Manifest、中央 Registry、L3 原生领域生成均未实施。

## 备选方案

**把 Catalog 放进 `packages/contracts` 或 `host-dsh`。** contracts 当前无运行逻辑与第三方依赖，放 Ajv 校验会破坏边界；host 应保持薄装配。独立 `@locus/operations` 有真实消费者，便于 CLI、Host 与非 CLI 复用。

**把两个领域操作直接加入公共 contracts。** 类型引用简单，但公共包继续随领域增长，无法验证领域所有权。改为领域 `contract` 导出，公共包只保留机制。

**Provider 加载时立即注册实例。** 会丢失 Definition 与 Provider 的生命周期分离，插件缺省时命令消失。改为调用时 binder 解析。

**Definition 与 Provider 同包同插件。** 无法验证“Definition 已安装、Provider 未加载”。拆为独立 profile 行后三态可观察。

**以 `availability()` 作为 invoke 前置门。** 会把 OpenSSH 缺失或不可达变成调用错误，丢失 `MachineObservation` 与 `ConnectionAttempt` 的领域状态。保留为查询能力，不替领域判定结果。

**保留这两个命令的手写实现。** 无法证明契约可以被 CLI 与非 CLI 共同消费，也无法验证 Definition 发现。迁移两个操作后其余命令保持原实现，避免一次性重写。

**先建 Manifest 或中央 Registry。** 没有第二个应用与多 Host 需求，先以显式 contract 插件验证发现路径。

## 后果

收益：领域操作可以独立于公共 contracts 与 CLI 安装；CLI 与非 CLI 消费同一 Schema、可用性与结构化结果；Provider 缺失、Definition 缺失、能力未选择、版本不匹配与领域不利结果分别表达。

代价与限制：JSON Schema 与 TypeScript 类型存在重复维护，schema 漂移只能由测试与输出校验发现；新增领域仍需两条 profile 行与装配；Provider 自报可用性是建议而非保证；两个操作没有 Workspace 上下文，能力检查仅在非 CLI 显式传入 `workspaceId` 时生效；没有 UI、应用组合模块或自动发现。

若后续出现第二个应用或更多领域，需重新评估 Manifest、Definition 缓存、投影元数据扩张与版本兼容，不能把本轮轻量 Catalog 直接扩张为中央平台。

## 测试

- `pnpm build`：通过。
- `pnpm test`：73 项通过，包含 Catalog 单元测试、CLI 生成命令、Definition 缺失、Provider 缺失、shell 逐行重绑定与 Workspace Overview 回归。
- `pnpm verify:full`：通过；`test:all` 105 项中 104 通过、1 项既有特殊文件用例跳过；`docs:check` 通过 47 个 Markdown 文件；profile smoke 通过 62 个独立 DSH 进程，覆盖 contract 子路径插件加载、CLI 行为、插件停用与跨进程恢复。
- 真实远程 SSH 未在新增测试中调用；Remote Machine 与 Connectivity 测试使用既有 SSH seam/临时 sshd 条件。profile smoke 对 loopback 失败端口的观察仍返回领域 Outcome，未修改远端状态。
- 非 CLI 测试直接读取 Catalog 并调用同一契约，验证能力未选择、输入错误、Provider 卸载与结构化结果。

## 关联

[领域生成、操作契约与应用投影提案](../../proposed/architecture/2026-11-09-domain-generation.md)、[领域生成与应用投影](../../../../docs/domain-generation.md)、[项目架构](../../../../docs/architecture.md)、[CLI 模块](../../../../plugins/cli/README.md)、[Operations](../../../../packages/operations/README.md)、[Remote Machine](../../../../plugins/remote-machine/README.md)、[Connectivity](../../../../plugins/connectivity/README.md)。
