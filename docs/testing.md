# 测试系统

本页定义跨包测试的分层、运行入口、夹具与编写约束。命令语法见[实用命令](commands.md#工程命令)，环境、profile 装配与数据位置见[开发与验证](development.md)。各模块的覆盖范围、失败分类与平台限制由模块 README 维护，本页不复制领域矩阵。

## 分层与入口

| 层级 | 入口 | 运行内容 |
| --- | --- | --- |
| 快速层 | `pnpm test` | Core、Application、Filesystem、UI 包测试，以及跨包 Host/CLI/shell；不含 profile e2e |
| 全量进程内 | `pnpm test:all` | 经 `tests/run.mjs` 运行 `packages/*/test/`、`plugins/*/test/` 与 `tests/*.test.mjs`；不含 profile e2e |
| 单文件 | `pnpm test:file <文件>` | 直接运行一个 `node --test` 文件，可附加 `--test-name-pattern <模式>` 过滤用例 |
| profile 冒烟 | `pnpm e2e` | 经 `tests/run.mjs` 运行 `tests/e2e/workspace-smoke.mjs`，使用真实 launcher/profile；受[高耗时操作节流](#高耗时操作节流)约束 |
| 快速门禁 | `pnpm verify` | 构建、快速层与文档检查 |
| 文档检查 | `pnpm docs:check` | Markdown 结构、本地链接与 Agent Notes 生命周期；修改检查器时再运行 `pnpm docs:test` |

日常迭代使用 `pnpm verify`。修改 Filesystem 的原生查询时运行 `pnpm test:all`；修改装配、launcher、退出码、跨进程恢复、插件停用或 shell 时运行 `pnpm verify:full`；完整验收也只使用 `pnpm verify:full`。分层减少运行次数，不删除断言或缩小覆盖范围。

e2e 只保留进程内测试无法覆盖的装配、退出码、跨进程恢复、插件停用与 shell 组合，不重复快速层或全量层的领域矩阵。它是分钟级的高耗费操作，不作为日常编辑的默认反馈。

## 高耗时操作节流

系统性测试统一经 `tests/run.mjs` 执行。入口在运行前读取 `temp/test-runs.log`，按同类上次开始的冷却窗口决定是否放行，并在运行前后自动追加记录。

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
- `pnpm verify:full` 仍按 `build → test:all → docs:check → e2e` 执行；e2e 被拒绝时命令以退出码 3 结束，已完成的步骤不回滚。
- e2e 依赖 pnpm 注入的 `npm_execpath`；冷却检查通过后，直接运行 `node tests/run.mjs e2e` 会以退出码 2 拒绝。

## 目录与形态

- `packages/*/test/` 与 `plugins/*/test/` 是包测试，使用 `node:test`。只有注册了 `test` script 的包可直接运行 `pnpm --dir <包> test`；`packages/contracts`、`packages/host-dsh` 与 `packages/cli` 没有独立 test script。
- `tests/*.test.mjs` 是跨包进程内测试，当前为 Host、CLI 与 shell。
- `tests/e2e/workspace-smoke.mjs` 是真实 profile 冒烟，不匹配 `tests/*.test.mjs`，因此不会被快速层或全量层误收集。
- `tests/run.mjs` 是系统性测试入口，负责文件收集、冷却检查与运行记录；名称不匹配 `*.test.mjs`，不会被自身收集。
- `scripts/docs.test.mjs` 验证文档检查器自身的通过与失败边界。

## 夹具与隔离

每个用例建立自己的临时根目录，把数据目录、原生资源和配置隔离在其中，并在 `t.after` 或 `finally` 中释放服务、删除临时目录、恢复环境变量。测试不写入仓库、真实用户目录或 `~/.dsh`，也不依赖共享的可变状态。

- Core、Application、Filesystem 测试使用真实 SQLite 文件与真实临时目录；Host 测试使用真实 Cordis Context；UI 测试启动真实 loopback HTTP 服务器并读取 `web/dist` 构建产物，运行前需要构建浏览器端。
- CLI 测试在进程内复用真实命令树、共享应用用例和真实服务，只抑制终端输出，不启动 launcher；launcher 与 profile 装配由 e2e 覆盖。
- e2e 使用临时 `DSH_HOME` 与 `LOCUS_HOME`、真实临时目录与 loopback 地址，不访问外部服务；UI 冒烟启动真实 `ui` 命令，验证页面、令牌与健康接口。
- 测试导入各包 `lib/` 构建产物，因此运行前需要 `pnpm build`；测试不使用运行时 TypeScript 转译。

## 编写约束

- 缺陷先复现，并把回归测试放在能复现问题的最低层。只有装配、launcher、生命周期与跨进程行为才进入 e2e。
- 断言可观察结果：状态、退出码、stdout/stderr、持久化内容、重启后恢复以及原生资源是否被修改；不要断言源码文本、偶然措辞或实现副本。
- 被测层使用真实资源；只在外界不可控时替换边界。为了让测试通过而伪造被测行为会失去证据价值。
- 保持 stdout/stderr 契约：结构化 stdout 只含结果，诊断写入 stderr；e2e 逐行解析 JSON stdout 并单独断言 stderr。
- 清理必须覆盖失败路径；服务要 dispose，临时服务器要关闭，环境变量要恢复，端口冲突用临时端口避免。
- 不为绿灯删除断言、缩小范围或吞掉失败。平台无法制造的故障可以带原因 `t.skip`，但不能把跳过写成通过。
- 新增行为先在真实入口运行用例，再更新所属模块 README 与 Agent Note。

## 平台与外部依赖

- Windows 不提供 `mkfifo`，特殊文件用例跳过；符号链接或 junction 用例在账户不允许创建链接时跳过。
- 普通用户可能绕过 POSIX 文件权限，无法制造真实 `EACCES` 时跳过；Windows 用 `icacls` 制造拒绝，并在 `finally` 中恢复 ACL。
- profile e2e 只使用临时目录与 loopback 地址，不依赖原生 Git、OpenSSH 或外部服务。其余环境依赖见[前置条件与构建](development.md#前置条件与构建)。

## 文档检查

修改任何 Markdown 后运行 `pnpm docs:check`。修改文档检查器时还要运行 `pnpm docs:test`，覆盖检查器新增的通过与失败边界。检查器只验证结构、链接与生命周期，不代表业务行为正确；真实行为仍按上文分层运行。

检查器与注册命令的对应关系见[维护脚本](../scripts/README.md)，检查器的具体规则不在本页复制。
