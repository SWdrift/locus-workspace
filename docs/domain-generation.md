# 领域生成与应用投影

## 范围

本文说明 Locus 语境中“领域生成与应用投影”的含义、相关术语与当前实现状态；完整机制仍在提案中，Operation Catalog 与 Application Composition/UI 的纵向切片已交付。设计与取舍、验证标准和风险由[领域生成与应用投影提案](../.agents/notes/proposed/architecture/2026-11-09-domain-generation.md)维护，已交付切片的边界见 [Operation Catalog 切片决定](../.agents/notes/implemented/architecture/2026-11-09-operation-catalog-slice.md)与 [Application Composition 与 UI 决定](../.agents/notes/implemented/architecture/2026-11-09-application-composition-ui.md)，组件组成与依赖见[项目架构](architecture.md)。

## 概念

领域生成的目标是 Domain → Applications：新增领域通过定义自身的领域原语、可消费契约和实现，能够在不修改公共机制或其他领域的前提下，被不同应用发现、组合与使用。各应用通过独立投影提供适合自身交互方式的操作与视图，领域语义及其正确性约束不由应用重复定义。

CLI、UI 与 Agent 是同级的应用消费者；Commander、MCP 与 HTTP API 是应用可选择的接口与协议，不是同层应用。应用可以组合领域能力，但不能拥有被组合领域的语义。可复用的应用组合能力应能独立于 CLI 与 UI 存在，但在第二个消费端出现前不预建 Application Framework。

领域契约不只包含 Operation。按真实应用需求，它还可以暴露查询、类型、状态、观察与失效机制；这些能力不因出现一次就成为 Core 原语，Entity、Query、Event 与 View 也不预先规定为所有领域的必备结构。

领域间组合追求语义相容与行为正确性，领域与应用组合追求能力可用、交互一致与呈现恰当。两者都不要求应用共享表现形式，但必须表达同一个领域 Outcome。

应用不必完全由契约生成。契约可以生成通用操作入口、基础表单与基础视图，但 Workspace 工作台仍需要应用级的信息组织、交互设计与跨领域组合。

## 术语

| 术语 | 含义 |
| --- | --- |
| 公共契约 | `packages/contracts` 中跨领域共享的机制、类型与协议；不包含具体领域操作 |
| 领域契约 | 领域自己拥有的类型、Schema、操作定义与行为约定，由领域的 `contract` 导出；可按需包含查询、状态与失效信息 |
| 操作契约 | 操作的输入输出、前置条件、后置保证、副作用与核验约定；概念形式为 `(I, O, P, Q, E, V)` |
| Operation Definition | 操作身份、版本与 JSON Schema；决定可发现性，安装独立于 Provider 装载 |
| Provider | 当前加载并实现该操作的领域服务；在调用时解析，决定可执行性 |
| Operation Catalog | 注册 Definition、解析 Provider、校验输入输出并返回结构化结果的公共机制 |
| 应用组合 | 按需组合领域能力，形成面向具体工作的应用用例与视图数据；不等于领域语义 |
| 应用投影 | 同一领域能力在 CLI、UI 或 Agent 中的操作入口、呈现与交互规则 |
| 投影声明 | 某个应用调用操作所需的路径、参数、选项、确认、字段映射与展示配置 |
| Connector | 外部服务 API、认证与调用的集成实现，不等于领域 |

## 当前状态

