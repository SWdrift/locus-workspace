# 实用命令

本页登记当前命令语法与成功判据。环境和 profile 准备见[开发与验证](development.md)，实现语义链接模块 README，不用命令参数反推领域模型。

## 工程命令

| 命令 | 用途与成功判据 |
| --- | --- |
| `pnpm install` | 安装 workspace 依赖并链接本地包 |
| `pnpm build` | 编译实际库和 Plugin，退出 0 |
| `pnpm test` | 快速测试：Core 包测试 + 跨包 Host/CLI/shell；约 2 秒，不含 Filesystem/Git 独立集成与 profile e2e |
| `pnpm test:all` | 全部非 profile 测试：各包 test/ + 跨包 CLI/Host；约 7–12 秒 |
| `pnpm test:file <文件>` | 直接运行单个测试文件；可附加 `--test-name-pattern <模式>` 过滤用例 |
| `pnpm verify` | 快速门禁：`build` + `test` + `docs:check`；约 4–5 秒 |
| `pnpm verify:full` | 完整门禁：`build` + `test:all` + `docs:check` + profile e2e；约 40–60 秒 |
| `pnpm docs:check` | Markdown 结构、链接与 Agent Notes 生命周期检查通过 |
| `pnpm docs:test` | 文档检查器测试通过；仅修改检查器时要求执行 |
| `pnpm docs:check --root <目录>` | 在指定真实目录执行相同文档检查 |
| `dsh --profile locus shell` | 进入长驻交互 shell；连续命令复用同一 DSH 进程，不新增启动 |

包内测试位于 `packages/*/test/` 与 `plugins/*/test/`，对应包可直接运行 `pnpm --dir <包> test`。根 `tests/` 只保留跨包 CLI/Host 集成与 `tests/e2e/`。

### 验证门禁

`pnpm test` 是默认快速层，覆盖 Core、Host、CLI 与 shell。`pnpm test:all` 才运行 Filesystem/Git 原生集成；`pnpm verify:full` 再追加真实 profile e2e（8 次独立 DSH，约 30–60 秒）。e2e 只保留 launcher、退出码、跨进程恢复、插件停用与 shell 组合，不重复快速层矩阵。

日常使用 `pnpm verify`。只有修改 Filesystem/Git 才需要 `pnpm test:all`；只有完整验收才使用 `pnpm verify:full`。分层减少运行次数，不删除断言或缩小覆盖范围。

## Workspace 操作

