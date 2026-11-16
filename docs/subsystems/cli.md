# 命令行（CLI）

## 范围与边界

CLI 是 Locus 的统一入口：把命令解析成领域调用，把结果投影成人类文本或 JSON，并提供 Workspace shell 与本地可信安全 Host。当前覆盖 Workspace、组件、项目模板、远程目标、PostgreSQL 组件命令和安全／凭据诊断。

| 组件 | 在本子系统中的职责 |
| --- | --- |
| `apps/cli` | 命令树、参数与名称解析、确认、渲染、退出码、shell 启动 |
| `packages/core` | Workspace、组件、统一权限平面、凭据保管与持久化；CLI 只调用公开服务及可信组合根 Host 端口 |
| `packages/postgres`、`packages/gitea` | Compose 能力、凭据字段与 handler；CLI 调用 `api`，不决定权限 |
| `packages/templates` | 模板复制与实例记录；导出 `locus` 组件定义；CLI 解析目标路径并投影结果 |
| `packages/remote-targets` | 远程目标定义、校验、探测与执行；导出 `locus` 组件定义；CLI 读取 `--spec` 并投影结果 |
| `.agents/skills/locus` | Agent 的调用参考与只读脚本；经 CLI 的 JSON 契约工作 |
| `docs/commands.md` | 命令语法与成功判据 |

