# @locus/gitea

## 简述与职责

Gitea Capability：登记外部 Gitea 实例，按来源限定仓库身份观察仓库与 Actions Run，并为 Workspace 的显式长期关联提供稳定引用。

Gitea 拥有仓库、Workflow、Run、日志、Artifact、Secret 与权限的原生事实。本 Plugin 只做按需、只读元信息查询，不复制流水线历史，不触发、重跑、取消或修改 CI，也不把 CI 成功解释成部署成功。

## 装配与使用

按[开发与验证](../../docs/development.md#宿主运行)将本包链接到项目内 `locus` profile 并合入插件行。Plugin 注入 `locus`，可选消费 DSH `credentials` 服务，提供 `locusGitea`；Capability 为 `locus.gitea`，提供方 `@locus/gitea`，Tag 仅分类。

`GiteaInstance` 是外部实例访问配置，不是 Machine，也不要求 SSH。Workspace 与 Gitea 仓库的长期关系由 Core 保存；本 Plugin 不复制 Workspace 成员模型。CLI 语法见[命令手册](../../docs/commands.md#workspace-操作)；非终端调用使用 `createGiteaService(locus, options)` 与 [contracts](../../packages/contracts/README.md) 中的局部协议。

## 身份与引用

| 对象 | 身份与所有权 |
| --- | --- |
| Gitea Instance | 本 Plugin 的 UUID；`name` 与 `baseUrl` 可变，Instance ID 不变 |
| Repository | Gitea 实例内数字 `id`；Workspace 引用为 `instanceId:repositoryId` |
| Local Git Repository | Git Plugin 的 Filesystem 路径引用；不因 Remote 相似自动等同 |
| Workflow / Run | Gitea 原生对象；按当前仓库完整名称与 Run ID 查询，不持久化历史 |
| Observation | 指定时间从 Gitea 查询到的事实；不自动成为永久关系 |

Repository 关系命名空间为 `locus.gitea.repository`。数字 ID 让仓库改名后仍能通过 `GET /api/v1/repositories/{id}` 解析当前 `full_name`；仓库迁移、删除、实例删除或权限变化时旧关系保留并报告不可用，不自动删除。

Git Remote 只生成候选。`gitea repo suggest` 只比较已登记实例的 HTTP(S) 或 SSH URL；用户必须再执行 `gitea repo link` 才写入 Workspace 长期关系。同名或相似 URL 不自动合并。

## 实例、凭据与 HTTP

实例只保存：

- `id`、`name`
- `baseUrl`（HTTP/HTTPS 根地址，可含子路径；拒绝 URL 内用户名/密码、查询参数与 fragment）
- 可选凭据名称（POSIX 标识符，例如 `GITEA_TOKEN`）

Token 值不进入实例记录、Workspace 关系、错误、日志或 JSON。解析顺序：

1. DSH `ctx.credentials.resolve(name)`；可用本地凭据存储、环境或 `.env` 层。
2. 直接读取启动环境同名变量作为回退。

请求使用 `Authorization: token …` Header，不把 Token 放进 URL。`redirect: 'manual'`，任何 3xx 都报告 `redirect` 而不跟随，避免跨来源重定向泄露认证。单次请求 10 秒超时，响应上限 1 MiB，只接受 JSON。

失败状态：

- `instance-missing`、`credential-missing`
- `unauthorized`、`forbidden`、`not-found`
- `rate-limited`
- `unsupported`
- `unreachable`、`timeout`
- `redirect`、`invalid-response`、`error`

`type: 'frp'`、Clone URL、仓库网页 URL 和 API URL 都只作为字符串展示或请求目标，不执行、不打开、不拼接 shell 命令。

## 仓库与 Actions

`inspectRepository` / `inspectReference` 返回仓库数字 ID、当前完整名称、默认分支、私有/归档状态、`hasActions` 与网页 URL。不返回 Clone URL、权限矩阵或仓库内容。

Run 查询：

- `runs` 默认每个仓库最近 10 条，最多 100。
- 可按 `branch` 或 `head_sha` 过滤；SHA 必须是 7–64 位十六进制。
- Gitea 1.25.5 的 Actions 列表端点实测会忽略 `limit`，因此客户端强制截断到请求上限。
- `run` 读取单条详情，得到 `started_at`、`completed_at`、工作流路径与提交。
- 列表端点可能不返回时间；时间缺失不伪造。

产品结论与原始字段分开：

| 字段 | 语义 |
| --- | --- |
| `status` | Gitea 原始状态，例如 `completed`、`in_progress` |
| `conclusion` | Gitea 原始结论，例如 `success`、`failure`、`cancelled` |
| `outcome` | `success` / `failure` / `running` / `pending` / `cancelled` / `other` / `unknown` |

`completed` 不等于成功；`outcome` 只解释 CI 结果，不表示部署、服务健康或机器在线。

状态区分：

- 仓库 `hasActions=false`：`actions-disabled`，不请求 Run 端点。
- 仓库可访问、Actions 端点 404：`unsupported`，提示可能未启用或版本不支持。
- 空列表：`empty`。
- 认证/权限/限流/网络失败分别返回，不解释成“没有流水线”。
- 本地 HEAD 没有匹配 Run：`empty`；本地 Remote 与关联仓库完整名称不一致：`unmatched`，不猜测对应关系。

## 数据与生命周期

本 Plugin 独占 `locus.dataDirectory/gitea.sqlite`，实验版本 `user_version=1`，只保存实例配置。使用 SQLite 事务、DELETE journal 与 FULL synchronous；未知版本、损坏库或已有结构却无版本时拒绝覆盖。

不持久化仓库缓存、Workflow、Run、日志、Artifact、Secret、环境变量或临时 Session 状态。Workspace 关系仍在 Core；Plugin 停用、实例不可达或凭据失效不删除关系与实例配置。备份需停止全部 Locus 写者后复制整个数据目录；Gitea 数据与凭据不属于备份内容。

fiber 卸载等待在途 HTTP 观察并关闭数据库。当前不实现 Webhook、后台同步、历史归档、日志/Artifact 下载、CI 触发、变量/Secret 管理或部署推断。

## 验证

`pnpm test` 覆盖实例 CRUD、URL/凭据校验、DSH credentials 优先解析、认证失败、重定向不跟随、仓库数字 ID、改名解析、Run 状态、空列表、Actions 未启用、API 不支持和远端候选。

真实 Gitea 1.25.5 已验证版本/用户、5 个私有仓库、Actions Run 列表与详情、`head_sha` 过滤、成功/失败/取消状态、多个 Workspace 共享仓库、Remote 候选、无本地仓库关联、实例不可达、凭据缺失/无效和插件停用后的关系保留。验证入口见[测试系统](../../docs/testing.md#分层与入口)。
