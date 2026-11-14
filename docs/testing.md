# 测试系统

本页定义测试的分层、归属、运行入口、夹具与编写约束。命令语法见[实用命令](commands.md#工程命令)，运行环境与数据位置见[开发与验证](development.md)。各模块的覆盖范围与平台限制由模块 README 维护，本页不复制领域矩阵。

## 分层与入口

| 层级 | 入口 | 运行内容 |
| --- | --- | --- |
| 快速层 | `pnpm test` | 模块测试与跨模块测试；不含 e2e |
| 全量进程内 | `pnpm test:all` | 经 `tests/run.mjs` 运行 `packages/*/test/`、`apps/*/test/` 与 `tests/*.test.mjs`；不含 e2e |
| 单文件 | `pnpm test:file <文件>` | 直接运行一个 `node --test` 文件，可附加 `--test-name-pattern <模式>` 过滤用例 |
| CLI 端到端 | `pnpm e2e` | 经 `tests/run.mjs` 运行 `tests/e2e/*.mjs`，使用真实构建产物与独立进程；受[高耗时操作节流](#高耗时操作节流)约束 |
| 快速门禁 | `pnpm verify` | 构建、快速层与文档检查 |
| 完整门禁 | `pnpm verify:full` | 构建、全量进程内、文档检查与 e2e |
| 文档检查 | `pnpm docs:check` | Markdown 结构、本地链接与 Agent Notes 生命周期；修改检查器时再运行 `pnpm docs:test` |

日常迭代使用 `pnpm verify`。修改跨包契约、持久化或命令行为时运行 `pnpm test:all`；修改构建入口、退出码、跨进程恢复或 pnpm 包装时运行 `pnpm e2e`；完整验收使用 `pnpm verify:full`。分层减少运行次数，不删除断言或缩小覆盖范围。

e2e 只保留进程内测试无法覆盖的组合：真实 `apps/cli/lib/index.js`、独立进程、跨进程恢复、完整命令链、退出码与 `pnpm locus` 包装。它不重复快速层或全量层的单命令矩阵。

`pnpm test:all` 与 `pnpm e2e` 经 `tests/run.mjs` 统一执行。

## 高耗时操作节流

入口在运行前读取 `temp/test-runs.log`，按同类上次开始的冷却窗口决定是否放行，并在运行前后自动追加记录。

| 类型 | 命令 | 冷却窗口 |
| --- | --- | --- |
| `all` | `pnpm test:all` | 无；只记录 |
| `e2e` | `pnpm e2e`、`pnpm verify:full` 的 e2e 段 | 2 小时 |

- 上次 `e2e` 开始后 2 小时内再次执行，入口以退出码 3 拒绝，打印上次开始时间与剩余时间，不启动测试。
- `--force` 跳过冷却检查：`pnpm e2e --force`，可加 `--reason <文本>`；强制运行同样写入记录并占用窗口。
- 失败、中断与强制运行同样占用窗口，避免连续重试。开始记录写入后进程被杀，冷却也不会解除。
- 记录为 UTC 单行：`<UTC> suite=e2e start …`、`<UTC> suite=e2e passed duration=<秒>`；文件被 Git 忽略，仅对当前工作副本生效。
- 历史 `temp/e2e-runs.log` 的 `start` 记录仍计入 e2e 冷却；新记录统一写 `temp/test-runs.log`。
- 该检查只覆盖系统性入口。`pnpm test`、`pnpm test:file`、包内 `pnpm --dir <包> test` 与 `pnpm docs:test` 不经过入口，也不受冷却限制。
- `pnpm verify:full` 按 `build → test:all → docs:check → e2e` 执行；e2e 被拒绝时命令以退出码 3 结束，已完成的步骤不回滚。
- e2e 依赖 pnpm 注入的 `npm_execpath`；冷却检查通过后，直接运行 `node tests/run.mjs e2e` 会以退出码 2 拒绝。
- 未发现测试文件时入口以退出码 1 失败，不把空集合当成通过。

## 归属与去重

测试跟随被测行为的最低负责层，而不是跟随执行方式。模块内部行为与其命令域都在模块内验证；跨包层只放无法归属到单一模块的组合。

| 被测行为 | 归属 | 示例 |
| --- | --- | --- |
| 模块内部行为：解析、校验、持久化、适配器参数 | `packages/<模块>/test/` | Remote Targets 的配置校验与 SSH/Plink 参数 |
| 模块自己的命令域：参数、输入来源、输出与退出码 | 该模块的 `test/`；CLI 作为主体时放 `apps/cli/test/` | `remote-targets`、`template` 与 Workspace 命令 |
| 两个及以上模块协同，且无单一归属 | `tests/*.test.mjs` | Skill 脚本经 CLI 创建 Workspace |
| 真实入口、独立进程、跨进程恢复、完整命令链与 pnpm 包装 | `tests/e2e/*.mjs` | 端到端命令与退出码 |

- 同一行为只在一个层级断言。发现上下层重复时，保留最低层的断言，删除上层副本；上层只补本层无法观察的契约。
- 模块内的 CLI 子进程用例只覆盖本层契约：参数、输入来源、输出格式、确认与退出码；解析、校验、默认值与执行语义由更低层覆盖。
- e2e 不重复进程内的单命令矩阵；只有进程内无法观察的组合才进入 e2e。
- 不在多个层级复制同一夹具或同一失败矩阵；共享夹具按最低层放置。

## 目录与形态

- `packages/*/test/` 与 `apps/*/test/` 是模块测试，使用 `node:test`；模块内部行为与该模块命令域的子进程用例都在此处。Core、Remote Targets、Templates 与 CLI 各自注册 `test` script。
- `tests/*.test.mjs` 只放跨模块组合，使用真实构建产物与独立进程；当前为 Skill 脚本用例。
- `tests/e2e/*.mjs` 是端到端脚本，不匹配 `*.test.mjs`，因此不会被快速层或全量层误收集。
- `tests/run.mjs` 是系统性测试入口，负责文件收集、冷却检查与运行记录；名称不匹配 `*.test.mjs`，不会被自身收集。
- `scripts/` 下有文档检查器自身的测试，按 `pnpm docs:test` 运行。

## 夹具与隔离

每个用例建立自己的临时根目录，把 `LOCUS_HOME`、SQLite 与临时资源隔离在其中，并在 `t.after` 或 `finally` 中释放 Core、删除临时目录、恢复环境变量。测试不写入仓库、真实用户目录或默认 `~/.locus-workspace`，不依赖共享的可变状态。

- 模块测试使用真实 SQLite 文件、真实模板目录与临时目标目录，不用内存替身代替被测层；远程目标的传输边界注入假执行器，避免依赖外部 SSH。
- CLI 子进程用例通过 `spawnSync` 启动构建后的 bin；每次命令都是独立进程，跨进程恢复由真实 SQLite 与文件系统承担。
- CLI e2e 使用临时绝对 `LOCUS_HOME`、真实构建产物与 `pnpm locus` 包装，验证完整命令链与退出码；不访问外部服务。
- Skill 用例设置 `LOCUS_CLI` 与临时 `LOCUS_HOME`，通过真实 CLI 创建 Workspace 与挂载后运行脚本。
- 测试导入 `lib/` 构建产物，因此运行前需要 `pnpm build`；测试不使用运行时 TypeScript 转译。

## 编写约束

- 缺陷先复现，并把回归测试放在能复现问题的最低层。只有构建入口、退出码、跨进程恢复与 pnpm 包装才进入 e2e。
- 断言可观察结果：状态、退出码、stdout/stderr、持久化内容与重启后恢复；不要断言源码文本、偶然措辞或实现副本。
- 被测层使用真实资源；只在外界不可控时替换边界。为了让测试通过而伪造被测行为会失去证据价值。
- 保持 stdout/stderr 契约：结构化 stdout 只含结果，诊断写入 stderr；e2e 单独断言 stdout 与 stderr。
- 清理必须覆盖失败路径；服务要 dispose，临时目录要删除，环境变量要恢复。
- 不为绿灯删除断言、缩小范围或吞掉失败。平台无法制造的故障可以带原因 `t.skip`，但不能把跳过写成通过。
- 新增行为先在真实入口运行用例，再更新所属模块 README 与 Agent Note。

## 平台与外部依赖

测试通过 Node API 使用临时目录与子进程，不依赖 shell 工具、原生 Git、OpenSSH 或外部服务。测试使用绝对 `LOCUS_HOME` 并在临时 CWD 中运行 CLI，避免读取仓库 `.env`；相对值按进程 CWD 解析，不用于隔离用例。Windows 与 POSIX 的路径差异由 `node:path`、`node:os` 处理。平台无法制造的故障带原因跳过，不写成通过。

## 文档检查

修改任何 Markdown 后运行 `pnpm docs:check`。修改文档检查器时还要运行 `pnpm docs:test`。检查器只验证结构、链接与生命周期，不代表业务行为正确；真实行为仍按上文分层运行。

检查器与注册命令的对应关系见[维护脚本](../scripts/README.md)，检查器具体规则不在本页复制。
