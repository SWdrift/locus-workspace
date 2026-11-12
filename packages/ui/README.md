# @locus/ui

## 简述与职责

核心交互包：现有 DSH 宿主内的 loopback HTTP、JSON API 与 React 页面。页面调用 `@locus/application` 的 Workspace/Filesystem 用例，与 CLI 共用同一套底层实现；不拥有领域语义、不复制业务规则，也不创建第二套数据库或运行时。

## 装配与启动

按[开发与验证](../../docs/development.md#宿主运行)把本包链接进 `locus` profile、合入插件行并执行 `pnpm build` 构建浏览器端，然后执行：

```sh
pnpm exec dsh --profile locus ui
```

默认监听 `http://127.0.0.1:4310/`，只绑定 loopback，不自动打开浏览器；`--port <port>` 可改端口。服务只在显式 `ui` 命令下启动，关闭进程不删除任何长期关系与配置。

## DSH UI 框架

`web/src/dsh/` 摘抄自 DSH master 的 `packages/client/ui-theme` 与 `ui-primitives`（MIT）；目标宿主为 `0.2.1-rc.5`：

- `theme/`：八张 `--dsw-*` token 与全局样式表（base、design-platform、gradient-shadow-text、corner-shape、focus、scrollbar、onboarding、shiki），原样保留；
- `primitives/`：当前页面使用的 `Button`、`Input`、`Tag` 与 CSS Modules。

页面只使用语义 token（`--dsw-alias-*`），按 DSH 圆角规范选择 `--dsw-radius-*`，不写死颜色；发丝线统一 0.5px，卡片使用 settings-card 材质。未见真实需求前不摘抄依赖 shiki/katex/simple-icons 的 Markdown、终端与文件类型组件。来源与边界见 [`web/src/dsh/README.md`](web/src/dsh/README.md)。

## 页面与 API

页面提供 Workspace 创建、改名、关系查看/解除、位置登记/取消、单层浏览、文件读取与显式确认。所有操作直接调用共享用例；浏览器不解析 CLI 输出。

| 接口 | 行为 |
| --- | --- |
| `GET /api/health` | 版本与 Filesystem 可用性 |
| `GET /api/workspaces` | 列举 Workspace |
| `POST /api/workspaces` | 创建 Workspace |
| `GET /api/workspaces/:id` | Workspace、关系与位置 |
| `POST /api/workspaces/:id/rename` | 改名 |
| `POST /api/workspaces/:id/relations` | 显式保存关系 |
| `DELETE /api/workspaces/:id/relations/:relationId` | 解除关系 |
| `GET/POST /api/workspaces/:id/locations` | 列举/登记位置 |
| `DELETE /api/workspaces/:id/locations/:locationId` | 取消位置登记 |
| `GET .../locations/:locationId/discover` | 单层发现 |
| `GET .../locations/:locationId/read` | 有界读取 |
| `POST .../locations/:locationId/confirm` | 确认观察结果为长期关系 |

## 安全与限制

- 页面内嵌每次启动生成的会话令牌，API 要求 `x-locus-ui-token` 请求头；存在 `Origin` 时只接受本机同源。静态 HTML 使用 CSP，页面不使用内联脚本。
- 只监听 loopback，不接受外部地址；不展示身份文件、Token 或私钥。
- 页面是 React 18 + Vite + TypeScript + CSS Modules 的浏览器应用，源码在 `web/`；修改后执行 `pnpm --filter @locus/ui build:web` 再刷新。API 不提供跨域、订阅、写文件或执行能力。
- UI 与 CLI 的能力差异只属于交互投影；新增业务语义应先进入共享用例或领域服务，不在页面手写。

## 验证

`pnpm test:all` 启动真实 loopback 服务器，覆盖令牌/来源检查、静态页面、Workspace 创建、位置登记、发现、读取、确认与错误消息；验证入口见[测试系统](../../docs/testing.md#分层与入口)。
