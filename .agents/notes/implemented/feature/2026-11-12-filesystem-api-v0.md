# 决策记录：Filesystem v0 写入契约与 DSH 原生复用审计

Status: implemented

## 问题

Filesystem 已有位置登记、单层发现、有界读取与显式确认，但无法新建文件、目录或重命名，实际使用仍停在只读观察。方向材料还假设 DSH 通过 `renderFactorySlot('sidebar.files.tree', ...)` 提供可复用文件树。宿主已从 `0.2.1-rc.5` 升级到 `0.2.2-rc.1`，复用结论按新版本的实际包更新：该 Factory 已存在。

本轮要在不冻结 Mount、Provider、远程文件系统的前提下，交付一个可验证的写入闭环：Locus 自己的 Application 契约、Node 本机实现、路径与冲突防护、真实测试，以及一份可继续演进的复用审计。

## 决定

Locus 继续拥有 Filesystem Application 契约，本机后端直接使用 Node `fs/promises`，不建立通用 VFS。`FilesystemService` 在现有位置、观察与读取之外增加三个用例，均返回操作后的真实观察：

| 用例 | 语义 | 拒绝条件 |
| --- | --- | --- |
| `createFile(workspaceId, locationId, relativePath)` | 在已登记位置内新建空文件 | 位置根、目标已存在、父目录缺失、父路径含链接、越界或绝对路径、原生命令失败 |
| `createDirectory(workspaceId, locationId, relativePath)` | 新建单层目录 | 位置根、目标已存在、父目录缺失、父路径含链接、越界或绝对路径、原生命令失败 |
| `rename(workspaceId, locationId, from, to)` | 同一位置内重命名普通文件或目录 | 源缺失、目标已存在且不是同一文件、位置根、源是符号链接、越界或绝对路径、原生命令失败 |

写失败抛出 `FilesystemFailure`，`code` 为封闭集合 `invalid`、`outside-location`、`not-found`、`exists`、`not-directory`、`symlink`、`unavailable`、`denied`、`io`；消息保留原生错误类别与业务主体，不回显可能含敏感内容的原生异常正文。交互面按 `code` 映射提示，不解析消息。

写入从绝对路径根逐段检查父路径，拒绝穿过符号链接或 junction；先检查后写入存在竞态窗口，不宣称 OS 沙箱。新建与重命名默认不覆盖，破坏性操作没有隐式回退。所有写操作都不自动创建 Core 关系，只有显式 `confirmResource` 建立长期关联。

`@locus/application` 增加同名用例（重命名投影为 `renameEntry`，避免与 Workspace 改名混淆），CLI 与 UI 继续不复制领域规则。本轮未接入 CLI 命令与 UI 操作，写入能力目前由服务契约、应用用例与测试证明。

宿主升级到 `0.2.2-rc.1`；`@locus/cli` 的 `dsh-cmdline` 依赖范围同步放宽到 `^0.2.2-rc.1`，避免新小版本被 DSH 兼容检查禁用整行。

## DSH 原生复用审计

审计对象是本仓库实际安装的 DSH `0.2.2-rc.1` 包，而不是方向材料中的预期扩展点。

| 能力 | 实际形态 | 结论 |
| --- | --- | --- |
| `@deepseek-ai/dsh-client-ui-sidebar-files` | 右侧栏 `files` tab 类型，同时导出 `sidebar.files.tree` Factory：调用方提供 `root`、扁平 `entries`、`expanded`、目录状态与 `onToggle`/`onOpen`/`rowTriggerProps`，并带 `accessory` 子 slot；`files` tab 自身仍绑定 Session `workspaceFiles` Remote | 文件树渲染可直接复用；多 Location 由调用方提供 entries 或挂载多棵树，属于 Reuse。数据通道仍由 Locus 提供 |
| `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` | 浏览器半边注册 tab 类型与 `ctx.documentPreviews` 扩展注册表；未导出独立预览组件 | 通过扩展点可复用渲染器，需 DSH client 插件，属于 Extend |
| `@deepseek-ai/dsh-client-ui-context-menu` | 0.2.2 安装树中提供 browser client 插件与 `ContextMenuTriggerProps` 等类型；没有独立宿主服务 | Extend，只能在 DSH client 内使用 |
| `@deepseek-ai/dsh-client-ui-open-in-app` | 浏览器插件，注册按路径打开的动作 slot；未导出独立组件 | Adapt，只能在 DSH client 内使用 |
| `@deepseek-ai/dsh-host-directory-picker` | Host 服务 `ctx.directoryPicker`，提供 `native` 与 `browse` 两种能力；`browse` 支持单层列举与新建目录 | Host 侧 Reuse；接入 loopback UI 需要薄适配端点 |
| `@deepseek-ai/dsh-client-modules` | 扫描带 `dsh.client` 的 Loader 行，组合 `window.__DSH_BOOT__` 入口图，并通过 `/plugins/<id>/client.js` 提供 browser 模块 | Reuse/Adapt：外部包可在 profile 中注册 client 模块，不需要重建 DSH web dist |
| `@deepseek-ai/dsh-fs` | `ctx.fs` 面向 Agent/Execution World 与沙箱，不是 Host GUI 浏览能力 | 不用于本机文件浏览，避免把执行环境语义混入 GUI |
| 第三方 explorer 插件 | 未安装、未逐项审查许可证、DSH 版本兼容与路径绑定 | 仅作为候选，不成为依赖 |

