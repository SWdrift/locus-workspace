# 决策记录：Locus 与 DSH 集成的实践复盘

Status: implemented
Archived: 2026-11-13

## 问题

目标是同时得到两个相互冲突的结果：

- Locus 保留独立 Main Panel、左侧菜单、URL、页面 tabs 与 Workspace 管理。
- 会话区、header、tabs、右侧栏与文件预览使用 DSH 原生 UI/UX，而不是复制。

实际尝试多次后，需求在“独立页面”“嵌入 Session”“原生 view”“复刻 header”“只保留右侧文件资源管理器”之间反复切换，代码与文档一度同时存在多套互相替代的方案。

## 决定

当前代码收敛为“Locus 工作区 + 位置文件窗格”：

- 注册 `main` 的 `locus` 面板、`sidebar.panellist`、Session header 入口与 Hash 路由。
- Locus 页面不嵌入 Session，不显示 Chat/Trajectory；header 为 `Locus` + `DSH` 返回 chip，tabs 为概览/工作区。
- 文件不是独立 tab 或全局 rightbar：概览位置行与工作区管理的「文件」动作在页面右侧展开该位置的文件树（DSH 原生 `sidebar.files.tree`）。
- 不修改 DSH `ui-sidebar-right`，不再提供 `pnpm patch:dsh`；文件树引用公开的 `sidebar.files.tree` Factory。
- 工作区管理、位置、association 与 Host API 保留。

## 失败点

1. **目标本身没有单一契约**：独立 Locus 页面与原生 Conversation UI 在 DSH 的 single-slot 模型下不能同时直接复用；两者只能通过 DSH 上游 surface API 或复制 UI 解决。
2. **反复改架构**：先做嵌入 Session，再改原生 view，再恢复独立页面；每次都能局部工作，但没有一次同时满足全部目标。
3. **自绘与原生混用**：Locus header、tabs、文件面板、文本预览都曾自绘，后又被要求原生；产生大量死代码与重复实现。
4. **依赖内部补丁**：rightbar 补丁只有两处判断，但依赖 DSH 内部实现与版本；升级需重新打补丁，不是稳定公开契约。该补丁已回滚并删除。
5. **边界没有提前冻结**：没有先固定“哪些 UI 必须原生、哪些可由 Locus 拥有”，导致代码和文档反复迁移。
6. **把文件当成独立功能**：先做独立文件 tab，再做全局 rightbar，位置与文件割裂；正确边界是“位置展开文件”，不是另一套导航。

## 保留的能力

- Locus Core/Application/Filesystem、Workspace 创建/改名、位置、association。
- 自动把 DSH 工作区文件夹登记为 Locus 位置。
- 独立 Locus 页面、左侧菜单、Session header 入口、URL。
- 位置文件窗格：逐层目录树（DSH 原生 `sidebar.files.tree`），不打开文件。
- 工作区管理页面。

## 建议的下一步

- 先把 Workspace 位置、关联与文件展开做稳，不再增加独立文件页面或全局 rightbar。
- 若仍需要完全原生 Session UI：在 DSH 上游增加可复用 `ConversationSurface`，而不是继续补 slot 或复制组件。
- 文件窗格保持只读；搜索、右键菜单、写入与监听在出现真实需求后再加。
- 不把 DSH 内部补丁当作长期公开 API。

## 测试

`pnpm build`、`pnpm test`、`pnpm docs:check` 通过。真实 Chromium 验证：独立 Locus 菜单、`Locus`/`DSH` 切换、概览/工作区 tabs、位置点击打开右侧 DSH 原生文件树、关闭窗格；控制台无错误。

## 备选方案

**继续自绘 Session header/tabs/file preview。** 能快速接近截图，但用户已明确要求原生组件；自绘不满足目标，且维护两套 UI。

**把 Locus 改成原生 Conversation View。** UI 全原生，但失去独立 Locus 菜单、URL 与页面；用户明确不接受。

**移植完整原生 UI。** 约 80k 产线 TS/TSX 加大依赖；不是当前可接受的维护成本。

**篡改 panel id / slot 所有权或补丁 rightbar。** 全局副作用大，且无法稳定获得 Session view/store；已实测 slot 冲突或插件激活失败，补丁也已移除。

## 后果

收益：Locus 只有一个文件入口，围绕 Workspace 位置组织；移除 DSH 补丁和版本耦合；保留独立入口与 Workspace 管理。

代价：Locus header/tabs 是 Locus 自有 UI，文件窗格容器由 Locus 提供；文件当前只读，未做搜索、右键菜单、打开文件与写入。
