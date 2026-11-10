# 项目架构

改动 `packages/` 下内容前先读本文。本文维护当前组件、依赖与扩展边界；决定理由在 Agent Notes，用法在模块 README，验证入口在[测试系统](testing.md#分层与入口)。

## 当前交付与方向

Workspace Foundation 已交付：独立于目录/Project/Session 的长期 Workspace，持久身份与显式成员/关联；Filesystem 的多位置登记、按需发现与读取；Git 通过 Filesystem 线索进行最小只读观察；Session 只读发现、显式关联与原生返回入口；Remote Machine 的稳定机器身份、多地址、Workspace 共享关联与单地址 SSH 只读观察；Connectivity 的 SSH Connection Profile、配置检查、真实连接验证与原生入口；Gitea 的实例、来源限定仓库引用、Actions Run 与 Workspace 关联观察；Workspace Overview 由 `@locus/application` 组合这些公开用例，区分确认关系、本次观察、未确认建议与未知项。CLI 在项目内 DSH profile 提供完整用户入口，重启、能力缺失和资源消失不删除长期关系。

Operation Catalog 第一轮纵向切片已交付：`machine.observe` 与 `connect.verify` 的 Definition 由领域 `contract` 独立安装，Provider 按调用解析；CLI 依据定义与投影元数据生成这两个命令，非 CLI 消费方通过同一 Catalog 获得 Schema、可用性与结构化结果。其余命令继续使用现有手写实现；证据与限制见 [Operation Catalog 切片决定](../.agents/notes/implemented/architecture/2026-11-09-operation-catalog-slice.md)。

Application Composition 与 Workspace UI 已交付：`packages/application` 提供唯一的 `buildWorkspaceOverview` 用例；CLI 只保留文本/JSON 投影，本地 UI 经 `plugins/ui` 的 loopback HTTP 适配层调用同一用例与 Operation Catalog。UI 已交付 Workspace 列表、Overview、手动刷新、状态分层与受控操作入口；自动领域组合、完整 UI 生成与 Agent 原生领域生成仍未实现。证据与限制见 [Application Composition 与 UI 决定](../.agents/notes/implemented/architecture/2026-11-09-application-composition-ui.md)。

[Workspace 产品决定](../.agents/notes/implemented/feature/2026-11-08-workspace-capability-slice.md)、[Session 集成决定](../.agents/notes/implemented/feature/2026-11-09-session-integration.md)、[Remote Machine 决定](../.agents/notes/implemented/feature/2026-11-09-remote-machine.md)、[Connectivity 决定](../.agents/notes/implemented/feature/2026-11-09-connectivity.md)、[Gitea 决定](../.agents/notes/implemented/feature/2026-11-09-gitea.md)维护已交付概念与范围，[组件与恢复决定](../.agents/notes/implemented/architecture/2026-11-08-workspace-capability-composition.md)维护所有权与取舍。完整 DevOps、自动部署、Blueprint 执行、多提供方和跨设备能力仍在[提案](../.agents/notes/proposed/feature/2026-11-08-workspace-capability-evolution.md)，不等于已有实现。领域生成与应用投影仍处于提案，Operation Catalog、Application Composition 与 Workspace UI 的第一轮切片已交付，其余方向与当前状态见[领域生成与应用投影](domain-generation.md)。

## 组件与依赖

| 路径 | 当前职责 |
| --- | --- |
| `packages/contracts/` | 当前真实生产者/消费者共享的最小类型与 Operation 描述接口；无 DSH/Cordis 或运行逻辑 |
| `packages/operations/` | Operation Definition 注册、Provider 解析、JSON Schema 校验与结构化调用；不解释领域语义、不授予权限 |
| `packages/application/` | 跨领域应用用例；当前提供唯一的 `buildWorkspaceOverview`，组合公开领域服务，不依赖 CLI/UI，不保存派生事实 |
| `packages/core/` | Workspace 身份、长期成员/关联、必要来源与能力选择快照；自有持久数据，不解释领域引用 |
| `packages/host-dsh/` | 创建/持有 Core，提供 `locus` 与 `locusOperations` 并随 fiber 释放 |
| `plugins/filesystem/` | 位置登记与本机引用、范围、原生状态、单层发现和有界读取；自有配置 |
| `plugins/git/` | 消费 Filesystem 局部协议，原生 Git 只读查询；不维护第二套成员或位置模型 |
| `plugins/session/` | 消费 DSH `sessionQuery`，只读发现与检查 Session；不复制消息历史或执行状态 |
| `plugins/remote-machine/` | 机器管理身份、多地址、Workspace 共享引用与单地址 OpenSSH 只读观察；`contract` 独立导出 `machine.observe`；不拥有连接或远端生命周期 |
| `plugins/connectivity/` | 机器级 Connection Profile、OpenSSH 配置检查、真实连接验证与原生命令入口；`contract` 独立导出 `connect.verify`；不拥有 SSH/FRP 运行时 |
| `plugins/gitea/` | Gitea 实例配置、来源限定仓库引用、Actions Run 只读观察与凭据引用；不拥有 Gitea 事实或 CI 生命周期 |
| `plugins/cli/` | 参数/帮助、用例编排、显式确认、人类/JSON 渲染与退出；`workspace overview` 调用共享应用用例，`machine observe` 与 `connect verify` 由 Operation Definition 生成；不实现领域 I/O 或跨领域组合 |
| `plugins/ui/` | 现有 DSH 宿主内的本地应用传输适配层：loopback HTTP、React Workspace UI、Workspace/Overview/Operation JSON API；不拥有领域语义或第二套持久化 |
| `tests/`、`scripts/` | 隔离真实资源测试及实际 profile 验收，不成为业务运行依赖 |

下图表示运行时调用/装配，类型依赖统一经 contracts；不表示所有能力都要由 Core 转发。

```mermaid
flowchart TD
    DSH["DSH / Cordis：装配、注入、生命周期"] --> Host["host-dsh"]
    DSH --> CLI["CLI"]
    DSH --> MachineContract["Remote Machine contract"]
    DSH --> ConnectivityContract["Connectivity contract"]
    DSH --> FS["Filesystem Plugin"]
    DSH --> Git["Git Plugin"]
    DSH --> Machine["Remote Machine Plugin"]
    DSH --> Connectivity["Connectivity Plugin"]
    DSH --> Gitea["Gitea Plugin"]
    Host --> Core["Core / locus"]
    Host --> Operations["Operation Catalog"]
    MachineContract --> Operations
    ConnectivityContract --> Operations
    CLI --> Core
    CLI --> FS
    CLI --> Git
    CLI --> Machine
    CLI --> Connectivity
    CLI --> Gitea
    CLI --> Operations
    CLI --> Application["Application Composition"]
    UI["UI Server"] --> Application
    UI --> Operations
    UI --> Core
    UI --> FS
    UI --> Git
    UI --> Machine
    UI --> Connectivity
    UI --> Gitea
    UI --> Session
    Browser["本地浏览器"] -->|"loopback HTTP + 会话令牌"| UI
    Application --> Core
    Application --> FS
    Application --> Git
    Application --> Machine
    Application --> Connectivity
    Application --> Gitea
    Application --> Session
    CLI --> GiteaCore["Gitea Workspace 关联"]
    CLI --> Session["Session Plugin"]
    Machine -->|"显式关联"| Core
    Machine -->|"只读 hostname"| SSH["原生 OpenSSH"]
    Connectivity -->|"SSH 参数/只读 hostname"| SSH
    Connectivity -->|"FRP visitor 端口检查"| Visitor["现有 FRP/FRPP visitor"]
    Gitea -->|"只读 HTTP API"| GiteaAPI["Gitea Instance"]
    Gitea -->|"显式关联"| GiteaCore
    GiteaCore --> Core
    Session -->|"公开 Session Query"| DSH
    Session -->|"显式关联"| Core
    FS -->|"公开 Workspace 用例"| Core
    Git -->|"能力选择"| Core
    Git -->|"位置与当前观察"| FS
    FS --> Files["原生文件系统"]
    Git --> NativeGit["原生 Git"]
```

编译依赖：Core 仅 Node 与 contracts；host 依赖 Core/contracts/operations 和 Cordis 类型；operations 只依赖 contracts 与 Ajv；application 只依赖 contracts，不依赖 CLI、UI 或宿主；领域 `contract` 只依赖 contracts，不加载领域实现；CLI 与 UI 不依赖 Core 或领域 Plugin 实现包。UI 传输层复用同一 DSH 进程与公开用例，不创建独立 Host 或业务运行时。Session 的 `ctx.sessionQuery` 由 DSH 提供，Locus 只消费公开服务；Remote Machine 直接调用原生 OpenSSH，不读取或修改 SSH 配置；Connectivity 只保存配置引用并调用 OpenSSH，不启动 SSH/FRP 运行时；Gitea 只通过 HTTP API 读取实例、仓库与 Run，不复制 CI 历史或部署运行时。

## 宿主与扩展边界

- 当前只支持项目内 DSH/Cordis，不预建 Host 抽象、专用 Host、独立业务运行时或中央插件总线。UI 的 loopback HTTP 是当前宿主的应用传输适配层，只在显式 `ui` 命令下启动。
- CLI 的 `shell` 只是同一 CLI 插件内的长驻命令循环，复用现有命令树、领域服务和持久化；开发期 HMR 仍由 DSH/Cordis 管模块与 fiber，不新增运行时或插件管理器。
- Core/contracts 暂无 DSH/Cordis 依赖；功能与应用 Plugin 可直接使用 DSH 服务，host 不提供服务镜像或通用注册器。
- `locus` 与 `locusOperations` 由 host 唯一提供；领域 Plugin 直接提供当前需要的服务，随 fiber 撤销，不占用无关 DSH 顶层名字。领域 `contract` 只注册 Definition，Provider 由调用时解析；Definition 卸载与 Provider 卸载是两种不同状态。Session 使用 `locusSession`，不复制 `ctx.sessionQuery` 或 DSH Session 运行时；Remote Machine 使用 `locusRemoteMachine`，不复制 OpenSSH 或连接管理；Connectivity 使用 `locusConnectivity`，只组合 Remote Machine 公开用例与 OpenSSH；Gitea 使用 `locusGitea`，可选消费 DSH `credentials`，不复制 Gitea 或 DSH 凭据存储。
- `locusUi` 由 UI Plugin 提供，只在显式执行 `ui` 命令时监听 loopback；它不是第二个领域运行时，不自动启动，也不接受非 loopback 地址。UI API 需要页面内嵌会话令牌与同源检查；要求确认的操作必须显式 `confirm: true`。
- Capability 与 Plugin 不一一对应；当前声明与保存的提供方选择分开，Tag 只分类。多提供方自动仲裁未实施。
- CLI 不是模型的来源；UI 与后续 Web 调用同一应用用例和领域契约，不解析 CLI 输出或复制规则。候选能力不按清单预建包。

## 技术与数据

| 范围 | 当前选择与限制 |
| --- | --- |
| 工程 | TypeScript、Node.js、ESM、pnpm Workspace；实际环境与命令见[开发与验证](development.md) |
| 宿主 | 项目内 DSH `0.2.1-rc.5` + Cordis，既有 `locus` profile，`link:` + patch |
| 持久化 | 内置 SQLite：Core、Filesystem、Remote Machine、Connectivity 与 Gitea 各自独立库，实验版本 1；不规定后续 Plugin 的最终载体 |
| 领域读取 | Node 文件系统、无 shell 的原生 Git、只读 OpenSSH `hostname`、OpenSSH `-G`、FRP visitor 本地端口探测与 Gitea 只读 HTTP API；不取代外部事实权威，不自动复制或删除资源 |
| 验证 | 内置 Node 测试 + 真实 DSH profile；不引入额外业务测试框架或用文档检查代替业务证据 |
| Web | 最小 Workspace UI 已交付：React 18 + Vite + TypeScript + CSS Modules + clsx，纯浏览器组件不依赖 Cordis；主题使用 `--dsw-*` 变量，共享 primitives 组合，不引入 Tailwind 或组件库；由 DSH 内 UI Plugin 在 loopback 提供，无独立 Web Server |

数据所有权与物理位置独立。Core 保存长期身份、确认关系与不透明引用，Plugin 解释领域规则；外部对象不可达不等于关系不存在。Session 的消息、执行状态和标题仍由 DSH 拥有；Remote Machine 的机器资料与地址归该 Plugin；Connectivity 的 Profile 归该 Plugin，SSH 配置、凭据和 FRP/FRPP 隧道生命周期仍归 OpenSSH/用户/外部面板；Gitea 的实例配置归该 Plugin，仓库、Run、日志、Artifact、Secret、权限与凭据值仍归 Gitea/DSH credentials/用户。Core 只保存 Workspace 关联与来源命名空间。备份在停止全部写者后复制整个数据目录，原生资源和授权不隐含包含；版本、恢复与清除约定见 [Core](../packages/core/README.md#持久化与恢复)，当前模型不承诺在线多库快照或多设备同步。

Workspace Overview 由 `@locus/application` 在单次调用内组合上述公开用例与观察结果；CLI 与 UI 共用同一结果，不保存派生快照、健康分数或 Activity。每个来源的缺失、不可用与失败仍由所属领域表达。

## 控制与演进

[Workspace Capabilities CP](../.cp/cp-2026-11-09-workspace-capabilities.md)维护 Workspace 产品语义、能力组合与功能演进；[Core Primitives CP](../.cp/cp-2026-11-06-core-primitives.md)维护 Core 长期事实与持久化边界；[Host-DSH CP](../.cp/cp-2026-11-08-host-dsh.md)维护装配/服务面回归；[Bootstrap CP](../.cp/cp-2026-11-06-bootstrap.md)维护构建及运行时约束。控制面不代替源码或模块用法。

只有实际交付且验证的行为进入 implemented；未交付方向遵循 [Agent Notes 生命周期](../.agents/notes/AGENTS.md#在生命周期之间移动)。防御集中于实际输入与故障边界，不为假想异常增加重复校验、静默回退或通用抽象。
