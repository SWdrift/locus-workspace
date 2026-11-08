# CP Workspace Capabilities

## Control Plane Role

本平面控制 Workspace 的产品语义、Capability 组合和后续功能演进。它回答“Workspace 是什么、可以聚合哪些工作对象、下一项能力为何值得交付”，不替代架构决策、模块 README、命令手册或验证记录。

Workspace Foundation、Filesystem、最小只读 Git、Session v0 与长驻 CLI 已交付；功能状态以代码、模块 README 和 implemented Agent Notes 为准。Core 自身的身份、不透明引用与持久化边界仍由 [Core Primitives CP](./cp-2026-11-06-core-primitives.md) 控制；DSH/Cordis 装配与生命周期由 [Host-DSH CP](./cp-2026-11-08-host-dsh.md) 控制；构建与 profile 由 [Bootstrap CP](./cp-2026-11-06-bootstrap.md) 控制。

## Meta Reference

- [cp-meta.md](./cp-meta.md)：控制平面命名、结构与更新规则。
- [项目架构](../docs/architecture.md)：组件、依赖和所有权；本平面不复制组件表。
- [Workspace 产品决定](../.agents/notes/implemented/feature/2026-11-08-workspace-capability-slice.md)、[Session 集成决定](../.agents/notes/implemented/feature/2026-11-09-session-integration.md)：已交付产品语义。
- [组件与恢复决定](../.agents/notes/implemented/architecture/2026-11-08-workspace-capability-composition.md)：Core/Plugin/宿主边界。
- [后续 Capability 提案](../.agents/notes/proposed/feature/2026-11-08-workspace-capability-evolution.md)：未交付候选与排序输入。
- 模块契约与用法：[Core](../packages/core/README.md)、[Filesystem](../plugins/filesystem/README.md)、[Git](../plugins/git/README.md)、[Session](../plugins/session/README.md)、[CLI](../plugins/cli/README.md)。
- 扩展/收尾使用 `create-control-plane` / `compact-control-plane`；本平面不承载测试系统、文档整理或提交过程。

## Scope

- Workspace 的产品定义、Capability 组合模型、候选能力和功能交付次序。
- 已交付能力的产品基线，以及未交付能力的范围、非目标与验收条件。
- Session v0 的产品语义与后续扩展条件；OMP、Activity、Resume、Handoff 等只在真实调用方出现后评估。
- 不包含：Core schema/持久化实现、DSH/Cordis 装配细节、命令语法、测试分层、文档规范、代码搬迁与提交拆分。

## Core Rules

### Workspace 与能力

- Workspace 是具有稳定 Identity 的长期工作语境聚合，不等于 Folder、Project 或 Agent Session；可以聚合多个目录、项目、机器、Session、服务和其他资源。
- Workspace 允许零目录、跨层级、嵌套、交叠和共享资源；Identity 独立于名称、地址、成员和 Plugin 生命周期。
- 显式成员、长期关联、临时发现和观察必须分开；发现不自动成为成员，解除关系不删除外部资源。
- 外部资源由原生系统保持事实权威；Workspace 通过身份和不透明引用建立语境，不复制领域内部状态。
- 不建立固定 Workspace 类型继承，也不要求经过 Workspace Factory 才能创建。

### Capability 组合

- 基本方向是 `Identity + Capability Composition + Persistent Context`；Capability 是 Workspace 按需获得的语义能力。
- Capability 不等于 Plugin；一个 Plugin 可以提供多个 Capability，同一 Capability 可以由不同 Provider 实现。
- Tag 只用于分类、发现和展示，不参与依赖解析、权限或兼容性判断；当前初步分类为 `environment`、`development`、`connectivity`、`collaboration`。
- Protocol 只描述真实跨能力交互所需的最小契约；Plugin 与 DSH/Cordis 服务负责具体实现，不预建通用依赖求解器、中央 Capability Registry 或统一 Plugin SDK。
- 必须区分已保存的能力选择、已加载提供方声明、已配置、实际可用和已授权；这些不是同一种状态。
- Blueprint 是可选的初始能力与配置组合，不是 Workspace 的运行时类型；通过 Blueprint 形成的 Workspace 必须能脱离 Blueprint 继续演进。
- 候选清单不是实现义务；没有真实调用方和产品链路时，不创建空包、空类型、空服务或占位入口。

### 所有权与宿主

- Core 负责 Workspace Identity、长期成员/关联、必要来源和 Capability 选择，不解释 Git、Filesystem、CI、Session 等领域规则。
- Capability Plugin 负责领域语义、操作、观察、缓存及其自有配置和持久化；Plugin 之间可直接通过 Protocol 与 Cordis 服务协作。
- DSH/Cordis 是当前唯一运行宿主；不建设独立 Host、第二运行时、中央服务总线或通用 RPC。`host-dsh` 保持薄装配。
- Core 与 contracts 暂不依赖 DSH/Cordis；功能和应用 Plugin 可以直接使用宿主服务。
- 数据所有权与物理位置独立；Plugin 缺失、卸载或资源不可达不得自动删除已确认的 Workspace 长期关系，观察结果也不能无条件视为永久真实状态。

### 演进与证据

