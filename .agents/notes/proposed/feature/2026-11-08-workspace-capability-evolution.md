# 决策记录：后续 Capability、Blueprint 与跨设备工作语境

Status: proposed

## 问题

长期 Workspace 的基础切片不能被误当成全部产品，也不能为了扩展方便提前建立空包、通用协议或第二套插件运行时。后续能力需要保留清晰的候选范围，以及不会被本机 Filesystem/Git 地址模型封死的语义边界。

本记录承接[Workspace 切片](../../implemented/feature/2026-11-08-workspace-capability-slice.md)中尚未实施的部分；基础能力的交付状态与执行证据由该主题及相关模块负责。此处不是当前实施任务板。

## 提案

### 简述与职责

候选能力按真实用户场景逐个加入；Capability 按需组合、Tag 仅分类、领域事实自治的方向不变。本文维护尚未交付的能力候选、Blueprint 与跨设备/多提供方语义；具体协议在出现真实调用双方后确定，不在此生成接口或包结构。

### 后续候选能力

Filesystem、最小只读 Git、Remote Machine 与 DSH Session 已交付；Session 与 Remote Machine 的决定和限制分别见[Session 集成](../../implemented/feature/2026-11-09-session-integration.md)及[Remote Machine](../../implemented/feature/2026-11-09-remote-machine.md)。以下其余候选不是已实现功能，也不按行创建包。

| Capability | 初步 Tag | 原生前提与组合机会 |
| --- | --- | --- |
| Gitea | `development`、`collaboration` | 实例地址、API 与授权；Git Remote 可以建议关联，也可独立登记远端仓库；CI/CD 事实仍由 Gitea 拥有 |
| Nginx | `environment` | 访问配置与运行信息；可组合 Filesystem 或远程访问，不固定传输 |
| Database | `environment`、`development` | 驱动、端点与授权；可组合机器和连接能力，不要求目录 |
| FRP / SSH | `connectivity` | 复用既有 FRP/OpenSSH 与授权；连接不拥有机器或数据库生命周期 |
| Project Management | `collaboration` | 看板、排期、进度的领域来源；可关联 Workspace/Gitea/Session，但不把 Workspace 定义成 Project |
| Project Template | `development` | 模板来源与可写目标；组合 Filesystem/Git；项目脚手架不等于 Workspace Blueprint |

Tag 可以多选，不用于依赖解析、权限或接口兼容性判断。新增能力应证明其自身价值与至少一个真实组合用例，而不是为了候选列表整齐建设通用框架。

### 实施次序评估

排序依据用户价值、现有依赖、真实验证条件和增量成本，不沿用原始清单顺序。下表是下一轮候选顺序，不是承诺或已排期任务。

| 次序 | Capability | 判断依据与主要风险 |
| --- | --- | --- |
| 1 | Gitea | 能验证外部系统授权、仓库与 CI 观察；价值高，但需要实例、令牌/凭据和网络条件。宜先做只读仓库/Actions 观察。 |
| 2 | FRP / SSH | 依赖 Remote Machine 已有登记与连接目标；负责连接与隧道观察，不复制 OpenSSH/FRP 运行时。 |
| 3 | Nginx | 可复用 Filesystem 或远程访问读取配置与运行状态，成本适中，但单独价值弱于前两项。 |
| 4 | Database | 需要驱动、端点与凭据，误操作风险高；在前述能力提供连接与授权语境后再做只读观察更稳妥。 |
| 5 | Project Management | 领域模型较厚、外部授权复杂，且容易把 Workspace 误建成 Project；需要明确真实工作流后再启动。 |
| 6 | Project Template | 涉及写操作和项目脚手架，误改风险最高；应最后实现，并与只读能力、显式确认和回滚策略一起验证。 |

Remote Machine 已交付，为 FRP/SSH、Nginx 与 Database 提供机器引用基础；其连接、删除与外部观察限制见[Remote Machine 记录](../../implemented/feature/2026-11-09-remote-machine.md#暂缓)。Session 已交付，但其 OMP 来源映射、Web 授权与完整 transcript 浏览仍留在[Session 记录](../../implemented/feature/2026-11-09-session-integration.md#暂缓)。

### Blueprint 与多提供方

Workspace Blueprint 是可选初始配置方案，不是 Workspace 的运行时类型或永久依赖。[命令配方](../../../../docs/commands.md#初始配置配方)可用于复用已经支持的配置动作；没有 Blueprint 解析器、模板引擎或自动升级机制。

只有出现需要多次应用的真实配置需求，才实现执行器；执行后应形成普通、可独立维护的 Workspace 与 Plugin 配置。删除或升级 Blueprint 不应使已有 Workspace 无法打开，也不隐式重写其后续修改。

同一 Capability 允许不同 Plugin 实现，一个 Plugin 也可以提供多个 Capability。基础代码不提供多提供方自动仲裁或热替换迁移；需要真实第二提供方后再实验 Protocol 兼容性、配置迁移与引用解释，不能以同 Tag 推断可替代。

### 跨设备与长期引用

Workspace 语义允许跨目录层级、设备、外部系统及交叠成员；本机路径引用不是跨设备对象 Identity。跨设备接入时应保留原生系统权威，明确引用解析来源、授权与迁移规则，不把恢复到另一台机器的同名路径自动判成同一对象。

多设备同步、离线冲突解决、远程发现及嵌套 Workspace 的递归查询均未实施。若引入这些能力，必须先给出真实资源与恢复/冲突场景，不在 Core 中预建联邦身份或所有权继承。

## 备选方案

**一次完成完整 DevOps。** 旧提案曾把 Git/Gitea/CI/SSH/Agent 设为同一版本门槛，扩大外部依赖并掩盖身份和恢复问题。本记录保留候选，但实施仍逐个验证。

**固定 Workspace 类型、强制 Factory 或永久绑定 Blueprint。** 与长期工作语境可独立演化冲突；初始配置应可脱离模板维护，不采用。

**先建多提供方仲裁器、统一领域协议或联邦存储。** 没有真实双端证据，容易重复 DSH/Cordis 或把本机路径提升成全局身份。不采用，等待具体组合与迁移问题。

## 验收标准

- 新能力连接真实原生系统，明确声明/配置/可用性/授权与故障状态，不用 mock 冒充集成成功。
- 新 Plugin 缺失或卸载不丢 Workspace 身份及已确认关系；其自身领域状态有独立的恢复约定。
- 若实现 Blueprint 执行，移走 Blueprint 后已有 Workspace 仍能打开、修改和恢复；应用过程失败不报告半成功。
- 若实现第二提供方或跨设备，兼容、引用、授权和数据迁移均有真实验证；Tag 不参与自动替换判断。

## 风险

- **范围回涨。** 候选清单不是本版本任务板；未启动的能力保持提案，不产生空包或伪可用状态。
- **地址混成身份。** 仅凭 URL、同名路径或 Remote 推断资源等价会误绑，需要由所属领域和实际来源验证。
- **模板侵入运行时。** Blueprint 更新不能成为已有 Workspace 启动条件；自动回写或升级需要另行定义确认与失败恢复。
- **复用变成再造。** 继续复用 DSH/Cordis 与外部系统，不能为组合能力建立第二运行时。