先把 `DSH_HOME` 指向项目内 `.dsh/`，按需设置绝对 `LOCUS_HOME`；数据位置和恢复见 [Core](../packages/core/README.md#持久化与恢复)。下表是 `pnpm exec dsh --profile locus` 后的应用参数。使用 `--json` 得到独立 JSON，省略时为人类输出；各层支持 `--help`，`--version`/`-V` 属于 DSH，不是产品版本。

| 参数 | 行为与成功判据 |
| --- | --- |
| `version` | stdout `0.0.0`、退出 0 |
| `workspace create <name>` | 返回具有稳定 UUID 的新 Workspace，不要求目录 |
| `workspace list` | 列出长期 Workspace；空集合不是错误 |
| `workspace show <id>` / `workspace open <id>` | 按 Identity 打开并显示基本信息、关系与能力选择；不设置隐式当前目录 |
| `workspace rename <id> <name>` | 改名，Identity 不变 |
| `workspace link <id> <namespace> <reference> [--kind member\|association] [--source <说明>]` | 显式保存外部引用；默认 association；引用 Workspace 使用 namespace `locus.workspace` |
| `workspace unlink <id> <relation-id> --yes` | 仅解除该关系，不删除目标或其他归属 |
| `capability list <id>` | 分别显示“声明”（当前已加载提供方）、保存的选择、加载、可用性及授权检查方式；保存的选择不算声明 |
| `capability configure <id> <capability>` | 选择已加载提供方；接受 `filesystem` / `git`、完整能力标识或提供方包名（如 `@locus/filesystem`） |
| `capability remove <id> <capability> --yes` | 按能力标识或提供方包名取消能力选择，保留成员与 Plugin 配置 |
| `fs register <workspace> <path>` | 登记一个发现位置；不是确认成员；要求已选择 Filesystem |
| `fs locations <workspace>` | 列出已登记位置，包含后续调用使用的 location ID |
| `fs unregister <workspace> <location> --yes` | 取消位置入口，不删除文件或已确认关系 |
| `fs inspect <workspace> <location> [relative]` | 返回当前资源状态，缺失/拒绝/不可用是明确查询结果 |
| `fs discover <workspace> <location> [relative] [--limit <count>]` | 单层发现，默认 200、上限 1000；不自动写长期成员。根不可访问时返回观察并以 2 退出 |
| `fs read <workspace> <location> [relative] [--max-bytes <count>]` | 有界读取普通文件 UTF-8 文本，默认 65536 字节、上限 1MiB；失败不返回伪空内容 |
| `fs confirm <workspace> <location> [relative] [--kind member\|association]` | 显式确认当前可访问资源，默认 member，记录发现来源 |
| `git inspect <workspace> <location> [relative]` | 从 Filesystem 线索读取本地工作树仓库、状态与脱敏 Remote；非 Git 目录正常返回 not-repository |
| `git confirm <workspace> <location> [relative]` | 显式关联观察到的仓库，Remote 不自动确认 |

`relative` 必须在登记范围内，链接不遍历。`fs` 或 `git` 操作提示“尚未启用能力”时，先运行 `capability configure <workspace> filesystem`（Git 同样替换能力名），不必区分能力标识与具体提供方包。Filesystem 详细失败和范围语义见 [Plugin](../plugins/filesystem/README.md#读取与失败语义)；Git 支持与限制见 [Plugin](../plugins/git/README.md#观察语义)。

### 初始配置配方

一个“研究工作语境”只是以下已支持动作的组合，不是 Workspace 类型、强制 Factory 或模板运行时：

1. `workspace create Research`，保存返回的 Identity。
2. `capability configure <id> filesystem`，选择 Filesystem 提供方。
3. 对选定目录调用 `fs register <id> <path>`；需要时再用 `fs confirm` 确认成员，不自动纳入全部后代。
4. 如确有本地仓库，单独选择 `git` 并调用只读观察；无仓库的 Workspace 无需此步。

每个动作前加 `pnpm exec dsh --profile locus`。这些动作保存普通 Workspace 与各 Plugin 配置，不保存对某份配方文件的永久依赖；修改或删除本页不改变已保存的身份与关系。没有 Blueprint 解析器或模板引擎。

## 长驻 shell

`dsh --profile locus shell` 等待 stdin 逐行输入，复用与一次性命令相同的命令树、领域服务和持久化。它不是新的入口或运行时：每行独立解析，仍不设置隐藏的当前 Workspace；需要 ID 时从 `workspace create` / `workspace list` 的输出取得。

- `exit` 或 `quit` 结束；stdin EOF 也结束。
- 单条命令失败只写入 stderr 并继续；不会终止 shell，也不会把失败写成成功。
- 进程退出码取最后一条命令的结果；交互式使用时便于脚本判断，不改变单次 CLI 的退出码。
- `--json` 可放在每行命令前；TTY 显示 `locus> ` 提示，管道输入不输出提示或欢迎语。
- 引号内的空白、单/双引号和常见反斜杠转义可用，例如 `fs register <id> "C:\path with spaces"`。

开发期模块热更新配置与边界见[DSH 插件开发](references/dsh-plugin-development.md#长驻入口与热更新)，运行方式见[开发与验证](development.md#长驻与热更新)。

## 输出与退出

单次命令成功返回 0；参数语法错误返回 1；业务前置条件、持久化、能力调用失败返回 2。`fs inspect` 查询到 missing/denied 仍为成功查询；读取失败或 Git 原生故障不是成功。无参数或未知命令退出 1，不进入隐式交互等待。涉及关系/位置/能力取消的命令必须显式 `--yes`。

在 `shell` 中，上述退出码是单行结果；单行失败不会终止会话，最终进程退出码取最后一条命令。

未知子命令明确报告“未知命令”；无参数提示查看帮助，二者都退出 1。JSON stdout 不混入诊断；诊断写 stderr。能力提供方缺失不阻止 `workspace` 命令，保存的选择和引用保留。验证入口与分层见[开发与验证](development.md#修改与验证)。
