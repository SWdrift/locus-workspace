# 领域生成与应用投影

## 范围

本文说明 Locus 语境中“领域生成与应用投影”的含义、相关术语与当前实现状态；不定义未交付机制的行为、参数或错误。设计与取舍、验证标准和风险由[领域生成与应用投影提案](../.agents/notes/proposed/architecture/2026-11-09-domain-generation.md)维护，组件组成与依赖见[项目架构](architecture.md)。

## 概念

领域生成的目标是 Domain → Applications：新增领域通过定义自身的领域原语、可消费契约和实现，能够在不修改公共机制或其他领域的前提下，被不同应用发现、组合与使用。各应用通过独立投影提供适合自身交互方式的操作与视图，领域语义及其正确性约束不由应用重复定义。

CLI、UI 与 Agent 是同级的应用消费者；Commander、MCP 与 HTTP API 是应用可选择的接口与协议，不是同层应用。应用可以组合领域能力，但不能拥有被组合领域的语义。可复用的应用组合能力应能独立于 CLI 与 UI 存在，但在第二个消费端出现前不预建 Application Framework。

领域契约不只包含 Operation。按真实应用需求，它还可以暴露查询、类型、状态、观察与失效机制；这些能力不因出现一次就成为 Core 原语，Entity、Query、Event 与 View 也不预先规定为所有领域的必备结构。

领域间组合追求语义相容与行为正确性，领域与应用组合追求能力可用、交互一致与呈现恰当。两者都不要求应用共享表现形式，但必须表达同一个领域 Outcome。

应用不必完全由契约生成。契约可以生成通用操作入口、基础表单与基础视图，但 Workspace 工作台仍需要应用级的信息组织、交互设计与跨领域组合。

## 术语

| 术语 | 含义 |
| --- | --- |
| 公共契约 | `packages/contracts` 与 `packages/core` 中跨领域共享的机制、类型和协议；不包含具体领域知识 |
| 领域契约 | 领域自己拥有的类型、Schema、操作定义与行为约定，由领域以纯声明导出；可按需包含查询、状态与失效信息 |
| 操作契约 | 操作的输入输出、前置条件、后置保证、副作用与核验约定；概念形式为 `(I, O, P, Q, E, V)` |
| Operation Definition | 操作身份与接口结构，决定可发现性；安装与发现独立于 Provider 装载 |
| Provider | 当前加载并实现该操作的领域服务，决定可执行性 |
| 应用组合 | 按需组合领域能力，形成面向具体工作的应用用例与视图数据；不等于领域语义 |
| 应用投影 | 同一领域能力在 CLI、UI 或 Agent 中的操作入口、呈现与交互规则 |
| 投影声明 | 某个应用调用操作所需的路径、参数、选项、确认、字段映射与展示配置 |
| Connector | 外部服务 API、认证与调用的集成实现，不等于领域 |

## 当前状态

- 共享类型当前包含 `LocusInfo`、`LocusService`、各领域服务接口、身份命名空间常量与由此产生的数据类型；`packages/contracts` 随每个领域增长，领域契约尚未由领域独立导出。
- 没有 Operation、Contract 或 Catalog 类型；Core 管理 Workspace 身份、长期关系与能力选择，不注册操作。
- 没有 Definition 的独立安装与发现机制。CLI 命令树在 `plugins/cli/src/commands.ts` 中手写，`appReady` 后构造并解析；长驻 shell 每行重建命令树并从当前 Context 读取领域服务。
- 领域服务是可选依赖：Plugin 缺失时命令仍存在，调用时明确失败，已保存关系与配置保留。
- Workspace Capability 选择已由 Core 保存，与 Plugin 是否加载、操作是否授权分开表达。
- `workspace overview` 在 CLI 内手写组合 Workspace、Filesystem、Git、Session、Machine、Connectivity 与 Gitea，是当前跨领域组合的对照基准；没有独立的应用组合模块，也没有 CLI 之外的消费端。

## 边界与限制

- 领域生成是未实施方向。本文与提案不构成稳定 API；不能据此新增空包、占位 Operation、中央 Registry 或通用依赖求解器。
- 应用组合与投影不得重新定义领域语义、成功或失败、未知状态与确认关系；同一领域 Outcome 可以被不同应用以不同形式呈现。
- Definition 未安装时入口通常不存在；Definition 已安装但 Provider 未加载时入口存在并明确失败。两者不能合并为“插件缺失”。
- Operation Catalog 不代替 Capability 选择，也不授予调用权限；未选择能力、未授权、不可达与 Provider 缺失分别表达。
- Operation Contract 不足以唯一生成完整 UI；列表、详情、导航、刷新与布局还需要查询、状态与应用组合语义。不能据此要求所有领域提供 Entity、Query、Event 或 View。
- 契约声明、类型相容与测试数量都不能证明实现正确；业务条件需要运行时检查，外部结果需要真实观察。
- 接口投影只表达领域 Outcome 与接口规则，不重新定义业务成功或失败；投影声明不得成为领域运行逻辑的依赖。CLI 退出码与输出规则由 [CLI 模块](../plugins/cli/README.md#输出与确认)维护。
- 新增领域不修改公共实现代码，不等于无需安装、装配、启用或授权；自动发现安装不属于当前承诺。
- 领域生成不替代 Connector、Capability、Blueprint 或 DSH 宿主机制，也不改变既有数据所有权。

## 参考

- [领域生成与应用投影提案](../.agents/notes/proposed/architecture/2026-11-09-domain-generation.md)：契约所有权、Definition 发现、应用投影、生成层次、路线与验收标准。
- [项目架构](architecture.md)：当前组件、依赖与宿主边界。
- [contracts](../packages/contracts/README.md)：共享类型范围与依赖限制。
- [Workspace Overview 决定](../.agents/notes/implemented/feature/2026-11-09-workspace-overview.md)：已交付的跨领域组合基线。
