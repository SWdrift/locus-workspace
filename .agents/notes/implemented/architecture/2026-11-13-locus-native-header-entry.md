# 决策记录：独立 Locus 页面与原生 Rightbar

Status: implemented

## 问题

Locus 需要保留独立 Main Panel、左侧菜单、URL 与页面导航；同时右侧必须使用 DSH 原生 rightbar、文件树和 Document Preview。原先将 Locus 注册为独立 `main` 面板会让原生 rightbar 卸载，文件无法打开；把 Locus 改成原生 Conversation View 又会丢失 Locus 的独立入口与页面。

## 决定

- **保留独立 Locus Main Panel**：注册 `main` keyed slot 的 `locus` 与 `sidebar.panellist` 左侧入口；Session header 通过 `conversation.session.header.actions` 提供入口。不建立独立服务或第二套运行时。
- **Header**：标题为 `Locus`，旁边是 `DSH` 返回 chip；tab 行为「概览 / 文件 / 工作区」。Locus 页面不嵌入 Session，不显示 Chat/Trajectory。右侧只保留右侧栏/文件资源管理器按钮。
- **Locus 页面**：`#/locus` 默认工作区管理，`#/locus/workspaces`、`#/locus/workspaces/:id` 与 `/files` 保留；Hash 与 `ctx.layout.selectPanel` 双向同步。页面不嵌入 Session，Chat/Trajectory 留在原生 Conversation。
- **原生 rightbar 补丁**：DSH 0.2.2-rc.1 的 `ui-sidebar-right` 将 rightbar 可见性与 on-screen Session 限定为 `activePanelId === null`。补丁把两处判断扩展为 `activePanelId === null || activePanelId === 'locus'`。这样 Locus 主面板激活时，原生 rightbar、guide、Files 与 Document Preview 保持挂载。
- **不改注册/卸载**：补丁不修改 slot 注册、`main`/`conversation.*` single slot、layout 或 Session store；只改 sidebar-right 的可见性/on-screen 门控。
- **Workspace 关联**：DSH 工作区以文件夹为核心。建立关联时 browser 提交 `dshWorkspacePath`；Host 在写入 Core `association` 后自动登记该绝对路径为 Locus 位置。解除关联不删除位置；仍可手动添加其他文件夹。

## 补丁脚本

`scripts/patch-dsh-rightbar.mjs`：

- 只匹配 `@deepseek-ai/dsh-client-ui-sidebar-right@0.2.2-rc.1`。
- 源码结构不匹配时拒绝修改。
- 首次修改前备份 `.locus-rightbar.bak`。
- `--revert` 恢复。
- 升级 DSH 后必须重新执行；`pnpm patch:dsh`。

影响面仅 `locus` 面板；其他 global panel 仍隐藏 rightbar。

## 测试

`pnpm build`、`pnpm test` 64 项与 `pnpm docs:check` 通过。真实 Chromium（`locus-web`）验证：

- Locus 左侧菜单、Session header 入口、独立页面与 URL。
- Header 显示 `Locus` + `DSH` 返回 chip；tabs 为概览/文件/工作区，无 Chat/Trajectory。
- 分栏按钮打开原生 rightbar：guide、Workspace files、AGENTS.md Document Preview。
- 原生 rightbar 在 Locus 页面可见，Plugins 等其他面板不受影响；控制台无错误。

E2E 未重新运行：套件处于冷却；上一次为 PASS（13 个独立 DSH 进程）。

## 备选方案

**把 Locus 做成原生 Conversation View。** UI 全原生，但丢失独立菜单、header、URL 与页面，用户不接受。

**在 Locus 主面板里挂载 `rightbar.session` / `conversation.session`。** single slot 不属于该 entry，`renderSlot` 被拒绝；声明 children 会导致 sidebar-right/Conversation 插件激活失败。

**移植完整原生 rightbar/preview UI。** 约 15k 产线 TS 加依赖，维护成本高；两行门控补丁已能达到原生 rightbar。

**iframe 第二套 DSH。** 保留页面但引入第二运行时、认证与状态同步，不采用。

## 后果

收益：保留独立 Locus 主面板/菜单/URL；header/tab 行接近原生 Session；右侧栏、文件树、Document Preview 为真实原生组件；补丁范围小。

代价：rightbar 补丁依赖 DSH 内部结构，升级需同步；Locus header 是复刻而非直接复用原生组件；Locus 页面入口位于 `Locus ▾` 菜单而非原生 tab。
