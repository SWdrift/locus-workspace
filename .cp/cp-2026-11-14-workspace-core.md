# CP Workspace Core

## Control Plane Role

本平面控制当前交付主线：`packages/core` 的 Workspace 身份、长期关系与挂载，`apps/cli` 的命令树、名称解析、统一 shell 与输出契约，以及 `.agents/skills/locus` 的 Agent 入口。项目模板由 [Templates 平面](./cp-2026-11-14-templates.md)单独维护。

它取代 2026-11-12 的 Filesystem 与 UI Framework 两个平面。DSH 插件宿主、`plugins/filesystem`、`packages/ui`、`packages/application` 与 `packages/contracts` 已整体移除，那两个平面的 Scope 与任务板不再对应任何代码；相关取舍见[回退决定](../.agents/notes/implemented/architecture/2026-11-13-packages-apps-workspace-core.md)。

本平面不控制 Web 实现、外部能力接入与模板扩展；这些的重引入条件由[架构的边界](../docs/architecture.md#边界)与[控制与演进](../docs/architecture.md#控制与演进)维护，不在此复述。

## Meta Reference

- [cp-meta.md](./cp-meta.md)：控制平面结构、命名与更新规则。
- [项目架构](../docs/architecture.md)：组件职责、依赖方向与扩展边界。
- [Core](../packages/core/README.md)：装配入口、持久化、迁移与限制。
- [CLI](../apps/cli/README.md)：命令行为、统一 shell 注入与退出码。
- [Locus Skill](../.agents/skills/locus/SKILL.md)：Agent 分层索引、参考与只读脚本。
- 扩展/收尾使用 `create-control-plane` / `compact-control-plane`。

## Scope

- `packages/core`：Workspace 身份、成员/关联、mounts、`core.sqlite` 版本与恢复。
- `apps/cli`：参数解析、确认、人类/JSON 渲染、`locus shell`、退出码。
- `.agents/skills/locus`：索引、Workspace/Shell 参考与脚本；模板参考由 Templates 平面维护。
- 不包含：`apps/web` 实现、Filesystem 位置登记与读写、DSH/Cordis 宿主、插件加载、Provider/Mount 多源模型、项目模板（见 Templates 平面）。

## Core Rules

- `createLocusCore()` 是唯一装配入口；CLI 每次进程创建 Core 并在命令结束 `dispose()`；不存在隐式当前 Workspace 或第二套持久化。
- 领域规则只在 Core 与 Templates；CLI 只拥有参数、确认、渲染、shell 与退出码，不复制业务组合。
- Core 与 Templates 只依赖 Node 内置模块；在第二个真实消费端出现前，不新建 contracts/application 层、插件运行时或能力注册表。
- 挂载是 Core 的长期事实：只保存绝对路径与名称，不校验目录存在，删除 Workspace 不删外部目录；名称/路径唯一与级联范围见 [Core](../packages/core/README.md)。
- `locus shell` 只注入环境与临时启动器，不改写 shell profile，不是权限沙箱；注入清单与缺失挂载行为见 [CLI](../apps/cli/README.md#统一-shell)。
- 写入类操作有真实运行证据后才更新文档；验证入口为 `pnpm verify`，完整链路 `pnpm verify:full`，e2e 冷却不加 `--force`。
- 新增能力先建普通 package 并在 Core 或 app 组合根显式接入；不扩大当前平面为顺手重构。

## Task Board

- [x] 回退 DSH 宿主，收敛为 Core + CLI + Web 占位；删除 contracts/application/ui/filesystem 与宿主装配
- [x] Workspace 创建、列举、打开、改名、删除与跨进程恢复；关系幂等与自引用拒绝
- [x] `mounts` 表、v1→v2 迁移、名称/路径唯一与级联删除
- [x] 统一 shell：环境注入、临时启动器、缺失挂载处理与子 shell 退出码传播
- [x] Locus Skill 分层索引、Workspace/Shell 参考与只读脚本
- [x] `pnpm verify` 通过：构建 + 31 项测试 + 44 个 Markdown 文档检查
- [ ] 在 POSIX shell（bash/zsh）实际执行 `locus shell`，确认启动器权限、`SHELL` 解析与 `--command` 退出码；当前手工验证仅覆盖 Windows PowerShell
