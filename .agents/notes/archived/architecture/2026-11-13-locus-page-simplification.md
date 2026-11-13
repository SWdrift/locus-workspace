# 决策记录：Locus 页面简化与文件并入 Workspace

Status: implemented
Archived: 2026-11-13

## 问题

前一版同时维护了独立「文件」tab、全局文件树按钮、原生 rightbar 补丁和位置点击/文件浏览两套路径。实际需求是专心建设工作区：文件不是独立功能，而是某个 Workspace 位置的展开结果。

继续保留独立文件 tab 会带来：

- Locus 页面出现两套入口（tab 与 rightbar），用户需要先理解入口差异。
- 原生 rightbar 需要修改 DSH 安装文件，版本升级后必须重新打补丁。
- 文件页与 Workspace 位置管理割裂，位置只是配置，不能直接展开内容。

## 决定

- Header 只保留 `概览 / 工作区`；删除独立「文件」tab、`/files` 路由与全局文件树按钮。
- 删除 DSH `ui-sidebar-right` 补丁与 `pnpm patch:dsh`，不再依赖原生 rightbar；文件树改用公开的 `sidebar.files.tree` Factory。
- 工作区管理左侧为 Workspace/位置父子树；位置移除在树中完成，中央详情只保留改名与添加位置。
- 点击树中的 Workspace 或位置，在同一 Locus 页面右侧打开对应位置的文件窗格：逐层目录树，使用 DSH 原生 `sidebar.files.tree` 渲染。
- 文件窗格只读；关闭不解除位置，也不改变 Workspace。
- Host 保留 `/locus/api/list`，仍由 Filesystem 执行越界、符号链接和错误边界。

## 备选方案

**继续使用 DSH 原生 rightbar。** 视觉更原生，但需要改 DSH 内部门控，且文件入口与 Workspace 位置分离；与“专心建设工作区”冲突。

**把文件做成独立页面。** 入口清晰，但位置与文件仍割裂，且多一套导航状态。

**点击位置直接打开 DSH 原生 Files tab。** 该 tab 绑定 Session 工作区根，不是 Locus 多位置模型；仍需补丁或复制。

## 后果

收益：Locus 只有一个文件入口，围绕 Workspace 位置组织；移除 DSH 补丁和版本耦合；文件仍可逐层浏览。

代价：文件窗格是 Locus 的位置容器，文件树来自 DSH；当前只读，未做搜索、右键菜单、打开文件与写入。
