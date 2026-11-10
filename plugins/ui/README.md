# @locus/ui

## 简述与职责

现有 DSH/Cordis 宿主内的本地应用传输适配层。它提供 loopback HTTP、React Workspace UI、Workspace/Overview/Operation JSON API，并把请求交给 `@locus/application` 与 `locusOperations`。它不拥有领域语义，不读取或复制领域数据库，不启动第二套业务运行时。

浏览器端是纯 React 18 应用，不依赖 Cordis Runtime；组件使用 CSS Modules + `clsx`，主题只读取 `--dsw-*` 变量，不引入 Tailwind、组件库或第二套设计系统。UI 内部通过 `src/primitives` 共享 `StateBadge`、`Panel`、`DisclosureRow`、`CodeBlock` 等基础组件，领域展示组件只组合这些 primitives，不导入其他功能插件的 UI 组件。

UI 与 CLI 平级：两者调用同一 `buildWorkspaceOverview` 与同一 Operation Catalog；UI 不解析 CLI 输出。

## 启用

按[开发与验证](../../docs/development.md#本地-ui)设置 `DSH_HOME`，然后：

```sh
pnpm ui
# 或
pnpm exec dsh --profile locus ui --port 4310
```

默认监听 `127.0.0.1:4310`，不自动打开浏览器；Ctrl+C 停止。服务随 DSH fiber 卸载关闭。UI 只在显式 `ui` 命令下启动，普通 CLI 命令不会留下常驻监听。修改 `web/src` 后运行 `pnpm --filter @locus/ui build`（或根 `pnpm build`）生成 `web/dist`，再刷新页面；静态产物不提交，生产启动前必须已构建。

## API

所有 `/api/*` 请求必须带页面内嵌的 `x-locus-ui-token` 与 `x-locus-ui: 1`；有 `Origin` 时只接受当前 loopback 来源。

| 请求 | 行为 |
| --- | --- |
| `GET /api/health` | 产品版本与当前时间；不读取领域数据 |
| `GET /api/workspaces` | Core 长期 Workspace 列表 |
| `GET /api/workspaces/:id/overview?observe=0\|1` | 调用共享 Overview 应用用例；`observe=1` 才执行有界只读观察 |
| `GET /api/operations` | Operation Definition 列表，含 Schema、能力依赖、前置条件、效果、Outcome 与确认要求 |
| `GET /api/operations/:id/availability?workspaceId=` | Provider 自报可用性与能力选择状态 |
| `POST /api/operations/:id/invoke` | 调用 Catalog；body 为 `{ input, workspaceId?, confirm? }`，`requiresConfirmation` 时必须 `confirm: true` |

API 返回结构化领域结果；领域不利结果仍是 `ok: true` 的 `value`，调用错误在 `ok: false` 的 `error` 中。传输错误使用 HTTP 状态与 `{ error: { code, message } }`。

## 安全与限制

- 只绑定 loopback；`host` 不接受非 loopback 地址。
- 每个服务实例生成随机会话令牌，`index.html` 下发；跨站页面无法读取。另检查自定义头与 `Origin`，不使用 CORS 作为唯一防线。
- JSON 请求体上限 64 KiB；只允许 GET/POST；不使用 `..` 越出静态根。
- 不返回身份文件、known_hosts、SSH 配置路径、Token、私钥或原始 stderr。UI 原生入口只来自领域公开结果；本轮不自行构造 SSH 命令。
- `machine.observe` 与 `connect.verify` 访问外部环境，`requiresConfirmation: true`，UI 要求显式勾选。
- React/Vite 只用于构建浏览器端；运行时仍由现有 DSH 宿主提供 API。UI 不直接导入 Cordis、DSH 服务或后端领域实现，所有数据经 loopback JSON API。
- 未实现通用 Query/State/Invalidation/Subscription、CRUD 页面、自动表单引擎或多语言；这些不是本轮承诺。

## 验证

`pnpm test` 覆盖 loopback 令牌、来源校验、静态路径、Workspace/Overview API、Operation 调用与确认要求；应用用例测试见 [Application](../../packages/application/README.md)。真实 profile 下的列表、Overview、观察刷新、操作调用、部分不可用与传输错误用本地浏览器检查，限制与证据见 [Application Composition 与 UI 决定](../../.agents/notes/implemented/architecture/2026-11-09-application-composition-ui.md#测试)。验证入口见[测试系统](../../docs/testing.md#分层与入口)。
