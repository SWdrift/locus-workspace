# @locus/dsh-surface

## 简述与职责

DSH Web 原生表面：同一包提供 Host API 与 browser 模块。Host 半边把 Locus Workspace、位置观察、工作区关联与创建/改名投影为 JSON；browser 半边注册 Locus Main Panel、左侧菜单与 Session header 入口，并复用 DSH 原生 rightbar、文件树和 Document Preview。

不拥有 Workspace、Filesystem 或长期关系数据；不写文件内容、不缓存观察、不解析路径。权限与路径边界仍由 `@locus/filesystem` 执行。

## Host API

注册在 `ctx.webServer` 的 `/locus/api` 前缀下。页面加载时 Host 通过 `tapIndex` 注入进程级 `<meta name="locus-api-token">`；所有请求必须带 `x-locus-api-token`，并接受 loopback 与同源检查。不发送 CORS 头。

| 路径 | 行为 |
| --- | --- |
| `GET /locus/api/capabilities` | 报告 Directory Picker 能力、`apiVersion` 与 `workspaceManagement` |
| `GET /locus/api/locations` | 每个 Workspace 及其位置、创建时间与长期关系数量 |
| `GET /locus/api/list?workspaceId=&locationId=&relativePath=` | 该目录的直接子项、相对路径、状态、类型与截断标记 |
| `GET /locus/api/read?workspaceId=&locationId=&relativePath=` | 读取已登记位置内的 UTF-8 文本（有界） |
| `POST /locus/api/workspaces` | 创建 Workspace |
| `POST /locus/api/workspaces/rename` | 修改 Workspace 名称 |
| `POST /locus/api/locations` | 登记绝对路径 |
| `POST /locus/api/locations/remove` | 取消位置登记 |
| `POST /locus/api/pick-directory` | 调用 Host 原生 Directory Picker |
| `GET /locus/api/associations` | DSH 工作区与 Locus 工作区的关联 |
| `POST /locus/api/associations` | 建立/解除关联；关联时自动登记 `dshWorkspacePath` |

错误沿用 `FilesystemFailure.code`，映射为 400/403/404/500。关联写入 Core `association`，目标 namespace 为 `dsh.workspace`；一个 DSH 工作区最多关联一个 Locus 工作区。

`capabilities` 返回 `apiVersion` 与 `workspaceManagement`。修改 Host 半边后必须重启 DSH；只刷新页面不会加载新端点。

## Browser 半边

- 注册 `main` keyed slot 的 `locus` 面板与 `sidebar.panellist` 左侧入口；保留独立 Locus 页面。
- Session header 的 `conversation.session.header.actions` 提供 Locus 入口。
- Header：`Locus` 标题 + `DSH` 返回 chip；tab 行只保留 Locus 页面：概览 / 文件 / 工作区。右侧只保留右侧栏/文件资源管理器按钮。
- Locus 页面不嵌入 Session，不渲染 Chat/Trajectory；DSH Session 内容留在原生 Conversation。
- `#/locus` 默认工作区管理，`#/locus/workspaces/:id`、`/files` 保留；Hash 与 `ctx.layout.selectPanel` 双向同步。
- 工作区管理内联在 Locus 页面；创建/改名、位置登记/移除、Directory Picker 与关联/解除关联。关联时提交 DSH 工作区路径，Host 自动登记位置。

## 原生 rightbar 补丁

DSH 0.2.2-rc.1 的 `ui-sidebar-right` 把 rightbar 可见性和 on-screen Session 限定在 `activePanelId === null`。Locus 主面板因此会卸载原生 rightbar。

`scripts/patch-dsh-rightbar.mjs` 只把这两个判断扩展为：

```ts
activePanelId === null || activePanelId === 'locus'
```

影响面仅 `locus` 面板：

- 原生 rightbar、guide、Files、Document Preview 在 Locus 页面可用。
- Plugins、Automation tasks 等其他面板行为不变。
- 不改 slot 注册/卸载、layout、Conversation 或 Session store。
- 升级 DSH 后需要重新执行补丁；脚本带版本检查、备份与 `--revert`。

```sh
pnpm patch:dsh
node scripts/patch-dsh-rightbar.mjs --revert
```

## 验证

`node --test packages/dsh-surface/test/surface.test.mjs` 覆盖投影、逐层列举、文件读取、越界、令牌、Workspace 创建/改名、位置登记/取消、Directory Picker 与工作区关联。真实 DSH Web 中已验证：

- Locus 左侧菜单、Session header 入口、独立 Locus header/tabs。
- Header 标题为 Locus，`DSH` chip 可返回会话；tabs 为概览/文件/工作区，无 Chat/Trajectory。
- 原生 rightbar 打开、Workspace files、AGENTS.md Document Preview。
- 控制台无错误。
