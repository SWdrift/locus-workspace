# 实用命令

本页登记当前命令语法与成功判据。环境和 profile 准备见[开发与验证](development.md)，测试分层、夹具与编写约束见[测试系统](testing.md)，实现语义链接模块 README，不用命令参数反推领域模型。

## 工程命令

| 命令 | 用途与成功判据 |
| --- | --- |
| `pnpm install` | 安装 workspace 依赖并链接本地包 |
| `pnpm build` | 编译实际库和 Plugin，并执行浏览器端类型检查与 Vite 构建，退出 0 |
| `pnpm test` | 快速层测试，退出 0；范围见[测试系统](testing.md#分层与入口) |
| `pnpm test:all` | 全量进程内测试，退出 0；范围见[测试系统](testing.md#分层与入口) |
| `pnpm test:file <文件>` | 直接运行单个测试文件；可附加 `--test-name-pattern <模式>` 过滤用例 |
| `pnpm verify` | 快速门禁：`build` + `test` + `docs:check` |
| `pnpm verify:full` | 完整门禁：`build` + `test:all` + `docs:check` + profile e2e；e2e 属高耗时操作，运行前按[节流约定](testing.md#高耗时操作节流)判断 |
| `pnpm docs:check` | Markdown 结构、链接与 Agent Notes 生命周期检查通过 |
| `pnpm docs:test` | 文档检查器测试通过；仅修改检查器时要求执行 |
| `pnpm docs:check --root <目录>` | 在指定真实目录执行相同文档检查 |
| `dsh --profile locus shell` | 进入长驻交互 shell；连续命令复用同一 DSH 进程，不新增启动 |
| `pnpm ui` | 启动本地 Workspace UI；需要先按开发文档设置 `DSH_HOME`，默认监听 `127.0.0.1:4310` |

测试目录、覆盖范围、运行成本与选择规则见[测试系统](testing.md#分层与入口)；本表只登记命令入口，不复制测试矩阵。

## Workspace 操作

先把 `DSH_HOME` 指向项目内 `.dsh/`，按需设置绝对 `LOCUS_HOME`；数据位置和恢复见 [Core](../packages/core/README.md#持久化与恢复)。下表是 `pnpm exec dsh --profile locus` 后的应用参数。使用 `--json` 得到独立 JSON，省略时为人类输出；各层支持 `--help`，`--version`/`-V` 属于 DSH，不是产品版本。

| 参数 | 行为与成功判据 |
| --- | --- |
| `version` | stdout `0.0.0`、退出 0 |
| `ui [--port <port>]` | 在现有 DSH 进程内启动 loopback Workspace UI 与 JSON 接口；默认端口 4310，按 Ctrl+C 停止。只服务本机，不自动打开浏览器 |
| `workspace create <name>` | 返回具有稳定 UUID 的新 Workspace，不要求目录 |
| `workspace list` | 列出长期 Workspace；空集合不是错误 |
| `workspace show <id>` / `workspace open <id>` | 按 Identity 打开并显示基本信息、关系与能力选择；不设置隐式当前目录 |
| `workspace overview <id> [--observe]` | 聚合已确认关系、本地配置、本次观察与未确认建议；默认不访问原生资源或远端 API。`--observe` 仅对已选择能力并发执行 Filesystem/Git/Session 查询、Gitea 仓库与 Run 元信息、Connectivity `ssh -G` 检查；不启动 SSH、FRP visitor 或远程命令，单个来源失败不隐藏其他结果 |
| `workspace rename <id> <name>` | 改名，Identity 不变 |
| `workspace link <id> <namespace> <reference> [--kind member\|association] [--source <说明>]` | 显式保存外部引用；默认 association；引用 Workspace 使用 namespace `locus.workspace` |
| `workspace unlink <id> <relation-id> --yes` | 仅解除该关系，不删除目标或其他归属 |
| `capability list <id>` | 分别显示“声明”（当前已加载提供方）、保存的选择、加载、可用性及授权检查方式；保存的选择不算声明 |
| `capability configure <id> <capability>` | 选择已加载提供方；接受 `filesystem` / `git` / `remote-machine` / `connectivity` / `gitea` / `session`、完整能力标识或提供方包名（如 `@locus/filesystem`） |
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
| `machine register <name> [--description <text>]` | 显式登记机器并生成稳定 Identity；不要求 Workspace、SSH 配置或连接成功 |
| `machine list [workspace]` | 无参数列出全部机器；给出 Workspace 时只列该 Workspace 的机器关联及 relation ID |
| `machine show <machine>` | 查看机器名称、描述、地址和 Workspace 关联 |
| `machine update <machine> [--name <name>] [--description <text>]` | 修改展示信息，Identity 不变；不接受空更新 |
| `machine address add <machine> --kind <ssh\|hostname\|ip\|other> --value <value> [--port <port>] [--label <label>]` | 添加已知地址；不自动创建或验证连接 |
| `machine address update <machine> <address> [--kind ...] [--value ...] [--port ...] [--label ...]` | 修改地址，Machine Identity 与地址 ID 不变 |
| `machine address remove <machine> <address> --yes` | 移除一个地址，不删除机器或其他地址 |
| `machine associate <workspace> <machine>` | 显式关联；要求 Workspace 已选择 Remote Machine 提供方；不创建连接 |
| `machine workspaces <machine>` | 从机器查看其 Workspace 关联 |
| `machine dissociate <workspace> <relation-id> --yes` | 仅解除关联，不删除机器、地址或其他 Workspace 关联 |
| `machine observe <machine> [address]` | 对一个 ssh 地址执行只读 OpenSSH `hostname` 观察；不给出地址时选首个 ssh 地址；非 observed 以 2 退出 |
| `connect list [workspace]` | 列出 Connection Profile；给出 Workspace 时过滤其机器关联下的 Profile |
| `connect profile list <machine>` | 列出某 Machine 的 Profile；不改变机器身份 |
| `connect profile show <profile>` | 查看 Profile 摘要；身份文件/known_hosts 路径默认脱敏 |
| `connect profile add <machine> <name> [--transport <direct\|proxy-jump\|frp>] --target <target> [--port] [--user] [--proxy-jump] [--identity-file] [--known-hosts-file] [--ssh-config-file]` | 登记连接约定；transport 默认 direct；frp 端口必填，proxy-jump 必须提供跳板 |
| `connect profile update <profile> [--name] [--transport] [--target] [--port] [--user] [--proxy-jump] [--identity-file] [--known-hosts-file] [--ssh-config-file]` | 修改 Profile；不允许空更新 |
| `connect profile remove <profile> --yes` | 删除 Profile，不删除 Machine、Workspace 关系或外部资源 |
| `connect inspect <profile>` | 用 `ssh -G` 只读检查有效配置、身份/known_hosts 前提、ProxyJump 与 FRP visitor 端口；不连接远端 |
| `connect verify <profile>` | 执行一次 `ssh hostname` 验证；强制主机密钥校验，区分配置、认证、主机密钥、网络与目标状态；非 connected 以 2 退出 |
| `connect open <profile>` | 输出现有 OpenSSH 的原生命令入口；当前 CLI 不接管 Agent/Web 终端 |
| `gitea instance add <name> --base-url <url> [--credential-ref <name>]` | 登记 Gitea 实例；只保存地址与凭据名称，不验证网络、不保存 Token |
| `gitea instance list` | 列出实例配置；不发起网络请求 |
| `gitea instance show <instance>` | 查看实例配置；不验证可达性 |
| `gitea instance update <instance> [--name] [--base-url] [--credential-ref <name>\|none]` | 修改实例配置；Instance Identity 不变，`none` 清除凭据引用 |
| `gitea instance verify <instance>` | 只读校验实例版本与凭据；不读取仓库或触发 Actions；失败以 2 退出 |
| `gitea instance remove <instance> --yes` | 删除实例配置，不删除 Workspace 关系或外部仓库 |
| `gitea repo inspect <instance> <owner/repo>` | 按 owner/repo 查询仓库、默认分支与 Actions 状态；不可访问以 2 退出 |
| `gitea repo suggest <workspace> <location> [relative]` | 从本地 Git Remote 生成候选；只建议，不写关系 |
| `gitea repo link <workspace> <instance> <owner/repo>` | 显式关联已观察仓库；要求 Workspace 已选择 Gitea 提供方 |
| `gitea repo unlink <workspace> <relation-id> --yes` | 解除仓库关联，不删除实例或外部仓库 |
| `gitea repos <workspace>` | 列出 Workspace 的 Gitea 仓库关系；插件停用时仍显示长期关系并标记 unavailable |
| `gitea status <workspace>` | 聚合关联仓库与最近一次 Run 的 outcome；不表示部署成功 |
| `gitea runs <workspace> [relation-id] [--limit <count>]` | 查询近期 Run，默认每个仓库 10 条、上限 100；Gitea 列表超额时客户端截断 |
| `gitea run show <workspace> <relation-id> <run-id>` | 查看单条 Run 的状态、结论、提交、工作流与时间；不读取日志或 Artifact |
| `gitea ci <workspace> <location> [relative] [--limit <count>]` | 按本地 Git HEAD 查询关联仓库 CI；区分 empty、unmatched 与访问失败 |
| `session list` | 列出当前 DSH 来源可查询的 Session 元信息；不返回消息正文、工具参数或密钥 |
| `session show <session>` | 查看 Session 的 live/persisted/unavailable、cwd、创建时间与标题；不可访问时以 2 退出 |
| `session associate <workspace> <session>` | 显式把当前可访问的 Session 关联到 Workspace；不改变 Session 生命周期 |
| `session links <workspace>` | 列举已保存的 Session 关联；查询服务或插件缺失时仍显示关系并标记 unavailable |
| `session dissociate <workspace> <relation-id> --yes` | 仅解除该关联，不删除原生 Session、消息历史或其他 Workspace 的关联 |
| `session open <session>` | 返回原生 DSH 入口；持久 Session 给出 headless 继续命令，fork/subagent/无 cwd 明确不可用 |

`relative` 必须在登记范围内，链接不遍历。`fs`、`git`、`machine associate`、`session associate` 或 `gitea repo link` 提示“尚未启用能力”时，先运行 `capability configure <workspace> filesystem`（Git/Remote Machine/Connectivity/Session/Gitea 同样替换能力名），不必区分能力标识与具体提供方包。Session 的 `discover`/`show` 是只读查询，不要求能力选择；`associate` 才要求 Workspace 已选择提供方。Remote Machine 的登记、列表、资料与地址修改是领域操作，不要求 Workspace 选择；`associate` 才要求 Workspace 已选择提供方。Connectivity 的 Profile 增删改与检查不要求 Workspace 选择；它是 Machine 级配置，Workspace 通过 Machine 关系发现 Profile。Gitea 实例与仓库查询不要求 Workspace，`gitea repo link` 才要求能力选择；`gitea repos/status/runs` 只读取已保存关系。Filesystem 详细失败和范围语义见 [Plugin](../plugins/filesystem/README.md#读取与失败语义)；Git 支持与限制见 [Plugin](../plugins/git/README.md#观察语义)；Session 来源与返回限制见 [Plugin](../plugins/session/README.md#状态与返回)；Remote Machine 身份、地址与观察边界见 [Plugin](../plugins/remote-machine/README.md#身份地址与观察)；Connectivity 配置、检查、验证与 FRP 边界见 [Plugin](../plugins/connectivity/README.md#检查验证与入口)；Gitea 实例、仓库身份与 Actions 边界见 [Plugin](../plugins/gitea/README.md#仓库与-actions)。

Gitea 的 `--credential-ref` 只接受 POSIX 名称（例如 `GITEA_TOKEN`），不接收 Token 本身。DSH `credentials` 服务存在时优先解析；缺失值再回退到启动环境。`gitea status` 与 Run 查询只表示 Gitea Actions 事实，不建立 CI 与 Machine 的部署关系。

`workspace overview` 是聚合查询，单个来源或单个关联不可用仍返回 0，并在对应段标记 unavailable/error；Workspace 不存在、参数错误或整体聚合无法执行才返回 2。默认模式只读长期关系与已保存配置；`--observe` 的耗时按来源记录在 JSON `timings` 中，各段并发执行，总耗时不是简单相加。每个资源项在 JSON 中带 `actions`，人类输出在资源旁显示“下一步”；这些只是已有命令入口，不自动执行。`attention` 只列需要处理或注意的问题：缺少可选 Session/Profile 不当作异常，Gitea 同类认证/网络错误按状态合并，Plugin 未加载、未配置与原生资源不可访问分别表达。成功与否不改变任何关系、Profile、实例配置或原生资源。

`workspace overview` 的组合逻辑由 `@locus/application` 同时提供给 CLI 与本地 UI；CLI 只负责人类/JSON 投影，不在命令处理器中重新组合跨领域事实。UI 的 `GET /api/workspaces/:id/overview` 使用同一应用用例。UI 只监听 loopback，页面内嵌一次性会话令牌，API 不接受其他来源；调用要求确认的操作时必须显式 `confirm: true`。

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

未知子命令明确报告“未知命令”；无参数提示查看帮助，二者都退出 1。JSON stdout 不混入诊断；诊断写 stderr。能力提供方缺失不阻止 `workspace` 命令，保存的选择和引用保留。验证入口与分层见[测试系统](testing.md#分层与入口)。
