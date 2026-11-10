# 决策记录：Application Composition 与 Workspace UI

Status: implemented

## 问题

`workspace overview` 原先在 `plugins/cli` 内组合七个领域的公开用例，CLI 同时拥有跨领域事实解释、确认/观察/建议区分和文本渲染。第二个消费端（UI）若复制这些解释，就会产生两套关系与未知状态语义；若直接解析 CLI 文本，则违背领域所有权。

Operation Catalog 已让领域操作可被程序化发现和调用，但还没有验证：同一跨领域应用用例能否由 CLI 与真实 UI 共同消费，且 UI 不重建 Core、不复制领域实现。浏览器也不能直接访问 DSH 进程内 TypeScript 服务，需要明确的传输边界。

## 决定

### 共享 Application Composition

新增 `@locus/application`，当前只有一个用例 `buildWorkspaceOverview(services, workspaceId, options)`。它组合 Workspace、Filesystem、Git、Session、Remote Machine、Connectivity 与 Gitea 的公开服务，返回结构化 Overview；不依赖 CLI、Commander、React、Cordis 或宿主外壳，不保存派生事实，不自动确认候选关系。

CLI 的跨领域组合迁出到该包；`plugins/cli/src/overview-text.ts` 只保留人类文本投影。`workspace overview` 的命令语法、`--json` 结构、退出码与观察策略保持不变。`actions` 与 `next` 仍是 CLI 命令提示字符串，为兼容既有 JSON 保留；UI 不把它们作为数据来源或执行入口。

### 本地 UI 传输

新增 `@locus/ui` DSH Plugin，导出 `createLocusUiServer` 并提供 `locusUi` 服务。它只在显式 `ui` 命令下监听，默认 `127.0.0.1:4310`，拒绝非 loopback host，随 fiber 卸载关闭。

HTTP 层只做传输与静态资源：`GET /api/workspaces`、`GET /api/workspaces/:id/overview?observe=`、`GET /api/operations`、`GET /api/operations/:id/availability`、`POST /api/operations/:id/invoke`。每次请求从当前 Context 读取领域服务，因此插件热替换不需要重建传输层。服务不读取 SQLite，不启动 CLI 子进程，不创建第二套业务运行时。

安全边界：每个服务实例生成随机会话令牌并注入 `index.html`；所有 API 要求 `x-locus-ui-token`、`x-locus-ui: 1`，有 `Origin` 时只接受当前 loopback 来源；不使用 CORS 作为唯一防线。JSON 体上限 64 KiB，只允许 GET/POST，静态路径拒绝越界。`requiresConfirmation` 的操作必须携带 `confirm: true`；UI 显示外部环境提示。API 不返回身份文件、known_hosts、SSH 配置路径、Token、私钥或原始 stderr。

### React Workspace UI

浏览器端是 React 18 + Vite + TypeScript 应用，纯组件不依赖 Cordis Runtime。组件使用 CSS Modules + `clsx`，主题只读取 `--dsw-*` 变量，提供 light/dark 值；不引入 Tailwind、Ant Design 或其他组件库，也不直接导入其他功能插件的 UI 组件。共享能力收敛在 `web/src/primitives`：`StateBadge`、`Panel`、`DisclosureRow`、`DefinitionList`、`CodeBlock`、`Loading`、`ErrorPanel`、`EmptyState`。领域展示组件只组合 primitives。

已实现两个真实视图：Workspace List 与 Workspace Overview。Overview 显示 Workspace 基本信息、已确认成员/关联、Filesystem、Git、Gitea、Session、Remote Machine、Connectivity、未确认建议、其他长期关系、attention、来源与观察时间；支持手动刷新与显式只读观察。长驻事实与本次观察、确认关系与建议、不可用与未知分别展示。刷新失败保留已有 Overview 并显示错误条；单一来源失败只影响对应段落。

操作面板实际消费 Operation Catalog：读取 Definition、Schema、能力依赖、前置条件、效果与 Availability，通过 API 调用当前 Provider，并以 `ok/value` 与 `ok:false/error` 分别展示领域 Outcome 与调用错误。UI 不复制领域参数校验或业务判定。本轮没有实现通用 Query/State/Subscription 原语、自动表单引擎、CRUD 页面或自动领域组合。

### 组件与主题边界

当前只有一个 Locus 前端插件，因此没有引入跨插件 UI 导入或 Slot 注册运行时。领域 UI 组件与 primitive 的边界已经建立：未来新增 domain UI 时，应通过共享 primitives 和 Slot/注册点组合，而不是直接 import 其他功能插件的组件。`--dsw-*` 变量是当前唯一主题接口；未安装 DSH 官方 primitives 包，因此本轮按官方 token 语义实现最小 primitives，而不是复制其内部实现或引入第二套设计系统。

