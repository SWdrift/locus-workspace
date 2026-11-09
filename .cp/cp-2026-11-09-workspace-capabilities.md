# CP Workspace Capabilities

## Control Plane Role

本平面控制 Workspace 的产品语义、Capability 组合和后续功能演进。它回答“Workspace 是什么、可以聚合哪些工作对象、下一项能力为何值得交付”，不替代架构决策、模块 README、命令手册或验证记录。

Workspace Foundation、Filesystem、最小只读 Git、Remote Machine v0、Connectivity v0、Gitea v0、Session v0、Workspace Overview v0 与长驻 CLI 已交付；功能状态以代码、模块 README 和 implemented Agent Notes 为准。Core 自身的身份、不透明引用与持久化边界仍由 [Core Primitives CP](./cp-2026-11-06-core-primitives.md) 控制；DSH/Cordis 装配与生命周期由 [Host-DSH CP](./cp-2026-11-08-host-dsh.md) 控制；构建与 profile 由 [Bootstrap CP](./cp-2026-11-06-bootstrap.md) 控制。

## Meta Reference

- [cp-meta.md](./cp-meta.md)：控制平面命名、结构与更新规则。
- [项目架构](../docs/architecture.md)：组件、依赖和所有权；本平面不复制组件表。
- [Workspace 产品决定](../.agents/notes/implemented/feature/2026-11-08-workspace-capability-slice.md)、[Session 集成决定](../.agents/notes/implemented/feature/2026-11-09-session-integration.md)、[Remote Machine 决定](../.agents/notes/implemented/feature/2026-11-09-remote-machine.md)、[Connectivity 决定](../.agents/notes/implemented/feature/2026-11-09-connectivity.md)、[Gitea 决定](../.agents/notes/implemented/feature/2026-11-09-gitea.md)、[Overview 决定](../.agents/notes/implemented/feature/2026-11-09-workspace-overview.md)：已交付产品语义。
- [组件与恢复决定](../.agents/notes/implemented/architecture/2026-11-08-workspace-capability-composition.md)：Core/Plugin/宿主边界。
- [后续 Capability 提案](../.agents/notes/proposed/feature/2026-11-08-workspace-capability-evolution.md)：未交付候选与排序输入。
- 模块契约与用法：[Core](../packages/core/README.md)、[Filesystem](../plugins/filesystem/README.md)、[Git](../plugins/git/README.md)、[Remote Machine](../plugins/remote-machine/README.md)、[Connectivity](../plugins/connectivity/README.md)、[Gitea](../plugins/gitea/README.md)、[Session](../plugins/session/README.md)、[CLI](../plugins/cli/README.md)。
- 扩展/收尾使用 `create-control-plane` / `compact-control-plane`；本平面不承载测试系统、文档整理或提交过程。

## Scope

- Workspace 的产品定义、Capability 组合模型、候选能力和功能交付次序。
- 已交付能力的产品基线，以及未交付能力的范围、非目标与验收条件。
- Workspace 的组合视图、跨能力观察成本、事实来源和后续操作入口；不要求所有能力同时存在。
- Remote Machine v0、Connectivity v0、Gitea v0 与 Session v0 的产品语义、后续扩展条件和连接边界；OMP、Activity、Resume、Handoff、FRPP 管理、PTY 交接与 CI→部署推断只在真实调用方出现后评估。
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

- [x] Gitea v0 已交付；后续 CI→部署闭环只在出现真实部署凭据、目标机器和可回滚操作时设计，不因 Run 成功自动建立部署关系。
- [x] Workspace Overview v0 已在 CLI 应用层交付；跨能力组合只消费公开服务，不新增中央 Registry、通用查询引擎或领域持久化。
- [ ] 评估下一 Capability，默认候选 Nginx/Database；先验证真实实例、授权与只读观察，不把候选表当成建包义务。
- [ ] 为远程执行与部署观察保留 Machine/Connection 引用条件；不把 Profile 变成执行运行时。
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
| Remote Machine v0 | 稳定 UUID、多个地址、显式 Workspace 关联；登记不要求 SSH/在线；改名/地址修改保持 Identity；单 SSH 地址只读观察，区分不可达/拒绝/不可用/未知；不保存凭据、不拥有连接。 |
| Connectivity v0 | 机器级 Connection Profile；direct/proxy-jump/frp；复用 OpenSSH 有效配置；inspect 不连接、verify 只读 hostname；严格主机密钥；FRP 只引用既有 visitor；Profile 更换不改变 Machine；原生命令入口。 |
| Gitea v0 | 实例 UUID；来源限定仓库引用（instance:repo ID）；只读仓库/Run/提交观察；Git Remote 仅建议关联；Workspace 显式关联；区分 Actions 未启用、API 不支持、认证/网络失败与空 Run；凭据只存名称。 |
| Workspace Overview v0 | CLI 应用层聚合 Workspace、Filesystem、Git、Gitea、Session、Remote Machine 与 Connectivity；默认只读长期关系和本地配置，`--observe` 才做有界只读观察；区分已确认/本次观察/未确认建议/未知；不新增健康分数、通用查询引擎或领域持久化。 |
| 交互基础 | 长驻 CLI shell 复用既有命令树与领域服务；保留单次 CLI；HMR 属于开发交互基础，不在此 CP 建立新的测试或重构任务。 |