- `packages/contracts` 已提供 Operation Definition、Provider、可用性与调用结果的公共类型；具体领域操作不在公共包中。
- `packages/operations` 提供进程内 Catalog：注册与注销 Definition、调用时解析 Provider、JSON Schema 输入输出校验、能力选择检查与结构化结果；不持久化、不授权、不提供 RPC。
- `packages/host-dsh` 创建 Core 并提供 `locus` 与 `locusOperations`，随 fiber 释放。
- Remote Machine 与 Connectivity 分别通过 `@locus/remote-machine/contract`、`@locus/connectivity/contract` 独立安装 `machine.observe` 与 `connect.verify`。Definition 已安装而 Provider 未加载时，Definition 仍可发现，调用返回 `provider-missing`。
- CLI 依据 Definition 与 CLI 投影声明生成 `machine observe` 与 `connect verify`，保留原路径、参数、帮助、领域结果和退出码；其他命令继续使用手写实现。
- 非 CLI 消费方可以直接创建 Catalog 或读取 `locusOperations`，获得 Definition 列表、Schema、可用性与结构化调用结果；测试已验证它与 CLI 消费同一契约。
- Workspace Capability 选择只在调用上下文带 `workspaceId` 时检查；当前两个操作是机器级或 Profile 级，CLI 不附加 Workspace 上下文。
- `packages/application` 提供唯一的 `buildWorkspaceOverview` 应用用例，组合 Workspace、Filesystem、Git、Session、Remote Machine、Connectivity 与 Gitea 的公开服务；CLI 只保留文本/JSON 投影，不再拥有跨领域组合。
- `plugins/ui` 在现有 DSH 进程内提供 loopback HTTP、React Workspace UI 与 JSON API；UI 的 Workspace List、Overview、手动刷新、部分不可用展示与 Operation Catalog 操作入口已交付。浏览器端为纯 React 组件，使用 `--dsw-*` 主题变量、CSS Modules 与共享 primitives，不依赖 Cordis。CLI 与 UI 使用同一 Overview 结果与同一 Catalog。
- UI 传输要求页面内嵌会话令牌、同源来源与自定义请求头；`requiresConfirmation` 的操作必须显式 `confirm: true`。UI 不显示身份文件路径、Token 或私钥，不自行构造 SSH 命令。
- 仍没有自动领域组合、完整 UI 生成、通用 Query/State/Invalidation 原语、订阅、CRUD 页面或 L3 原生领域生成。Definition 发现依赖显式安装的 contract 插件，没有 Manifest 或中央 Registry。

## 边界与限制

- 完整领域生成与应用投影仍是未实施方案。已交付范围是 Operation Catalog、一个共享 Overview 用例、两个 CLI 投影与一个最小 UI；不构成稳定 API，不能据此新增空包、占位 Operation 或通用查询引擎。
- 应用组合与投影不得重新定义领域语义、成功或失败、未知状态与确认关系；同一领域 Outcome 可以被不同应用以不同形式呈现。
- Definition 未安装时入口通常不存在；Definition 已安装但 Provider 未加载时入口存在并明确失败。`availability()` 报告 Provider 自报条件，`invoke()` 仍执行领域操作，让不可达等结果保持为领域 Outcome。
- Operation Catalog 不代替 Capability 选择，也不授予调用权限；未选择能力、未授权、不可达与 Provider 缺失分别表达。
- Operation Contract 不足以唯一生成完整 UI；当前 UI 的 Overview 与领域分组来自共享应用用例和手写展示，Operation Catalog 只驱动受控操作面板。列表、详情、导航、刷新与布局仍需查询、状态与应用组合语义；不能据此要求所有领域提供 Entity、Query、Event 或 View。
- JSON Schema 校验只证明结构；契约声明、类型相容与测试数量不能证明业务条件或外部事实。
- 接口投影只表达领域 Outcome 与接口规则，不重新定义业务成功或失败；投影声明不得成为领域运行逻辑的依赖。
- 新增领域不修改公共实现代码，但仍需安装 contract 与 Provider、修改 DSH profile 并完成授权或能力选择；自动发现安装不属于当前承诺。
- 领域生成不替代 Connector、Capability、Blueprint 或 DSH 宿主机制，也不改变既有数据所有权。
- `workspace overview` 结果中的 `actions` 与 `next` 仍是 CLI 命令提示，为兼容既有 JSON 保留；UI 不把它们当作数据来源或执行入口。

## 参考

- [Operation Catalog 切片决定](../.agents/notes/implemented/architecture/2026-11-09-operation-catalog-slice.md)：已交付机制、取舍、测试与限制。
- [Application Composition 与 UI 决定](../.agents/notes/implemented/architecture/2026-11-09-application-composition-ui.md)：共享 Overview、loopback 传输、UI 边界与验证。
- [领域生成与应用投影提案](../.agents/notes/proposed/architecture/2026-11-09-domain-generation.md)：契约所有权、Definition 发现、应用投影、生成层次、路线与验收标准。
- [Application](../packages/application/README.md)：共享应用用例与边界。
- [UI 模块](../plugins/ui/README.md)：启动方式、API、安全与限制。
- [项目架构](architecture.md)：当前组件、依赖与宿主边界。
- [Operations](../packages/operations/README.md)：Catalog 使用方式与结果语义。
- [CLI 模块](../plugins/cli/README.md)：命令投影、输出与退出码。
- [Workspace Overview 决定](../.agents/notes/implemented/feature/2026-11-09-workspace-overview.md)：已交付的跨领域组合基线。
