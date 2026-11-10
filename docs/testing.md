# 测试系统

本页定义跨包测试的分层、运行入口、夹具与编写约束。命令语法见[实用命令](commands.md#工程命令)，环境、profile 装配与数据位置见[开发与验证](development.md)。各模块的覆盖范围、失败分类与平台限制由模块 README 维护，本页不复制领域矩阵。

## 分层与入口

| 层级 | 入口 | 运行内容 |
| --- | --- | --- |
| 快速层 | `pnpm test` | Core、Operations、Application、Session、Remote Machine、Connectivity、Gitea 与 UI API 包测试，以及跨包 Host/CLI/shell；不含 Filesystem/Git 包测试与 profile e2e |
| 全量进程内 | `pnpm test:all` | `packages/*/test/`、`plugins/*/test/` 与 `tests/*.test.mjs`；不含 profile e2e |
| 单文件 | `pnpm test:file <文件>` | 直接运行一个 `node --test` 文件，可附加 `--test-name-pattern <模式>` 过滤用例 |
| profile 冒烟 | `pnpm verify:full` | 构建、全量进程内与文档检查之后运行 `tests/e2e/workspace-smoke.mjs`，使用真实 launcher/profile；受[高耗时操作节流](#高耗时操作节流)约束 |
| 快速门禁 | `pnpm verify` | 构建、快速层与文档检查 |
| 文档检查 | `pnpm docs:check` | Markdown 结构、本地链接与 Agent Notes 生命周期；修改检查器时再运行 `pnpm docs:test` |

日常迭代使用 `pnpm verify`。修改 Filesystem、Git、Session 或 Gitea 的原生查询时运行 `pnpm test:all`；修改装配、launcher、退出码、跨进程恢复、插件停用或 shell 时运行 `pnpm verify:full`；完整验收也只使用 `pnpm verify:full`。分层减少运行次数，不删除断言或缩小覆盖范围。

e2e 只保留进程内测试无法覆盖的装配、退出码、跨进程恢复、插件停用与 shell 组合，不重复快速层或全量层的领域矩阵。它是分钟级的高耗费操作，不作为日常编辑的默认反馈。

## 高耗时操作节流

e2e 执行前查看 `temp/e2e-runs.log` 的最后一条开始记录。该文件被 Git 忽略，仅对当前工作副本生效；没有记录视为从未运行。记录用 UTC 时间，包含用途或理由、结果。

最近一次 e2e 开始后 2 小时内，只有满足以下条件之一才执行，否则跳过：

- 当前任务中用户明确要求运行 e2e。
- e2e 是验证该变更的唯一可行证据，必要性达到 92% 以上。

92% 是人工判断阈值，不自动计算。存在可用的进程内替代、变更只涉及文档或局部逻辑、或只是求稳时，必要性低于阈值。

每次运行前先追加开始记录，结束后追加结果：

```text
<UTC 时间> start reason=<用户要求或唯一证据的依据>
<UTC 时间> passed duration=<秒>
```

失败或中断也保留记录并占用冷却窗口，避免连续重试。跳过不写成功记录，也不构成 e2e 通过证据；需要完整证据时等待窗口结束或记录理由后重跑。

该约定是人工执行规则，不自动阻断命令。`pnpm verify:full` 一旦启动就会执行 e2e，因此运行前同样先判断；无例外时不要调用 `pnpm verify:full`，改用 `pnpm verify` 或 `pnpm test:all`。

## 目录与形态

- `packages/*/test/` 与 `plugins/*/test/` 是包测试，使用 `node:test`。只有注册了 `test` script 的包可直接运行 `pnpm --dir <包> test`；`packages/contracts`、`packages/host-dsh` 与 `plugins/cli` 没有独立 test script。`plugins/ui/test/` 读取 `web/dist`，因此运行前需要构建浏览器端。
- `tests/*.test.mjs` 是跨包进程内测试，当前为 Host、CLI、shell 与 Operations。Host/CLI/shell 同时进入快速层，其余文件只在 `pnpm test:all` 收集。
- `tests/e2e/workspace-smoke.mjs` 是真实 profile 冒烟，不匹配 `tests/*.test.mjs`，因此不会被快速层或全量层误收集。
- `tests/e2e/fixtures/` 提供冒烟所需的本地 Gitea HTTP 服务与 Session fixture 插件。
- `scripts/docs.test.mjs` 验证文档检查器自身的通过与失败边界。

## 夹具与隔离

每个用例建立自己的临时根目录，把数据目录、原生资源和配置隔离在其中，并在 `t.after` 或 `finally` 中释放服务、删除临时目录、恢复环境变量。测试不写入仓库、真实用户目录或 `~/.dsh`，也不依赖共享的可变状态。

- Core、Filesystem、Git、Gitea 测试使用真实 SQLite 文件、真实临时目录、原生 Git 仓库或本地 HTTP 服务；Host 测试使用真实 Cordis Context。
- Remote Machine 与 Connectivity 注入 `run`/`probeTcp`，Session 注入查询服务；它们在外部进程或网络边界替换不可控依赖，不伪造被测领域行为。
- CLI 测试在进程内复用真实命令树和真实服务，只抑制终端输出，不启动 launcher；launcher 与 profile 装配由 e2e 覆盖。UI 测试启动真实 loopback HTTP 服务器并读取构建后的静态页，覆盖令牌、来源、静态路径、Overview API 与 Operation 调用；浏览器视觉与交互用本地 Chromium 手工验证，不作为默认自动化门禁。
- e2e 使用临时 `DSH_HOME` 与 `LOCUS_HOME`、fixture Gitea 服务、fixture Session 插件、真实 Git 仓库和 loopback 地址；凭据使用合成 token，不访问外部服务。
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
- Git 夹具使用临时仓库，并禁用可选锁、终端提示、用户 hooks 与签名，避免读取或写入真实 Git 配置。
- profile e2e 需要原生 Git 与 OpenSSH；Gitea 由本地 fixture 提供，不使用外部实例。FRP 不属于默认 e2e 前提，连通用例使用 direct transport。其余环境依赖见[前置条件与构建](development.md#前置条件与构建)。

## 文档检查

修改任何 Markdown 后运行 `pnpm docs:check`。修改文档检查器时还要运行 `pnpm docs:test`，覆盖检查器新增的通过与失败边界。检查器只验证结构、链接与生命周期，不代表业务行为正确；真实行为仍按上文分层运行。

检查器与注册命令的对应关系见[维护脚本](../scripts/README.md)，检查器的具体规则不在本页复制。
