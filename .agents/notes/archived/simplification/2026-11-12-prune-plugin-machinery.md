# 决策记录：移除预设能力机制与冗余领域插件

Status: implemented
Archived: 2026-11-13

## 问题

方向重定位确立“具体应用驱动、复用成熟技术、Workspace 属于 Core”，但仓库仍保留上一阶段为通用能力生成准备的机制：Operation Catalog 与两个 `contract` 插件、Workspace Capability 选择及每个领域的配置门禁、Application Composition/Overview、UI，以及 Git/Session/Remote Machine/Connectivity/Gitea 五个领域插件。它们共同构成约一万行源码与测试，却只服务两个生成操作和一个演示视图，并持续把已放弃的抽象写进架构与文档。

同时，五个领域各自复制 SQLite 打开、版本、完整性与锁逻辑，contracts 单文件混合所有领域类型，CLI 与 application 形成巨型文件。继续在旧结构上增量修改会让下一个具体应用继承这些假设。

## 决定

### 当前保留

- `packages/contracts`：Workspace/关系、`LocusService` 与 Filesystem 局部协议。
- `packages/core`：Workspace 身份、长期成员/关联与来源；不再包含 `capabilities` 表与选择用例。
- `packages/host-dsh`：只创建并持有 Core，提供 `locus`。
- `plugins/filesystem`：位置登记、单层发现、有界读取；不再要求 `capability configure`，加载即可用。
- `packages/cli`：`version`、`shell`、`workspace` 与 `fs` 命令；不再注入其他领域服务或 Catalog。

### 已移除

- `packages/operations`、`packages/application`。
- `plugins/git`、`plugins/session`、`plugins/remote-machine`、`plugins/connectivity`、`plugins/gitea`、`packages/ui`。
- `OperationDefinition`/Provider/Catalog 类型、`machine observe` 与 `connect verify` 生成命令、CLI 投影文件。
- `CapabilityDescriptor`、Core 能力表与 `configureCapability`/`removeCapability`、领域 `capability.ts`、CLI `capability` 命令组、跨领域门禁。
- `docs/domain-generation.md` 及对应 proposed/implemented Agent Notes。

已删除代码保留在 Git 历史中；本机 `temp/legacy-plugins/` 与 `temp/legacy-packages/` 只是被忽略的浏览副本，不是权威来源，也不参与构建与验证。

### 数据与兼容

Core 与 Filesystem 仍使用 `user_version=1`。新库不再创建 `capabilities` 表；已有实验库即使保留该表也继续可打开，代码不再读写它。项目版本仍为 `0.0.0`，不承诺旧数据迁移；删除字段或表之前仍按既有规则备份整个数据目录。

### 重新引入条件

- 领域插件：由第一个具体应用的真实需求逐个重配，从 Filesystem 开始；不按候选清单批量建包。
- Agent/MCP 暴露：直接复用 DSH Tool/MCP 与领域服务，不重建进程内 Operation Catalog 或契约 DSL。
- 多提供方仲裁、应用组合层、Web UI：出现第二个真实消费端或提供方后再设计，不预留空包与门禁。
- 公共 SQLite 助手：第二个领域需要持久化时抽取，避免为单一消费者预建共享层。

## 备选方案

**保留 Capability 选择，只取消门禁。** 能保留“按 Workspace 选择提供方”的产品语义，但会留下无人读取的表、命令与文档，且与“加载即能力”的现状矛盾。不采用；需要时重新提案。

**冻结 Catalog 与 domain-generation，而不是删除。** 可随时恢复实验，但构建、类型、profile 与文档仍承担维护成本，且新应用会误以为它是当前方向。不采用；被放弃方向的完整提案保留在[领域生成、操作契约与应用投影](../../rejected/architecture/2026-11-09-domain-generation.md)。

**用 `plugins/_legacy/` + `.gitignore` 保留旧插件。** 编辑器可见，但需要同步修改 workspace glob、tsconfig、搜索排除，并允许相对导入把废弃代码编进产物；两份代码必然漂移。改用 Git 历史与 `temp/` 浏览副本。

**逐个文件外科式删除。** 改动范围更小，但会在多轮内维持半删除状态，CLI、contracts、host、测试与文档相互引用，难以得到可构建的中间态。改为按领域整包删除，再统一收缩消费者。

## 后果

该次精简把仓库从 13 个工作区包降到 5 个，源码与测试显著减少。随后第一版交互面重新引入 `@locus/application` 与 `@locus/ui`（见[交互面决定](../feature/2026-11-12-workspace-filesystem-surfaces.md)），当前交付面为 Workspace、Filesystem、CLI 与 UI。代价是失去已交付但没有真实应用依据的五个领域与 UI/Overview 能力，需要按具体应用重新实现；Capability 选择语义与 Agent 操作发现入口暂时不存在。

精简后 `packages/contracts` 仍包含 Filesystem 类型，未按领域拆分；CLI 仍是单文件但已缩减到 Workspace/FS 两组命令。这些是后续按应用演进时的结构调整点，不在本次移除范围内。

## 验证

精简后 `pnpm build` 编译 5 个工作区包，`pnpm test` 与 `pnpm test:all` 共 46 个用例通过；第一版交互面完成后共 53 个用例通过，覆盖 Core 身份/关系/恢复、Filesystem 位置/观察/读取/生命周期、Host 卸载重载、CLI 与 shell；`pnpm docs:check` 验证文档与 Agent Notes 结构。`pnpm verify:full` 的真实 profile 冒烟覆盖 launcher、退出码、跨进程恢复、插件停用与 shell。
