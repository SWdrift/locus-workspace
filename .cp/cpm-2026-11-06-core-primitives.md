# CPM Core Primitives

[同 scope CP](./cp-2026-11-06-core-primitives.md)的记忆文件，只保存该控制面后续仍需的已核实事实与约束；不保存一次性进度、实现盘点或项目级通用经验。

## 事实归属

- 已交付产品语义由[产品决定](../.agents/notes/implemented/feature/2026-11-08-workspace-capability-slice.md)维护；组件、所有权与 SQLite 取舍由[架构决定](../.agents/notes/implemented/architecture/2026-11-08-workspace-capability-composition.md)维护；当前命令、格式与恢复操作由模块 README 和手册维护。
- 未交付的候选、Blueprint、多提供方与跨设备统一留在[后续提案](../.agents/notes/proposed/feature/2026-11-08-workspace-capability-evolution.md)。本项目用 Agent Notes 承载设计，不另建集中索引；状态由实际交付与验证决定。
- 旧原语表不是类型或模块清单。稳定身份、不透明引用与带来源关系已有真实调用；Register/Discover/Persist 是当前用例，不因此需要通用运行机制。
- 一次性运行记录不复制到 memory；证据来自测试与 smoke 的实际输出及提交记录。数据目录/版本/迁移归 [Core](../packages/core/README.md#持久化与恢复)，领域引用归对应 Plugin。

## 记忆

- 能力选择保存用户意图，Plugin 注入解决当前运行依赖，原生观察解释当前状态；三者不能折叠成同一开关。后续 Gitea/Remote Machine 可沿现有局部服务交互复用，不必扩中央注册器。
- Session 已复用 DSH `ctx.sessionQuery`，Core 无新表：关联是 `dsh.session.<source-hash>` + 原生 ID，cwd 不是身份。`live`/`persisted`/`unavailable` 分开；标题只在 `show` 读取，列表不取正文。DSH headless 只接受同 DSH_HOME、同 cwd、非 fork/subagent 的持久 Session；真实续接已到模型请求阶段。
- Windows `access(R_OK)` 不能证明 ACL 允许读取；实际故障探针已证明需要打开/枚举。另一方面，Core 已保证的数据目录无需在内部 Plugin 再验证；防御集中在真实边界。
- 本机 file URL 是地址，不是全局对象 Identity；Windows realpath 字符串不保证归一化大小写。不能把同名路径、Tag 或 Remote 当作跨设备等价证据。
- 本项目的异步应用接线以 [CLI](../plugins/cli/README.md#能力与生命周期)为准；DSH 同步解析、就绪和 Fiber 事实统一链接[参考](../docs/references/dsh-plugin-development.md#命令行与退出)，不在 memory 复制框架契约。
- 能力“声明”只能来自当前已加载提供方；保存的选择是用户意图，不是声明。CLI 同时接受能力标识与提供方包名，避免把实现细节变成用户前置知识；状态展示必须分开声明、配置、加载、可用性。
- 验证分层：领域边界与命令矩阵用真实资源的进程内测试；只有 launcher/profile、退出、跨进程恢复和插件停用才逐命令启动完整 DSH。冒烟不再重复矩阵，避免几十次完整 profile 启动。
- 默认门禁是 `pnpm verify`（构建、快速测试、文档检查）；Filesystem/Git 变化先构建再运行 `pnpm test:all`；`pnpm verify:full` 才包含高耗费的 profile e2e，只在装配/生命周期变化或里程碑验收时运行。分层减少运行次数，不减少断言。

## 相邻控制面

[Bootstrap](./cp-2026-11-06-bootstrap.md)及[其记忆](./cpm-2026-11-06-bootstrap.md)维护项目内运行时；[Host-DSH](./cp-2026-11-08-host-dsh.md)控制薄装配。DSH 通用事实以[插件参考](../docs/references/dsh-plugin-development.md)为唯一所有者。