CLI 不拥有领域规则，不直接写 `core.sqlite`，不保存隐式当前 Workspace，也不在命令之间保留状态。每次进程创建一个 Core，命令结束 `dispose()`；`version` 与 `--help` 不创建数据目录。模块用法见 [CLI README](../../apps/cli/README.md)，语法见[实用命令](../commands.md)，组件职责见[项目架构](../architecture.md#组件与依赖)。

## 设计原则

1. **领域前缀加动作**：普通领域采用 `locus <domain> <action>`；顶层保留 version、shell、一次性安全初始化 init 和组件只读投影，不按内部类型扩张命令数量。
2. **CLI 只做投影**：参数、确认、人类/JSON 渲染、退出码与 shell 注入归 CLI；创建、改名、关系、挂载与模板复制全部调用 Core 或 Templates 的公开服务。CLI 不复制业务组合，也不建立第二套持久化。
3. **人类默认，JSON 为契约**：默认可读文本；`--json` 输出单行对象；stdout 只写结果，stderr 写诊断；JSON 不混入提示、ANSI 或人类摘要。
4. **显式引用，无隐式当前对象**：每条命令都必须给出 Workspace、挂载或模板引用；不保存“上次使用的 Workspace”，不把上一条命令的选项带入下一条。
5. **输入分边界**：普通命令不提示；删除 Workspace 等显式携带 `--yes`。安全管理只由本地可信 TTY 隐藏输入，非交互明确失败，不能用 --yes 跳过 Root 认证。
6. **有限且稳定的退出码**：调用成功、用法拒绝与业务失败各自固定；子进程退出码原样透传，调用方可以据此判断。
7. **一次进程，无守护**：不做长驻服务、不做跨命令缓存、不自动重试；失败后由调用方重新执行。
8. **平台差异收在边界**：shell 选择、临时启动器与引号处理由 CLI 内部完成；命令面在 Windows 与 POSIX 保持一致。
9. **失败可判**：错误写 stderr，包含失败主体与原因；未知命令、歧义名称、缺少确认都不静默降级或自行修正输入。
10. **复杂输入用文档承载**：业务多字段输入用配置文件或 stdin 文档；Root 密码是例外，绝不能通过这些普通输入通道提供。
11. **扩展在组合根**：独立消费者能力建立普通 package，`defineComponent` 返回 `component` 与 `api`；CLI 在组合根显式接入并在 `apps/cli` 定义命令，组件不注册 CLI，也不加载插件代码。

## 命令树

| 领域 | 动作 | 后端 |
| --- | --- | --- |
| `version` | 读取产品版本 | Core 信息 |
| `init`、`security`、`credential` | 本地初始化、状态、Root 管理、能力等级覆盖与凭据诊断／清理 | Core Security 与可信 CLI Host；完整语法归命令手册 |
| `pg` | `register`、`list` | PostgreSQL 组件 `api`，经统一 `executeComponent` 与 Root 提权 |
| `workspace` | `create`、`list`、`show`（别名 `open`）、`rename`、`remove`、`link`、`unlink`、`mount`、`mounts`、`unmount` | Core 的 Workspace、关系与挂载服务 |
| `template` | `list`、`create` | Templates |
| `remote-targets`（别名 `rt`） | `add`、`update-credential`、`list`、`show`、`migrate`、`remove`、`probe`、`exec`、`shell` | Remote Targets 与 Core 能力登记 |
| `component` | `add`、`list`、`show`、`upgrade`、`remove`、`probe`、`deploy` | Core 组件服务 |
| `shell` | 在 Workspace 上下文启动用户 shell | Core 挂载与 CLI 注入 |

`locus <id>` 只对未知顶层命令解析为 `component show <id>`，不进入 `--help`；包组件与已登记动态组件都可用。`component` 的命令语法与成功判据见[实用命令](../commands.md#组件操作)。CLI 组合根注册 `templates`、`remote-targets`、`postgres` 与 `gitea` 包定义；组件命令只调用对应 `api`，不直接访问 Keyring。组件包不包含 CLI 命令、参数、提示或退出码，`component.info` 也不列 CLI 用法。

`shell` 留在顶层是因为它服务于 Workspace 上下文，是既有入口；新的远端 shell 必须挂在自己的领域前缀下，避免与它语义冲突。参数、成功判据与失败码由[实用命令](../commands.md)维护，本节只描述命令树结构。

## 调用生命周期

1. 入口读取工作目录的 `.env`（不覆盖已有环境变量），解析受限 Profile 后同步装配 Core，显式注入包定义并通过闭包取得 Host。数据目录与 Profile 规则归 [CLI README](../../apps/cli/README.md#安全-host-与-profile)，读取版本或帮助不建库、不物化组件。
2. 构造命令树时在创建子命令前启用 exitOverride；声明全局 `--json`／`--profile`，由入口决定退出码并保证 finally 释放。
3. 动作调用 Core、Templates 或 Remote Targets 的公开服务；首次访问组件服务时由 Core 物化包定义。CLI 不直接写 SQLite、组件定义、模板文件或目标配置。
4. 结果经统一的 `emit()` 输出：JSON 为单行对象，否则为人类文本。
5. Commander 用法错误返回 1；业务／安全失败返回 2，安全错误在 JSON stdout 提供固定 code／reason，诊断仍在 stderr。子进程退出码原样返回。
6. `finally` 中释放 Core，数据库句柄与临时资源不跨命令保留。

## 输出与退出码

| 退出码 | 含义 | 触发 |
| --- | --- | --- |
| `0` | 成功 | 命令完成；查询空集合也算成功 |
| `1` | 参数或帮助树拒绝 | 未知命令、缺参数、非法选项值、缺少 `--yes`、`remote-targets probe` 失败、`component probe` 未通过、`component deploy` 失败 |
| `2` | 业务前置或持久化失败 | 名称歧义、找不到对象、重复挂载、模板目标已存在、文件系统或数据库失败 |
| 子进程退出码 | `shell --command`、`remote-targets exec`、`remote-targets shell` 的退出码 | 原样透传 |

单行 JSON 与人类文本都只写 stdout；诊断、缺失挂载提示与错误写 stderr。面向人的文案使用中文，标识符、命令与协议名保留原文。

## 名称解析与确认

- Workspace 引用优先匹配稳定 Identity；否则按名称匹配。多个同名 Workspace 时失败并要求使用 Identity，找不到时失败；不做模糊匹配。
- 挂载引用接受挂载 ID 或名称；模板引用接受内置 ID 或本地模板目录，路径存在时本地目录优先。
- 远程目标引用优先精确 id，其次唯一前缀，最后唯一标签；歧义时列出候选并失败。
- 组件引用使用稳定 id；`locus <id>` 只接受已注册的包组件或数据目录中存在的定义，拼写错误不会创建数据目录。
- 删除 Workspace、取消挂载、解除关系与移除远程目标必须携带 `--yes`；CLI 不进入交互确认，脚本与 Agent 的行为一致。
- 名称解析失败不自动创建对象，也不回退到其他同名或最近使用的对象。

## 统一 Shell

`locus shell <workspace>` 启动用户当前平台的 shell，并注入 Workspace 上下文：

- 临时目录写入 `locus` 与 `locus.cmd` 启动器，前置到 `PATH`，不依赖全局安装；
- `LOCUS_CLI`、`LOCUS_WORKSPACE_ID`、`LOCUS_WORKSPACE_NAME`、`LOCUS_WORKSPACE_ROOT`；
- `LOCUS_MOUNTS` 与每个挂载的 `LOCUS_MOUNT_<NAME>`，名称冲突时追加序号。

shell 选择顺序为 `--shell`、`$SHELL`、平台默认（Windows 为 `powershell.exe`，POSIX 为 `/bin/sh`）；按 shell 类型选择交互与命令参数。工作目录取第一个可访问挂载，否则使用用户主目录；缺失挂载写 stderr 并跳过。`--command` 执行一条命令后退出，`--print-env` 只输出上下文 JSON。

注入的是环境与命令，不是权限沙箱；CLI 不修改 shell profile、不提升权限，也不替用户改写挂载路径。

## Agent 投影

Agent 以单行 JSON 为机器接口，普通工作与 Human 共用 User 权限；Root 输入只能由本地可信 Host 完成，不能把密码放 Prompt、参数或环境。非交互认证失败不静默跳过，也不建设审批队列。shell 环境不是 Session／Grant，`--print-env` 不得携带秘密；完整边界归 [Core Security](core-security.md)。

## 失败边界

失败发生在进入领域调用之前时不执行原操作；进入领域后由所属模块定义事务和释放边界。Credential Provider 与 SQLite 不是跨系统事务，不能承诺所有失败都无残留。安全错误只输出固定分类，不透传后端异常；JSON 失败 stdout 可以含完整 code／reason 对象。

CLI 不补偿已经成功的操作：模板在 rename 成功后不回滚，Workspace 删除也不恢复外部目录。调用方应按退出码与 stderr 判断，而不是把“命令返回”当作成功。

## 演进

新领域沿用 `locus <domain> <action>`，先建立普通 package、导出组件定义，再在组合根注册命令；不增加隐式当前对象、插件加载器或第二套持久化。组件的定义、状态与升级边界见[组件](components.md)，此处只描述 CLI 投影。

## 验证

CLI 子进程用例位于 `apps/cli/test/`，通过真实子进程运行构建后的 bin，使用临时 `LOCUS_HOME` 覆盖版本、Workspace 读写、关系、挂载、shell 上下文、组件物化/登记/探针/部署/升级、JSON 与退出码，并验证跨进程恢复；各模块命令域用例位于模块 `test/`。e2e 覆盖真实进程、完整命令链与 `pnpm locus` 包装。测试分层与运行约束见[测试系统](../testing.md#归属与去重)，快速门禁为 `pnpm verify`。
