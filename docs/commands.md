# 实用命令

本页登记当前命令语法与成功判据。环境准备见[开发与验证](development.md)，测试分层见[测试系统](testing.md)，领域语义链接 [Core](../packages/core/README.md)。

## 工程命令

| 命令 | 用途与成功判据 |
| --- | --- |
| `pnpm install` | 安装 workspace 依赖并链接本地包 |
| `pnpm build` | 编译 Core、Templates 与 CLI，退出 0 |
| `pnpm test` | 运行 Core、Templates、CLI 与 Skill 脚本测试，退出 0；范围见[测试系统](testing.md#分层与入口) |
| `pnpm test:all` | 全量进程内测试，经 `tests/run.mjs` 收集并记录，退出 0 |
| `pnpm e2e` | 真实 CLI 端到端测试，经 `tests/run.mjs` 执行；2 小时冷却未解除时退出 3 |
| `pnpm test:file <文件>` | 直接运行单个测试文件；可附加 `--test-name-pattern <模式>` |
| `pnpm verify` | 快速门禁：`build` + `test` + `docs:check` |
| `pnpm verify:full` | 完整门禁：`build` + `test:all` + `docs:check` + `e2e` |
| `pnpm locus <参数>` | 运行构建后的独立 CLI，等价于 `node apps/cli/lib/index.js` |
| `pnpm docs:check` | Markdown 结构、链接与 Agent Notes 生命周期检查通过 |
| `pnpm docs:test` | 文档检查器测试通过；仅修改检查器时要求执行 |

## Workspace 操作

数据目录、首次打开时机与恢复由 [Core](../packages/core/README.md#持久化与恢复)维护。`--json` 可放在子命令前，得到单行 JSON；人类输出与 JSON 都只写 stdout。

| 参数 | 行为与成功判据 |
| --- | --- |
| `version` | stdout `0.0.0`、退出 0；不创建数据目录 |
| `workspace create <name>` | 返回具有稳定 UUID 的新 Workspace，不要求目录 |
| `workspace list` | 列出长期 Workspace 与挂载数量；空集合不是错误 |
| `workspace show <workspace>` / `workspace open <workspace>` | 按 Identity 或唯一名称查看挂载与长期关系 |
| `workspace rename <workspace> <name>` | 改名，Identity 不变 |
| `workspace remove <workspace> --yes` | 删除 Workspace 及自有挂载/关系，不删除外部目录 |
| `workspace mount <workspace> <path> [--name <name>]` | 挂载本机绝对目录；名称默认取目录名 |
| `workspace mounts <workspace>` | 列出挂载与路径 |
| `workspace unmount <workspace> <mount> --yes` | 取消挂载，接受挂载 ID 或名称；不删除目录 |
| `workspace link <workspace> <namespace> <reference> [--kind member\|association] [--source <说明>]` | 显式保存外部引用；默认 association；引用 Workspace 使用 namespace `locus.workspace` |
| `workspace unlink <workspace> <relation-id> --yes` | 仅解除该关系，不删除目标或其他归属 |

## Shell

`locus shell <workspace>` 启动用户当前平台的 shell 并注入 Workspace 上下文；`<workspace>` 接受 Identity 或唯一名称。

| 参数 | 行为与成功判据 |
| --- | --- |
| `shell <workspace>` | 进入交互 shell；第一个可访问挂载作为 `cwd`，缺失挂载写 stderr |
| `shell <workspace> --shell <path>` | 使用指定 shell 可执行文件 |
| `shell <workspace> --command <command>` | 执行一条命令后退出；CLI 退出码取子 shell 退出码 |
| `shell <workspace> --print-env` | 只输出上下文 JSON，不启动 shell |

注入清单、缺失挂载与能力边界见 [CLI Shell](../apps/cli/README.md#统一-shell)与 [Skill Shell 参考](../.agents/skills/locus/reference/shell.md)。

## 模板操作

模板命令只操作文件系统，不读取或创建 Workspace。`<template>` 可以是内置 ID（如 `minimal`）或本地模板目录；`<destination>` 相对路径按当前进程目录解析，目标必须不存在。

| 参数 | 行为与成功判据 |
| --- | --- |
| `template list` | 列出内置模板；空集合不是错误 |
| `template create <template> <destination>` | 复制文件夹，写入 `.template.json` 来源记录 |
| `template create ... --dry-run` | 只计算文件、目录与 digest，不写目标 |

完整格式、排除规则与失败见 [Templates](../packages/templates/README.md)。

## 输出与退出码

默认输出人类可读文本；`--json` 输出独立 JSON，诊断写 stderr。单次命令不隐式等待输入；删除 Workspace、取消挂载与解除关系必须显式携带 `--yes`。

退出码：0 表示调用成功；1 表示参数/帮助树拒绝，包括未知命令、缺参数、无效选项值与缺少 `--yes`；2 表示业务前置条件或持久化失败；`shell --command` 的子 shell 非零退出码原样返回。
