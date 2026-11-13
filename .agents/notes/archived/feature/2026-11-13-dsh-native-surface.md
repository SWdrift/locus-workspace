# 决策记录：DSH Web 原生文件表面

Status: implemented
Archived: 2026-11-13

## 问题

宿主升级到 `0.2.2-rc.1` 后，DSH 提供了受控的 `sidebar.files.tree` Factory、动态 client 模块加载与原生 Document Preview。Locus 已有 loopback 页面与 Filesystem 只读/写入契约，但 loopback 页面无法使用 DSH slot；方向材料要求 Native First，不重复实现文件树与预览器。需要决定交付形态、Host 数据通道与首个可验证切片。

## 决定

新增 dual-face 包 `@locus/dsh-surface`：

- Host 半边在 `ctx.webServer` 注册 `/locus/api`，把 `WorkspaceApplication` 的位置与单层发现投影为 JSON，并允许位置登记/取消；不写文件内容、不缓存观察。
- Browser 半边声明 `dsh.client`，注册 `locus-files` 右侧栏类型与 `sidebar.right.pane.tab` body；每个 Location 渲染一棵原生 `sidebar.files.tree`，展开时才请求下一层。
- 文件打开使用 `dsh-resource://file/session/<sessionId>/<absolutePath>` 地址，交给 DSH 原生 Document Preview；不实现自有预览器。
- 允许的入口是含 `@deepseek-ai/dsh-web-app` 的 `locus-web` profile；现有 `locus` CLI profile 不装载本插件，loopback UI 继续存在但不承载原生表面。

`locus-web` 由 shipped `web` profile 模板复制，加入 `@locus/host-dsh`、`@locus/filesystem`、`@locus/dsh-surface` 链接与三行 patch；`dsh --profile locus-web --no-open --port <port>` 启动，不需要 `web` 位置参数。

## Host 数据通道

选择 Web 服务器的同源 HTTP 路由，而不是 Typert Remote namespace。HTTP 路由可以直接复用现有 `createWorkspaceApplication` 与 `FilesystemFailure`，不需要引入 decorator、schema 与 Client Remote 装配。`/locus/api` 只接受 loopback，存在 `Origin` 时要求与 `Host` 同源，并要求页面注入的 `x-locus-api-token`；只提供观察与位置配置写，不发送 CORS 头。若后续需要文件内容写、订阅或类型化流，再评估 Typert Remote 替换，而不在 HTTP 上叠加通用 RPC。

## 安全边界

API 返回已登记位置的绝对路径、条目名与状态；不返回未登记目录，不跟随链接，不越过位置根。路径解析、位置范围与符号链接防护仍由 Filesystem 服务执行；Host 只投影结果。登记/取消位置只修改 Filesystem 配置，不删除文件或 Core 关系。跨 Workspace 的 Location id 返回 404。文件读取由 DSH 的 `workspaceFiles` 与 Document Preview 按其既有授权处理，不使用 Locus Host API 传文件内容。

## 测试

`node --test packages/dsh-surface/test/surface.test.mjs` 5 项通过：真实 HTTP 投影与逐层条目；越界、跨 Workspace、令牌、非 JSON、非 GET/POST 与跨源拒绝；位置登记/取消；Directory Picker 能力；令牌注入。`pnpm test` 62 项通过。真实 DSH Web（`locus-web` profile，Chromium）已验证：guide 中出现 Locus 入口、两个 Location 独立成树、目录惰性展开、`AGENTS.md` 在原生 Document Preview 中渲染；浏览器控制台无错误。

## 暂缓

右键菜单、Directory Picker、添加/取消 Location 的浏览器操作、文件写入/重命名 UI、搜索、监听、预览外的文件操作尚未接入。Locus 现在作为 Session 内的嵌入页面存在，并从 `管理工作区` 提供 Workspace 管理（[Locus 嵌入页面与 Workspace 管理](../architecture/2026-11-13-locus-native-header-entry.md)）；本记录中的右侧栏 tab 与主面板文件浏览已移除。loopback UI 尚未移除，两套 UI 暂时并存，避免在未验证前切断现有入口。

## 备选方案

**继续使用 loopback 页面。** 页面无法访问 DSH slot 与 Factory；要复用原生树只能把页面迁进 DSH Web 运行时。用户已选择原生表面路线。

**自建文件树/预览器。** `0.2.2-rc.1` 已提供受控 Factory 与 Document Preview，重复实现会违背 Native First，并增加交互与无障碍维护面。

**直接复用 `workspaceFiles` 的文件树 tab。** 该 tab 绑定 Session 工作区根，不是多 Location 数据源；只能注册自己的 tab 与 body。

**Typert Remote namespace。** 类型化与流能力更完整，但需要 decorator、schema 与 Client Remote 装配；对当前观察与位置配置写成本高于收益。文件内容写或订阅出现后再替换。

**在 loopback 页面上嵌入 iframe 或复制 DSH 组件。** 前者受同源/令牌与布局限制，后者是复制 UI；都不如注册 client 模块直接。

## 后果

收益：Locus 首次在 DSH Web 中获得原生文件树、原生 tab 与文档预览；多 Location、惰性加载与位置登记/取消可用；Host API 有真实测试；未复制文件树或预览器。

代价：新增一个 profile 与 dual-face 包；loopback UI 与 DSH Web 两套入口并存；Host API 只写位置配置，文件内容写与订阅未接入；右键菜单、搜索、监听与 CRUD UI 未交付；绝对路径会出现在 Web UI；安全模型依赖 loopback + 同源 + 进程令牌，而不是用户会话身份。
