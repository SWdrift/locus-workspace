# 决策记录：Locus 与 DSH 集成的实践复盘

Status: implemented

## 问题

目标是同时得到两个相互冲突的结果：

- Locus 保留独立 Main Panel、左侧菜单、URL、页面 tabs 与 Workspace 管理。
- 会话区、header、tabs、右侧栏与文件预览使用 DSH 原生 UI/UX，而不是复制。

实际尝试多次后，需求在“独立页面”“嵌入 Session”“原生 view”“复刻 header”“只保留右侧文件资源管理器”之间反复切换，代码与文档一度同时存在多套互相替代的方案。

## 决定

当前代码停在“独立 Locus 页面 + 原生右侧栏”的折中状态：

- 注册 `main` 的 `locus` 面板、`sidebar.panellist`、Session header 入口与 Hash 路由。
- Locus 页面不嵌入 Session，不显示 Chat/Trajectory；header 为 `Locus` + `DSH` 返回 chip，tabs 为概览/文件/工作区。
- 原生 rightbar 通过 `scripts/patch-dsh-rightbar.mjs` 修改 DSH 0.2.2-rc.1 的 `ui-sidebar-right` 两处门控：
  - `activePanelId === null || activePanelId === 'locus'`
- 这样 Locus 主面板激活时，原生 guide、Files、文件树和 Document Preview 仍可用；文件预览不再自绘。
- 工作区管理、位置、association 与本轮之前的 Host API 保留。

## 失败点

1. **目标本身没有单一契约**：独立 Locus 页面与原生 Conversation UI 在 DSH 的 single-slot 模型下不能同时直接复用；两者只能通过 DSH 上游 surface API 或复制 UI 解决。
2. **反复改架构**：先做嵌入 Session，再改原生 view，再恢复独立页面；每次都能局部工作，但没有一次同时满足全部目标。
3. **自绘与原生混用**：Locus header、tabs、文件面板、文本预览都曾自绘，后又被要求原生；产生大量死代码与重复实现。
4. **依赖内部补丁**：rightbar 补丁只有两处判断，但依赖 DSH 内部实现与版本；升级需重新打补丁，不是稳定公开契约。
5. **边界没有提前冻结**：我们没有先固定“哪些 UI 必须原生、哪些可由 Locus 拥有”，导致代码和文档反复迁移。

## 保留的能力

- Locus Core/Application/Filesystem、Workspace 创建/改名、位置、association。
- 自动把 DSH 工作区文件夹登记为 Locus 位置。
- 独立 Locus 页面、左侧菜单、Session header 入口、URL。
- 原生 rightbar/文件树/Document Preview（通过补丁）。
- 工作区管理页面。

## 建议的下一步

- 若“独立 Locus 页面 + 完全原生 Session UI”仍是硬目标：在 DSH 上游增加可复用 `ConversationSurface` / `rightbar.surface`，停止继续补 slot 与自绘。
- 若接受折中：保留当前独立 Locus（概览/文件/工作区）+ 原生 rightbar，删除未使用的 Session 嵌入、Locus header 复刻与本地文件预览死代码。
- 不再同时维护 native view、独立 main panel 与自绘 header 三套入口。
- 补丁脚本必须与 DSH 版本绑定；升级后重新验证，不把补丁当作长期公开 API。

## 测试

`pnpm build`、`pnpm test` 64 项、`pnpm docs:check` 通过。真实 Chromium 验证：独立 Locus 菜单、`Locus`/`DSH` 切换、概览/文件/工作区、原生 rightbar、Workspace files、AGENTS.md Document Preview、右侧栏拖动宽度；控制台无错误。

## 备选方案

**继续自绘 Session header/tabs/file preview。** 能快速接近截图，但用户已明确要求挂载原生组件；自绘不满足目标，且维护两套 UI。

**把 Locus 改成原生 Conversation View。** UI 全原生，但失去独立 Locus 菜单、URL 与页面；用户明确不接受。

**移植完整原生 UI。** 约 80k 产线 TS/TSX 加大依赖；不是当前可接受的维护成本。

**篡改 panel id / slot 所有权。** 全局副作用大，且无法稳定获得 Session view/store；已实测 slot 冲突或插件激活失败。

## 后果

收益：当前实现可运行，保留 Locus 的独立入口与 Workspace 管理，同时恢复原生 rightbar 与文件预览。

代价：rightbar 依赖 DSH 内部补丁；Locus header/tabs 仍是 Locus 自有结构；代码中保留了未注册的 Session/本地预览死代码；整体方案是折中，不是“完全原生 Session + 独立 Locus”的最终解。