- 只有实际交付且经过真实运行验证的行为进入已交付基线；类型、命令或候选清单存在不等于功能已实现。
- 新 Capability 必须先证明真实用户价值与至少一个组合场景，再决定是否新增包或协议；不按候选表批量物化。
- 产品语义、长期取舍和重新引入条件写入 Agent Notes；命令与操作归命令手册/模块 README；本平面只保留当前功能边界、任务和验收。
- Session、OMP、Activity、Continuity、Knowledge、Handoff 等概念不得提前写成 Core 原语或稳定公共契约，除非已有真实使用和验证。

## Task Board

### 当前

- [ ] 评估下一 Capability，默认候选 Remote Machine；先验证真实设备、机器身份、可达性与登记边界，不把“已登记”当成“SSH 可达”。
- [ ] 为 Session v0 的后续扩展保留触发条件：仅在出现 OMP Provider、Web 授权入口或 Activity/Resume 真实调用方时再设计，不预建 Session Runtime、Memory 或 Handoff 框架。

### 暂缓

- 通用 Memory、自动会话总结、知识提炼、全量 Activity Timeline、Agent Handoff 框架与自建 Session 存储。
- 跨设备同步、在线多库快照、远程发现与嵌套 Workspace 递归查询。
- 多提供方自动仲裁、通用 Capability Registry 与统一 Plugin SDK。

## Delivered Baseline

| 功能 | 当前产品基线 |
| --- | --- |
| Workspace Foundation | 持久 UUID、创建/打开/改名、显式成员与关联、解除关系；零目录与多资源语境；能力选择状态区分；插件缺失仍保留长期事实。 |
| Filesystem | 本机位置登记、按需发现、检查与有界读取；区分缺失/拒绝/不可用；路径不是跨设备全局身份。 |
| Git | 通过 Filesystem 线索只读观察仓库、分支、提交、工作树和脱敏 Remote；非仓库正常；不修改原生仓库。 |
| Session v0 | 通过 DSH `sessionQuery` 只读发现；显式关联/解除；区分 live/persisted/unavailable；来源命名空间隔离；不复制 transcript 或执行状态；条件允许时返回 headless 原生入口。 |
| 交互基础 | 长驻 CLI shell 复用既有命令树与领域服务；保留单次 CLI；HMR 属于开发交互基础，不在此 CP 建立新的测试或重构任务。 |

已交付决定与限制：[Workspace 切片](../.agents/notes/implemented/feature/2026-11-08-workspace-capability-slice.md)、[Session 集成](../.agents/notes/implemented/feature/2026-11-09-session-integration.md)。

## Candidate Backlog

| Capability | 初步 Tag | 产品范围与边界 |
| --- | --- | --- |
| Gitea | `development`、`collaboration` | 仓库、CI/CD 流水线与执行结果；Gitea 拥有原生事实，授权与秘密处理成本高。 |
| Nginx | `environment` | 初期只观察配置与运行信息；不要求部署、修改或管理 Nginx。 |
| Database | `environment`、`development` | 数据源登记、连接、结构与状态；需要驱动、端点和凭据，先做只读观察。 |
| Remote Machine | `environment` | 远程机器身份、登记、环境与状态；机器存在不等于 SSH 可达。 |
| FRP / SSH | `connectivity` | SSH 连接、FRP Link、隧道与可达性；连接不拥有机器或数据库生命周期。 |
| Project Management | `collaboration` | 看板、排期、任务和进度；不能反向定义 Workspace 身份。 |
| Project Template | `development` | 项目结构、初始化和脚手架；与 Workspace Blueprint 不是同一概念，写操作风险最高。 |

Gitea、FRP 等产品集成与一般 Capability/Protocol 可能处于不同抽象层；当前按产品功能保留，不急于统一实现形态。Filesystem、Git、Session 已交付，不再列为待实现候选。

## Session v0 Acceptance

Session v0 已满足产品验收：

- 可以从 Workspace 重新发现并查看当前 DSH 来源的 Session 元信息与标题。
- 可以显式关联和解除关联；一个 Workspace 可关联多个 Session，同一 Session 可被多个 Workspace 关联。
- 相同 cwd、标题或相近时间不会自动证明归属，也不会自动合并。
- live、persisted、unavailable 分开表达；Session 结束、不可访问或 Plugin 停用不删除长期关联。
- 原生 Session、transcript 与执行状态仍归 DSH；Core 只保存不透明关联和来源。
- 可返回 headless 原生继续入口；fork、subagent、无 cwd 等不可靠场景明确不可用。
- 默认不复制完整 transcript；内容敏感时不因存在关联而扩大读取权限。

验证证据与已知限制见 [Session 集成决定](../.agents/notes/implemented/feature/2026-11-09-session-integration.md#测试)和 [Session README](../plugins/session/README.md#状态与返回)。

## Unresolved Product Questions

- OMP Session Provider 的来源标识、ID 映射、恢复能力和权限契约尚未定义。
- Session 的 Activity/Resume/Handoff 是否应成为独立产品概念，仍需真实工作流证据。
- Workspace 如何聚合“持续发生的工作”，而不是只聚合资源，仍未有足够工程证据。
- Gitea、FRP/SSH 与通用 Capability/Protocol 的抽象层级关系尚未统一；先按产品功能推进。
- 跨设备同步、在线一致备份和远程资源发现不在当前承诺内。