## 备选方案

**继续使用 CLI 内的 `overview.ts`，UI 通过 API 调用 CLI。** 会保留单一组合实现，但 UI 依赖 CLI 或解析文本，违背应用平级目标；CLI 也应只负责投影。改为独立 `@locus/application`。

**让 UI 直接连接 DSH/Cordis 客户端运行时。** 可以复用官方 UI 与 Slot 机制，但当前 Locus UI 是独立页面，没有 DSH Web shell 的模块加载与连接协议；直接引入会把 UI 绑到未交付的客户端运行时。先建立薄 loopback HTTP，避免复制领域编排。

**新增独立 Web Server 或第二个 Node 进程。** 会形成第二套业务运行时、配置与生命周期。UI 传输层放在现有 DSH Plugin 内，复用 Core、领域服务、Catalog 与持久化。

**启动 CLI 子进程或读取 SQLite 供 UI 使用。** 会绕过领域服务、能力选择与授权，并把内部存储当接口。拒绝。

**在 UI 中复制跨领域组合或状态解释。** CLI 与 UI 会逐渐分叉；Overview 必须只有一个应用用例。UI 只渲染结果。

**使用 Vue 3 或纯静态 JS。** 首版曾以无构建静态 ES Modules 验证流程，后按约束改为 React；Vue 没有现有基础，且 DSH UI 方向是 React。选择 React 18 + Vite + CSS Modules + clsx，避免引入组件库与状态框架。

**直接引入 DSH `dsh-client-ui-primitives` 包。** 当前 workspace 未安装该共享包，且它绑定 DSH client module loader；直接依赖会把独立 UI 与宿主客户端打包协议耦合。先按 `--dsw-*` token 与相同语义实现本地 primitives，未来出现真实复用条件再迁移。

**为所有领域建立 Query/Entity/View 契约。** 只有 Overview 与两个 Operation 有真实消费者；提前抽象会让领域填充占位结构。保留领域专有 API，按后续 UI 需求逐项提炼。

## 后果

收益：跨领域解释只实现一次；CLI 与 UI 消费同一 Overview 与同一 Operation Catalog；UI 不依赖 CLI 文本、不重建 Core；领域仍拥有自己的类型、状态、执行与持久化；传输层可随 UI 需求独立演进。

代价与限制：Overview 的 `actions`/`next` 仍是 CLI 提示，尚未提炼为应用级动作模型；UI 通过手写展示映射消费结构化结果，没有自动表单/视图生成；静态构建产物不提交，运行前必须执行 `pnpm build`；会话令牌随服务实例变化，服务重启后旧页面需刷新；没有通用 Query/State/失效/订阅机制，也没有跨插件 Slot 注册运行时；UI 只读，不提供 Workspace CRUD、机器编辑或 Gitea 管理。

若出现第二个前端插件或更多领域视图，应优先提炼 Slot/primitives 注册边界与 Query/State 契约；只有真实重复出现时才升级为公共契约。

## 测试

- `pnpm build`：TypeScript、浏览器端类型检查与 Vite 构建通过（48 modules）。
- `pnpm test`：78 项全部通过，包含 Application Composition 用例、UI token/Origin/静态路径/API/Operation 确认与调用、CLI 回归。
- `pnpm verify:full`：通过；`test:all` 110 项中 109 通过、1 项既有特殊文件用例跳过；`docs:check` 通过 51 个 Markdown 文件；profile smoke 通过 62 个独立 DSH 进程，覆盖 contract/UI 插件装配、CLI 行为、插件停用与跨进程恢复。
- 真实浏览器（Chromium）验证：Workspace List → Overview；显式只读观察刷新；`machine.observe` 经 Operation Catalog 调用并返回 `unreachable` 领域 Outcome；禁用领域插件时展示 `unavailable` 与“提供方未加载”；停止 UI 服务后刷新保留已有 Overview 并显示错误条。
- 真实 SSH 成功路径未新增测试；操作使用 loopback 关闭端口验证领域失败结果，不修改远端状态。UI 未做自动化视觉回归；截图证据保存在临时目录，不作为仓库夹具。

## 关联

[领域生成、操作契约与应用投影提案](../../proposed/architecture/2026-11-09-domain-generation.md)、[领域生成与应用投影](../../../../docs/domain-generation.md)、[项目架构](../../../../docs/architecture.md)、[Application](../../../../packages/application/README.md)、[UI 模块](../../../../plugins/ui/README.md)、[CLI 模块](../../../../plugins/cli/README.md)、[Workspace Overview 决定](../feature/2026-11-09-workspace-overview.md)。
