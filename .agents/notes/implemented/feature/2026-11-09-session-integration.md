# 决策记录：DSH Session 作为可关联的独立历史对象

Status: implemented

## 问题

Workspace 已经可以独立于目录和进程存在，但用户仍无法从一个长期工作语境重新找到相关的 DSH 历史会话。若把 Session 复制进 Core、把 cwd 当作 Workspace 身份，或先建设 Session Provider Registry / 第二运行时，就会混淆 DSH 的原生事实与 Locus 的长期关系，并把尚未验证的恢复能力写成已交付。

本轮需要在已有 Workspace Foundation 上增加第一个 Session Capability：发现当前 DSH 来源的 Session、显式关联、查看必要元信息并返回原生入口，同时保持 Session 的执行状态、消息历史和生命周期归 DSH 所有。

## 决定

### 复用 DSH 原生事实

Session Plugin 只消费本地 DSH `0.2.1-rc.5` 实际提供的 `ctx.sessionQuery`：

- `listSessions()` 返回 `SessionRecord` 的 `header`、`live`、`persisted` 与可选 `formatStatus`，不含消息正文。
- `filterSessions([{ kind: 'id', values: [...] }])` 用于检查单个 Session。
- `readTitleSnapshot()` 返回最新标题与来源 header；只用于 `session show`，不在列表中对全部 Session 回放日志。
- `ctx.sessions` / `ctx.sessionPersistence` 仍归 DSH；Session Plugin 不调用 `readSession`、`readSurface` 或 `listEvents` 复制 transcript。

`ctx.sessionQuery` 是可选服务。Session Plugin 仍可加载并提供 `locusSession`；查询缺失时 `discover` 明确失败，`inspect` 返回 `unavailable`，已保存关联保留。

### Core 不增加 Session 模型

Workspace 关联继续复用现有 `workspaces.link/unlink` 与不透明 `{ namespace, id }`。Core 的 schema、关系种类和能力快照均未改变；Session 标题、cwd、live 状态、消息与工具参数不进入 Core。

Session 引用格式为：

- `namespace`: `dsh.session.<source-id>`
- `id`: DSH 原生 Session ID
- `source-id`: 当前 DSH 数据目录规范化路径的 SHA-256 前 16 位
- `source.label`: 当前 profile 名

这样不同 `DSH_HOME` 下相同的原生 ID 不会合并；cwd 只是元信息，不参与身份。关联的 `source.detail` 保存可读的 Session ID 与来源标签，但关系唯一性仍由命名空间和 ID 决定。

### 状态与返回

Session 状态分为：

- `live`: 当前 DSH 进程仍持有；
- `persisted`: 持久记录可读；
- `unavailable`: 查询缺失、记录不存在/损坏、来源不同或当前不可访问。

`session open` 只对可可靠继续的持久 Session 输出 `dsh --profile headless --session-id <id>` 与 cwd；fork、subagent、未记录 cwd 的 Session 明确不可用。`live` Session 不从另一进程接管。真实 profile 中已用 headless 续接同一持久 Session 到模型请求阶段；当前环境无 API key，未产生模型回答。

### CLI 与能力选择

CLI 增加 `session list/show/associate/links/dissociate/open`。关联要求 Workspace 已通过 `capability configure <workspace> session` 选择提供方；`list/show` 是只读查询，不要求能力选择。`session links` 在插件停用或查询不可用时仍列出关系并标记 `unavailable`。

列表与 JSON 不返回消息正文、工具参数或密钥；`show` 只增加标题和必要元信息。当前 CLI 是用户可见边界；未来 Web/Agent 入口必须继续限制来源和字段，不能把可信的全局查询无条件暴露。

## 测试

- Session 包内测试覆盖 live/persisted/unavailable、标题失败、来源隔离、查询缺失和原生入口限制。
- 跨包 CLI 测试覆盖显式关联、两个 Workspace 复用同一 Session、解除不删除原生 Session、插件停用与查询不可用保留关系。
- `pnpm verify:full` 在临时 `DSH_HOME` 初始化真实 profile，用持久化 seam 创建三个真实 Session，并在同一进程中创建 live Session 验证 `live`；覆盖发现、关联、跨进程恢复、插件停用和 `session open`。
- 真实 headless Session 另行验证了发现、标题读取和 `--session-id` 续接校验。
- Session Plugin 没有自有状态，重载只替换 `locusSession` 服务；长驻 shell 每行从当前 Context 取服务。本地长驻 shell 中修改 Session 构建产物与 profile patch 未观察到 Session 模块热替换，因此不把 Session HMR 写成已验证行为；Filesystem/Git/Host 的既有 HMR 事实仍由对应记录维护。

## 备选方案

**在 Core 新增 sessions 表或通用 Session Provider Registry。** 会把 DSH 领域模型和未来 OMP 提供方提前固化进 Core，并制造第二份权威状态；当前拒绝。真实消费者只有一个 DSH Query，因此先由 Plugin 解释，确有多提供方证据再扩展。

**把 Session 日志或 transcript 复制到 Core。** 会失去消息与执行状态的单一所有者，扩大隐私与备份面；当前只保存不透明引用。

**用 cwd 或 Workspace 目录自动匹配 Session。** 相同目录不代表同一工作语境，且会造成自动归属和合并；当前只允许显式 `session associate`。

**只用 Session ID 作为关系目标。** 不同 `DSH_HOME` 下 ID 可能重复；当前用来源命名空间隔离。

**在本轮实现 TUI/Web 恢复或自建 Session Runtime。** 当前 profile 只有 CLI；复用 DSH headless 作为可验证原生入口，Locus 不内嵌会话执行器。

## 后果

Workspace 获得跨进程、跨 Session 生命周期的历史入口；Session 结束后关联仍可查看，解除关联不影响原生 Session。Core 无迁移、无新数据库、无通用注册器。

代价是 Session 发现与检查依赖 DSH `sessionQuery`，标题读取可能回放日志；不同来源的关系只能显示为不可访问，直到在对应来源打开。当前没有 Session 归档/结束状态、完整 transcript 浏览、OMP Provider 接入或 Web 授权边界。

## 暂缓

- OMP Provider 接入所需的来源标识、Session ID 映射、可用性与权限契约尚未定义。
- Activity/Resume/Handoff 不建立在 Session 复制或 Locus 自己的执行状态上；需要真实调用方再扩展。
- Session 的显式删除、跨来源迁移与在线备份不在当前范围。