已交付决定与限制：[Workspace 切片](../.agents/notes/implemented/feature/2026-11-08-workspace-capability-slice.md)、[Session 集成](../.agents/notes/implemented/feature/2026-11-09-session-integration.md)、[Remote Machine](../.agents/notes/implemented/feature/2026-11-09-remote-machine.md)、[Connectivity](../.agents/notes/implemented/feature/2026-11-09-connectivity.md)、[Gitea](../.agents/notes/implemented/feature/2026-11-09-gitea.md)。

## Candidate Backlog

| Capability | 初步 Tag | 产品范围与边界 |
| --- | --- | --- |
| Nginx | `environment` | 初期只观察配置与运行信息；不要求部署、修改或管理 Nginx。 |
| Database | `environment`、`development` | 数据源登记、连接、结构与状态；需要驱动、端点和凭据，先做只读观察。 |
| Project Management | `collaboration` | 看板、排期、任务和进度；不能反向定义 Workspace 身份。 |
| Project Template | `development` | 项目结构、初始化和脚手架；与 Workspace Blueprint 不是同一概念，写操作风险最高。 |

Gitea 等产品集成与一般 Capability/Protocol 可能处于不同抽象层；当前按产品功能保留，不急于统一实现形态。Filesystem、Git、Remote Machine、Connectivity、Gitea、Session 已交付，不再列为待实现候选。

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

## Remote Machine v0 Acceptance

Remote Machine v0 已满足产品验收：

- 零目录 Workspace 可以关联机器；同一机器可被多个 Workspace 共享。
- 登记不要求 SSH、凭据或机器在线；改名、地址增删与修改不改变 Machine Identity。
- hostname/IP/SSH 地址相同不会自动合并不同机器。
- 解除一处关联不删除机器、地址或其他 Workspace 关联；插件停用与 DSH 重启后长期关系仍保留。
- 资料/地址/关联与连接验证分离；`machine observe` 只对一个 SSH 地址做只读 `hostname` 观察，并返回来源、时间和 `single-address` 范围。
- 无 SSH、不可达、认证拒绝、主机密钥失败与未知错误分别表达；失败不删除机器或关联。
- 不保存 SSH 私钥、密码、Token 或原始 stderr；不网络扫描、不自动创建连接、不修改远端系统。
- CLI shell 连续执行机器命令；Remote Machine 构建产物变化触发 HMR 后同一 shell 继续工作，既有 Filesystem/Git/Session/Core-Host/CLI 回归通过。

