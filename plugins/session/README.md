# @locus/session

## 简述与职责

只读的 DSH Session Capability：发现当前 DSH 来源可查询的会话、读取必要元信息与标题，并把不透明引用交给 Core 保存长期关联。Plugin 不拥有 Session 的执行状态、消息历史或生命周期，也不建立自己的 Session 数据库；原生事实仍由 DSH 的 `ctx.sessions`、`ctx.sessionPersistence` 与 `ctx.sessionQuery` 负责。

## 装配与使用

按[开发与验证](../../docs/development.md#宿主运行)将本包链接到项目内 `locus` profile 并合入插件行。Plugin 注入 `locus`，提供 `locusSession`；Capability 标识为 `locus.session`，提供方为 `@locus/session`，Tag `history` 只分类。DSH 侧实际复用 `ctx.sessionQuery` 的 `listSessions`、`filterSessions` 与 `readTitleSnapshot`。

`ctx.sessionQuery` 是可选服务：未加载时 Plugin 仍提供 `locusSession`，`discover` 明确失败，`inspect` 返回 `unavailable`，已保存关联不受影响。CLI 语法由[命令手册](../../docs/commands.md#workspace-操作)维护；非终端调用使用 `createSessionService()` 与 [contracts](../../packages/contracts/README.md) 中的局部协议。

## 引用与来源

Session 引用使用 `dsh.session.<source-id>` 命名空间与原生 Session ID。`source-id` 是当前 DSH 数据目录的稳定摘要，`source.label` 来自 profile 名；这样不同 `DSH_HOME` 下相同的 Session ID 不会在 Core 中合并。关联保存的是不透明引用和人工确认来源，不保存标题、cwd、消息或工具参数。

`cwd` 只是发现线索：相同目录的两个 Session 仍是两个身份，也不会因目录相同自动关联。一个 Workspace 可关联多个 Session，同一个 Session 也可被多个 Workspace 关联；解除关联只删除 Core 关系，不删除原生 Session。

## 状态与返回

- `live`：当前 DSH 进程仍持有该 Session；不能从另一个进程接管。
- `persisted`：持久化记录可读，即使创建它的进程已结束。
- `unavailable`：查询服务缺失、记录不存在/损坏、来源不同或当前无法访问；已保存关联仍保留。

`session open` 只在 DSH 能可靠继续时给出原生入口：当前实现输出 `dsh --profile headless --session-id <id>` 与所需 cwd。headless 会再次校验同一 `DSH_HOME`、工作目录与 agent preset；fork、subagent 或未记录 cwd 的 Session 明确返回不可用。Locus 不复制完整 Transcript，也不把 headless 命令冒充 Locus 自己的运行时。

Session 查询服务属于受信任的宿主内部服务，可能不做调用方授权检查。当前 CLI 是用户可见入口，只返回元信息与标题；未来 Web/Agent 入口必须继续限制可见来源与字段，不能把全局查询无条件暴露。

## 数据与生命周期

Plugin 没有自有数据库或缓存；Session 标题和记录在每次用例中按需从 DSH 读取。卸载 Plugin 不删除 Session、消息历史或 Core 关系，重新加载后继续读取当前 `ctx.sessionQuery`；长驻 shell 每行重新读取当前 `locusSession`，不保存旧服务或 Session 快照。`dsh-session-query` 精确读取会在需要时回放完整日志，因此默认列表只取元信息，标题读取只发生在 `inspect`。

## 验证

`pnpm test` 使用假查询服务覆盖 live/persisted/unavailable、来源隔离、标题失败与原生入口限制；跨包 CLI 测试覆盖显式关联、跨 Workspace 复用、解除和插件停用；`pnpm verify:full` 在临时 `DSH_HOME` 中用真实持久化 seam 创建 Session，覆盖发现、关联、重启、跨进程与原生 headless 入口。验证入口见[测试系统](../../docs/testing.md#分层与入口)。
