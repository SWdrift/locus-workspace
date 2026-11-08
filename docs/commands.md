# 实用命令

本页登记当前命令语法与成功判据。环境和 profile 准备见[开发与验证](development.md)，实现语义链接模块 README，不用命令参数反推领域模型。

## 工程命令

| 命令 | 用途与成功判据 |
| --- | --- |
| `pnpm install` | 安装 workspace 依赖并链接本地包 |
| `pnpm build` | 编译实际库和 Plugin，退出 0 |
| `pnpm test` | Node 内置测试，真实临时数据库/文件/Git/Cordis 场景通过；平台跳过项须单独报告 |
| `pnpm smoke:workspace` | 通过项目内 `locus` profile 验证装配、退出、跨进程恢复、插件停用与 Git 组合，输出 PASS；需装配全部示例插件及原生 Git。完整命令矩阵在 `pnpm test` |
| `pnpm docs:check` | Markdown 结构、链接与 Agent Notes 生命周期检查通过 |
| `pnpm docs:test` | 文档检查器测试通过；仅修改检查器时要求执行 |
| `pnpm docs:check --root <目录>` | 在指定真实目录执行相同文档检查 |

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

## 输出与退出

成功返回 0；参数语法错误返回 1；业务前置条件、持久化、能力调用失败返回 2。`fs inspect` 查询到 missing/denied 仍为成功查询；读取失败或 Git 原生故障不是成功。无参数或未知命令仍退出 1，不进入交互等待。涉及关系/位置/能力取消的命令必须显式 `--yes`。

未知子命令明确报告“未知命令”；无参数提示查看帮助，二者都退出 1。JSON stdout 不混入诊断；诊断写 stderr。能力提供方缺失不阻止 `workspace` 命令，保存的选择和引用保留。完整可复现链路与执行结果见[验收记录](workspace-foundation-validation.md)。