结论：`sidebar.files.tree` 在 `0.2.2-rc.1` 已可作为原生文件树复用，方向材料的假设成立。首个原生表面切片曾交付 `dsh.client` tab 与 `/locus/api` 只读投影，后续已移除；历史记录见 [DSH Web 原生文件表面](../../archived/feature/2026-11-13-dsh-native-surface.md)。现有 `locus` profile 与 loopback UI 不自动获得这些能力。

## API v0 边界

| 能力 | 当前入口 |
| --- | --- |
| 位置列举、登记、取消 | `locations`、`register`、`unregister` |
| 目录列举（单层） | `discover` |
| 状态与类型观察 | `inspect` |
| 有界 UTF-8 读取 | `read` |
| 新建文件、单层目录 | `createFile`、`createDirectory` |
| 同位置重命名 | `rename` |

未实现：内容写入、复制、移动、删除、递归创建、覆盖式新建/重命名、搜索、文件监听、回收站、浏览状态持久化、预览与 Git。资源身份仍沿用主机限定命名空间与 file URL 引用；改为 `locationId + relativePath` 需要独立的持久数据迁移决定，本轮不改变已存关系。不引入 Mount、Provider Registry、Composite VFS 或远程文件系统。

## 测试

升级后 `pnpm build`、`pnpm test` 57 项、`pnpm e2e`（13 个真实 DSH 进程）与 `pnpm docs:check` 全部通过；`dsh --profile locus version` 在 `0.2.2-rc.1` 返回 `0.0.0`。新增覆盖：新建文件与目录、单层导航、位置外路径、位置根、跨 Workspace 位置、符号链接父路径不创建、冲突不覆盖、重命名文件/目录、缺失源、缺失目标父目录、Windows 大小写同文件处理、原生写权限拒绝且不留部分结果。测试使用真实临时目录、链接、SQLite 与原生权限。

## 备选方案

**在现有 loopback UI 中复用 FileTree Factory。** Factory 属于 DSH browser client，只能由 `dsh.client` 模块在 DSH Web 运行时调用；现有 loopback 页面不加载该运行时。要复用必须新增 client 包与含 web-app 的 profile，而不是在页面里复制组件。本轮未迁移，因为 UI 形态（保留 loopback、迁到 DSH Web 或并行）尚未决定。

**自行实现文件树。** `0.2.2-rc.1` 已提供受控 Factory，重复实现会违背 Native First，并增加交互与无障碍维护面。

**直接依赖第三方 explorer 插件。** 候选插件面向单 DSH 工作区根，Host 路径绑定、许可证与版本兼容尚未审查；核心依赖会让 Locus 的位置、权限与长期关系受第三方实现支配。保留为研究材料，不进入依赖。

**用 `ctx.fs` 作为本机浏览后端。** `ctx.fs` 面向 Agent 执行环境与沙箱，GUI 浏览需要 Host 本机文件语义；混用会让同机不同执行环境的可见范围意外影响界面。

**建立通用 VFS / Provider Registry。** 当前只有本机后端与真实需求，提前抽象会把远程、挂载与权限模型冻结在缺乏证据的形态上。

**新建与重命名允许隐式覆盖。** 覆盖是破坏性操作，UI/CLI 尚无确认交互；默认拒绝并在未来以显式选项引入，比事后收紧更安全。

## 后果

收益：Filesystem 从只读观察推进到可新建与重命名的本机操作闭环；失败可按 `code` 稳定映射；路径与链接防护规则有真实测试；DSH 复用边界从假设变成有包证据的审计结论；宿主升级后 57 项测试与真实 profile 验收仍通过。

代价：写入尚无内容、覆盖、复制、移动、删除与递归创建；CLI/UI 尚未暴露新用例；每次操作独立，不是事务；资源身份仍是地址引用，位置迁移后的长期关系语义未改善；DSH 原生多 Location 树与预览已交付首切片，但右键菜单、Directory Picker、写入与搜索仍未接入，loopback UI 与 DSH Web 暂时并存。
