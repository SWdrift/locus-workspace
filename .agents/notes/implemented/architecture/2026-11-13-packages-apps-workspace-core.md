# 决策记录：回退 DSH 插件宿主，保留 Workspace Core 与独立 CLI

Status: implemented

## 问题

Locus 作为项目内 DSH profile 插件运行后，CLI 不是可直接调用的 `locus` 命令，而是依赖 `DSH_HOME`、`link:` 安装、profile patch 与 Cordis 生命周期的应用插件。一次性命令冷启动以秒计，Skill 与外部脚本无法把它当成稳定入口；DSH 的 preview 版本又把升级成本转移到宿主装配与抄写的 UI 主题上。

与此同时，产品面持续围绕 DSH Web 的 slot、header、rightbar 与面板归属反复调整。复盘已记录六个失败点：目标没有单一契约、反复改架构、自绘与原生混用、依赖内部补丁、边界未冻结、把文件当成独立功能。根因不是某个 UI 细节，而是宿主拥有 UI、生命周期与装配，Workspace 自身没有稳定边界。

另一条范围问题是能力铺得过宽：Filesystem 的位置登记、读取与写入，UI 传输层，以及两者共享的 application/contracts，都建立在只有一个真实消费端的假设上。继续保留它们会让这次回退变成半迁移。

## 决定

采用 packages + apps，删除插件宿主与一切非 Workspace 能力：

- [packages/core](../../../../packages/core/README.md) 是唯一领域内核与公开面。它内联 Workspace、关系与引用类型，导出 `createLocusCore()`、`LOCUS_VERSION` 与 `WorkspaceService`；只有 Node 与 `node:sqlite` 依赖。
- [apps/cli](../../../../apps/cli/README.md) 是独立 Node 可执行程序，提供 `locus` bin，只依赖 `@locus/core` 与 Commander。命令树仅保留 `version` 与 `workspace`；没有 profile、Cordis 注入、`ui`、`fs`、`shell`。
- `apps/web` 只保留占位 README。没有空服务器、路由或前端框架，等出现真实接口消费需求再实现。
- 删除 `packages/contracts`、`packages/application`、`packages/host-dsh`、`packages/dsh-surface`、`packages/ui`、`plugins/filesystem` 与 `.dsh` profile 装配文档。共享类型进入 core；Workspace 用例不再经过独立 application 层。
- 删除 DSH 依赖与对应的 Host/UI/shell 测试，保留 `tests/run.mjs` 分层入口、`test:all`、`e2e`、`verify:full` 与 2 小时 e2e 冷却。收集范围改为 `packages/*/test`、`components/*/test`、`apps/*/test` 与 `tests/*.test.mjs`，e2e 改为真实 CLI 场景。
- `core.sqlite`、`user_version=1`、Workspace 身份与关系表不变；本次不迁移或删除用户数据。

CLI 每次进程启动直接创建 Core，命令完成后 `dispose()`；`--json` 输出单一 JSON，诊断写 stderr，退出码保持 0 成功、1 参数/帮助拒绝、2 业务或持久化失败。数据目录的配置契约由 [2026-11-14 数据目录配置](2026-11-14-data-directory-configuration.md) 维护。

2026-11-15 起 Core 增加声明式组件登记、物化与状态；仍不加载插件代码，包仍在组合根显式接入。该扩展见[组件模型](2026-11-15-component-model.md)。

## 保留的 Workspace 语义

回退不改变 Workspace 的产品含义，这些规则继续以 Core 和测试为准：

- Workspace 具有持久 UUID，不等于目录、Project 根或 Agent Session；可以没有任何目录。
- `member` 与 `association` 是显式长期关系；目标是领域解释的 `namespace` / `id` 不透明引用；重复确认同种类与目标保持幂等，并保留首次来源。
- 打开、改名与重启不建立隐式当前目录或 Session；解除关系只删除 Locus 自身记录，不删除外部资源。
- Core 独占 `core.sqlite`；未知版本、损坏或非空未版本化库明确失败，不自动重建。备份是停止写者后复制整个数据目录。
- 观察与外部事实不因本次保留范围而进入 Core；Workspace 只保存用户确认的长期关系。

## 备选方案

**继续以 DSH 插件运行，只把 CLI 拆成独立 bin。** 能保留 Agent Host、Session、UI Slot 与现成 HMR，但 profile、Cordis 生命周期和 DSH 版本耦合仍在；Skill 虽可调用 CLI，宿主仍拥有装配与 UI 边界。本次要解决的是边界，不是启动方式，故整体退出。

**保留 contracts 与 application 两个包。** 可以维持类型与用例的分层，但当前只有 Core 与 CLI 两个生产/消费方，类型可以直接由 core 导出；保留这些包会继续制造“为未来消费端预留”的空层。等 Web 浏览器需要同构 DTO 时再抽取，不提前维护。

**保留 Filesystem、UI 与 Web 骨架，只删 DSH。** 迁移面更小，但会把需要重新设计的领域与传输层带进新结构，且没有真实消费需求支撑。当前只保留 Workspace Core，其他能力按后续应用逐个重配。

**保留 `shell` 长驻命令。** 独立 CLI 后不再有 Cordis 热重载与 profile 启动成本，shell 主要复制操作系统终端与命令历史；它还会引入第二套解析与错误处理路径。删除，连续操作交给用户的 shell 或后续脚本。

**先做 Web 最小服务。** 可以先验证 packages 依赖方向，但 Web 正是上一轮消耗最多、契约最不稳定的表面。先用 CLI 验证 core 暴露面与日常操作，Web 只留占位。

## 后果

收益：CLI 成为可直接执行、可被 Skill 与脚本调用的稳定入口；启动不再经过 DSH profile；仓库从 8 个工作区包降到 2 个，源码与测试只围绕 Workspace；类型、持久化与命令行为有单一所有者，文档中的宿主装配与 UI 归属问题整体消失。分层测试与 e2e 冷却入口保留，系统性测试的元层面代码不随宿主一起删除。

代价：失去 Filesystem 的位置登记、发现、读取与写入，失去本地 UI 与 DSH Web 表面，也失去 DSH 提供的 Agent Runtime、Session 关联与 UI 复用。`workspace link` 仍可保存任意命名空间引用，但在对应领域包重新出现前，没有领域命令去发现或验证它们。Web 当前不可用。

重新引入的条件：出现第二个真实消费端时抽取同构契约；某个能力有真实操作闭环时再建立独立 package 并接入 Core；不恢复通用插件加载器、Operation Catalog 或能力注册表。Web 只在 CLI 用例稳定且出现页面需求后实现。

## 验证

- `pnpm build`：编译当前 workspace 包，退出 0。
- `pnpm test` / `pnpm test:all`：Core 与 CLI 子进程测试通过。
- 真实命令：`pnpm locus version` 输出 `0.0.0`；`workspace create/list/show/rename/link/unlink` 在独立进程中跨进程恢复；`version` 与 `--help` 不创建数据目录；未知命令退出 1，业务失败退出 2。
- `pnpm verify:full`：构建、测试、文档检查与 CLI e2e 通过；随后再次执行 `pnpm e2e` 以退出码 3 命中冷却。
- `pnpm docs:check` 与 `pnpm docs:test` 通过。