Remote Machine 自身的 `machine observe` 成功路径只在本机临时 sshd 验证；Connectivity 已另行验证 ProxyJump 与现有 FRP visitor。外部网络条件与机器全局在线仍未验证。证据与限制见 [Remote Machine 决定](../.agents/notes/implemented/feature/2026-11-09-remote-machine.md#测试)。

## Connectivity v0 Acceptance

Connectivity v0 已满足产品验收：

- 同一 Machine 可保存 direct 与 proxy-jump 等多个 Profile；修改/删除 Profile 不改变 Machine Identity。
- `inspect` 复用系统 OpenSSH 或显式配置文件，返回有效 hostname/port/user/ProxyJump/身份与 known_hosts 计数，不连接远端、不返回敏感路径。
- `verify` 只执行一次只读 `hostname`，强制主机密钥校验，并区分配置、认证、主机密钥、网络、目标不可用与 OpenSSH 缺失。
- OpenSSH 直连与 ProxyJump 在真实临时 sshd 上验证成功；FRP 通过现有 FRPP visitor 连接到已登记 Windows Dev 验证成功，Hostname 为 `<windows-dev>`。
- FRP Profile 不启动/修改 FRPP client、面板配置、Link 或 visitor；验证后停止客户端，未修改远端状态。
- Profile 路径默认脱敏；`open` 才输出必要原生命令。当前 CLI 不接管 Agent/Web PTY，保留原生命令入口。
- Plugin 停用、DSH 重启不删除 Profile；CLI shell/HMR 与既有 Capability 回归通过。

证据与限制见 [Connectivity 决定](../.agents/notes/implemented/feature/2026-11-09-connectivity.md#测试)。

## Gitea v0 Acceptance

Gitea v0 已满足本轮产品验收：

- 可以登记真实 Gitea 实例并只读验证版本与凭据；Token 值不进入 Locus 数据、Workspace 关系、错误、日志或测试快照。
- 可以按来源限定引用观察仓库、默认分支与 Actions 状态；仓库改名后数字 ID 仍可解析当前完整名称。
- 可以从本地 Git Remote 生成候选，但只有显式 `gitea repo link` 才写入长期关系；无本地仓库的 Workspace 也可直接关联。
- 一个 Workspace 可关联多个 Gitea 仓库；多个 Workspace 可共享同一来源限定仓库引用。
- Run 区分成功、失败、运行中、待处理、取消、其他与未知；`completed` 不自动等同 success。
- 空 Run、Actions 未启用、API 不支持、认证/权限、限流、不可达、超时与重定向分别表达，不把访问失败写成“没有流水线”。
- `gitea ci` 按本地 Git HEAD 查询关联仓库；无匹配 Run 与 Remote/仓库不匹配分别报告。
- Plugin 停用、实例不可达、凭据失效或仓库不可访问不删除 Workspace 长期关系与实例配置。
- 真实 Gitea 1.25.5 的仓库、Run 列表/详情、`head_sha` 过滤、成功/失败/取消、多仓库与共享引用已验证；DSH 重启与 shell 连续操作已验证。HMR 在本轮交互环境未观察到 Gitea 模块替换，因此不把 Gitea HMR 写成已验证行为。

证据与限制见 [Gitea 决定](../.agents/notes/implemented/feature/2026-11-09-gitea.md#测试)。

## Workspace Overview v0 Acceptance

Workspace Overview v0 已满足本轮产品验收：

- `workspace overview <id>` 能在应用层组合 Workspace、Filesystem、Git、Gitea、Session、Remote Machine 与 Connectivity，不新增领域持久化、中央 Registry 或通用查询引擎。
- 默认模式只读长期关系与已保存配置，不访问原生文件、Git、Session、Gitea API 或 SSH；相应状态显示为未观察。
- `--observe` 并发执行有界只读查询；Filesystem、Git、Session、Gitea 或 Connectivity 单段失败不隐藏其他段成功结果。
- 输出区分已确认关系、本次观察、未确认建议与未知/不可用；不生成单一 Workspace 健康分数。
- 人类与 JSON 输出把可执行下一步放在对应资源附近；缺少可选 Session/Profile 不自动进入 attention，Plugin 未加载、未配置与原生资源不可访问分别表达。
- 已保存关系但能力未选择时，`--observe` 不查询该领域，显示 `not-observed` 并提供 `capability configure`；能力选择仍是观察前提。
- Git Remote 只产生 Gitea 建议，不写长期关系；只有唯一本地仓库/Remote 匹配且有提交时才按 `head_sha` 展示对应 CI。无匹配、多个匹配、无提交分别表达。
- `matched/empty` 提供查看近期 Run、提交与触发条件的入口；`unmatched` 提供重新生成候选的入口；不自动关联、不触发 CI、不执行 SSH。
- 零资源 Workspace 正常显示；插件停用与资源不可达仍保留长期关系，并提供其他领域结果。
- 真实 Gitea 1.25.5 下验证了最近 Run、历史失败 Run、`matched/empty` 与 `unmatched`；本地工作树变化反映为 attention。
- 同一 Gitea 认证/网络故障按状态与错误合并 attention，不再为每个仓库重复同一根因。
- 长驻 shell 连续执行默认/观察/默认 Overview 复用同一 DSH 进程；profile 冒烟覆盖 62 个独立 DSH 进程。

证据与限制见 [Workspace Overview 决定](../.agents/notes/implemented/feature/2026-11-09-workspace-overview.md)。

## Unresolved Product Questions

- OMP Session Provider 的来源标识、ID 映射、恢复能力和权限契约尚未定义。
- Session 的 Activity/Resume/Handoff 是否应成为独立产品概念，仍需真实工作流证据。
- Workspace 如何聚合“持续发生的工作”，而不是只聚合资源，仍未有足够工程证据。
- Overview 当前是显式快照与单次观察，不是持续刷新、后台同步或 Activity Timeline；下一阶段应先解决真实工作路径中的引导与操作缺口。
- Gitea 与通用 Capability/Protocol 的抽象层级关系尚未统一；先按产品功能推进。CI Run 与 Machine/部署的关联仍缺少真实部署证据。
- Remote Machine 的 Connection 生命周期、机器删除、共享引用清理与外部网络观察仍未定义。
- Connectivity 的 FRPP 配置下发、visitor 启停、Link 管理和 CLI/DSH PTY 交接仍未交付；Profile 自动选择、连接历史与并发连接池也未定义。
- 跨设备同步、在线一致备份和远程资源发现不在当前承诺内。
