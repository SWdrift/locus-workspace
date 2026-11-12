# 实用命令

本页登记当前命令语法与成功判据。环境和 profile 准备见[开发与验证](development.md)，测试分层、夹具与编写约束见[测试系统](testing.md)，实现语义链接模块 README，不用命令参数反推领域模型。

## 工程命令

| 命令 | 用途与成功判据 |
| --- | --- |
| `pnpm install` | 安装 workspace 依赖并链接本地包 |
| `pnpm build` | 编译全部库与 Plugin，并构建浏览器端，退出 0 |
| `pnpm test` | 快速层测试，退出 0；范围见[测试系统](testing.md#分层与入口) |
| `pnpm test:all` | 全量进程内测试，退出 0；范围见[测试系统](testing.md#分层与入口) |
| `pnpm test:file <文件>` | 直接运行单个测试文件；可附加 `--test-name-pattern <模式>` 过滤用例 |
| `pnpm verify` | 快速门禁：`build` + `test` + `docs:check` |
| `pnpm verify:full` | 完整门禁：`build` + `test:all` + `docs:check` + profile e2e；e2e 属高耗时操作，运行前按[节流约定](testing.md#高耗时操作节流)判断 |
| `pnpm docs:check` | Markdown 结构、链接与 Agent Notes 生命周期检查通过 |
| `pnpm docs:test` | 文档检查器测试通过；仅修改检查器时要求执行 |
| `pnpm docs:check --root <目录>` | 在指定真实目录执行相同文档检查 |
| `dsh --profile locus shell` | 进入长驻交互 shell；连续命令复用同一 DSH 进程，不新增启动 |

测试目录、覆盖范围、运行成本与选择规则见[测试系统](testing.md#分层与入口)；本表只登记命令入口，不复制测试矩阵。

## Workspace 操作

先把 `DSH_HOME` 指向项目内 `.dsh/`，按需设置绝对 `LOCUS_HOME`；数据位置和恢复见 [Core](../packages/core/README.md#持久化与恢复)。下表是 `pnpm exec dsh --profile locus` 后的应用参数。使用 `--json` 得到独立 JSON，省略时为人类输出；各层支持 `--help`，`--version`/`-V` 属于 DSH，不是产品版本。

| 参数 | 行为与成功判据 |
| --- | --- |
| `version` | stdout `0.0.0`、退出 0 |
| `ui [--port <port>]` | 在现有 DSH 进程内启动 loopback Workspace UI 与 JSON 接口；默认 4310，按 Ctrl+C 停止 |
| `workspace create <name>` | 返回具有稳定 UUID 的新 Workspace，不要求目录 |
| `workspace list` | 列出长期 Workspace；空集合不是错误 |
| `workspace show <id>` / `workspace open <id>` | 按 Identity 打开并显示基本信息与长期关系；不设置隐式当前目录 |
| `workspace rename <id> <name>` | 改名，Identity 不变 |
| `workspace link <id> <namespace> <reference> [--kind member\|association] [--source <说明>]` | 显式保存外部引用；默认 association；引用 Workspace 使用 namespace `locus.workspace` |
| `workspace unlink <id> <relation-id> --yes` | 仅解除该关系，不删除目标或其他归属 |

## Filesystem 操作

Filesystem 保存位置登记与本次观察；发现结果不是长期成员，只有 `fs confirm` 才写入 Core 关系。缺少 Filesystem Plugin 时这些命令明确失败，Workspace 与已保存关系仍可读取。

| 参数 | 行为与成功判据 |
| --- | --- |
| `fs register <workspace> <path>` | 登记发现位置；路径当前缺失也允许，不创建目录 |
| `fs locations <workspace>` | 列举已登记位置；空集合不是错误 |
| `fs unregister <workspace> <location> --yes` | 取消位置登记，不删除文件或已确认关系 |
| `fs inspect <workspace> <location> [relative]` | 读取当前状态，区分 `accessible`、`missing`、`denied`、`unavailable`、`error` |
| `fs discover <workspace> <location> [relative] [--limit <n>]` | 只发现一层，不递归、不跟随符号链接；根不可访问时退出 2 |
| `fs read <workspace> <location> [relative] [--max-bytes <n>]` | 读取普通文件 UTF-8 文本，默认 65536、上限 1048576 字节 |
| `fs confirm <workspace> <location> [relative] [--kind member\|association]` | 确认当前可访问引用为长期关系；不可访问时失败 |

## 输出与退出码

默认输出人类可读文本；`--json` 输出独立 JSON，诊断写 stderr。关系确认与位置登记是显式操作，发现不自动写成员。解除关系与取消位置必须携带 `--yes`。

退出码：0 表示调用成功（包括 `fs inspect` 明确查询到缺失/拒绝资源）；1 表示参数/帮助树拒绝；2 表示业务前置条件、能力缺失、读取/发现或持久化失败。
