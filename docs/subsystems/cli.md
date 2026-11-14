# 命令行（CLI）

## 范围与边界

CLI 是 Locus 的统一入口：把命令解析成领域调用，把结果投影成人类文本或 JSON，并在 Workspace 上下文中启动用户 shell。它当前覆盖 Workspace、项目模板、统一 shell 与远程目标，并为后续领域前缀预留位置。

| 组件 | 在本子系统中的职责 |
| --- | --- |
| `apps/cli` | 命令树、参数与名称解析、确认、渲染、退出码、shell 启动 |
| `packages/core` | Workspace、关系、挂载与持久化；CLI 只调用公开服务 |
| `packages/templates` | 模板复制与实例记录；CLI 解析目标路径并投影结果 |
| `packages/remote-targets` | 远程目标定义、校验、探测与执行；CLI 读取 `--spec` 并投影结果 |
| `.agents/skills/locus` | Agent 的调用参考与只读脚本；经 CLI 的 JSON 契约工作 |
| `docs/commands.md` | 命令语法与成功判据 |

CLI 不拥有领域规则，不直接写 `core.sqlite`，不保存隐式当前 Workspace，也不在命令之间保留状态。每次进程创建一个 Core，命令结束 `dispose()`；`version` 与 `--help` 不创建数据目录。模块用法见 [CLI README](../../apps/cli/README.md)，语法见[实用命令](../commands.md)，组件职责见[项目架构](../architecture.md#组件与依赖)。

## 设计原则

1. **领域前缀加动作**：形态固定为 `locus <domain> <action>`。顶层只保留 `version`、`shell` 与全局选项；新领域使用自己的前缀，不新增顶层动词。
2. **CLI 只做投影**：参数、确认、人类/JSON 渲染、退出码与 shell 注入归 CLI；创建、改名、关系、挂载与模板复制全部调用 Core 或 Templates 的公开服务。CLI 不复制业务组合，也不建立第二套持久化。
3. **人类默认，JSON 为契约**：默认可读文本；`--json` 输出单行对象；stdout 只写结果，stderr 写诊断；JSON 不混入提示、ANSI 或人类摘要。
4. **显式引用，无隐式当前对象**：每条命令都必须给出 Workspace、挂载或模板引用；不保存“上次使用的 Workspace”，不把上一条命令的选项带入下一条。
5. **不隐式等待**：单次命令在 TTY 与非 TTY 都不提示；删除 Workspace、取消挂载、解除关系必须显式携带 `--yes`。
6. **有限且稳定的退出码**：调用成功、用法拒绝与业务失败各自固定；子进程退出码原样透传，调用方可以据此判断。
7. **一次进程，无守护**：不做长驻服务、不做跨命令缓存、不自动重试；失败后由调用方重新执行。
8. **平台差异收在边界**：shell 选择、临时启动器与引号处理由 CLI 内部完成；命令面在 Windows 与 POSIX 保持一致。
9. **失败可判**：错误写 stderr，包含失败主体与原因；未知命令、歧义名称、缺少确认都不静默降级或自行修正输入。
10. **复杂输入用文档承载**：命令行只表达动作与定位；多字段输入用配置文件或 stdin 文档，不展开成长参数链。`remote-targets add --spec <file|->` 是首个实例。
11. **扩展在组合根**：新领域先建立普通 package，再在 CLI 组合根显式接入；不引入插件加载、动态注册或能力发现。

## 命令树

| 领域 | 动作 | 后端 |
| --- | --- | --- |
| `version` | 读取产品版本 | Core 信息 |
| `workspace` | `create`、`list`、`show`（别名 `open`）、`rename`、`remove`、`link`、`unlink`、`mount`、`mounts`、`unmount` | Core 的 Workspace、关系与挂载服务 |
| `template` | `list`、`create` | Templates |
| `remote-targets`（别名 `rt`） | `add`、`list`、`show`、`remove`、`probe`、`exec`、`shell` | Remote Targets |
| `shell` | 在 Workspace 上下文启动用户 shell | Core 挂载与 CLI 注入 |

`shell` 留在顶层是因为它服务于 Workspace 上下文，是既有入口；新的远端 shell 必须挂在自己的领域前缀下，避免与它语义冲突。参数、成功判据与失败码由[实用命令](../commands.md)维护，本节只描述命令树结构。

## 调用生命周期

1. 入口读取工作目录的 `.env`（不覆盖已有环境变量），再读取 argv 并调用 `createLocusCore()`；数据目录由 `LOCUS_HOME`（相对按工作目录解析）与 `LOCUS_FOLDER_NAME` 决定，缺省为 `~/.locus-workspace/`。读取版本或帮助不打开数据库。
2. 构造命令树并声明全局 `--json`；入口启用 `exitOverride()`，由 CLI 自己决定退出码。
3. 动作调用 Core、Templates 或 Remote Targets 的公开服务；CLI 不直接写 SQLite、模板文件或目标配置。
4. 结果经统一的 `emit()` 输出：JSON 为单行对象，否则为人类文本。
5. 错误按两类处理：Commander 的用法错误返回 `1`；其他异常写 stderr 并返回 `2`。`shell --command`、`remote-targets exec` 与 `remote-targets shell` 的子进程退出码原样返回。
6. `finally` 中释放 Core，数据库句柄与临时资源不跨命令保留。

## 输出与退出码

| 退出码 | 含义 | 触发 |
| --- | --- | --- |
| `0` | 成功 | 命令完成；查询空集合也算成功 |
| `1` | 参数或帮助树拒绝 | 未知命令、缺参数、非法选项值、缺少 `--yes`、`remote-targets probe` 失败 |
| `2` | 业务前置或持久化失败 | 名称歧义、找不到对象、重复挂载、模板目标已存在、文件系统或数据库失败 |
| 子进程退出码 | `shell --command`、`remote-targets exec`、`remote-targets shell` 的退出码 | 原样透传 |

单行 JSON 与人类文本都只写 stdout；诊断、缺失挂载提示与错误写 stderr。面向人的文案使用中文，标识符、命令与协议名保留原文。

## 名称解析与确认

- Workspace 引用优先匹配稳定 Identity；否则按名称匹配。多个同名 Workspace 时失败并要求使用 Identity，找不到时失败；不做模糊匹配。
- 挂载引用接受挂载 ID 或名称；模板引用接受内置 ID 或本地模板目录，路径存在时本地目录优先。
- 远程目标引用优先精确 id，其次唯一前缀，最后唯一标签；歧义时列出候选并失败。
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

Agent 以单行 JSON 为唯一机器接口：默认不提示、不等待输入，破坏性操作显式 `--yes`，stdout 可直接解析，stderr 只含诊断。需要读取 shell 上下文时使用 `--print-env`，需要跨进程恢复时重新查询 `workspace show`，不缓存派生状态。调用方式与硬规则由 [Locus Skill](../../.agents/skills/locus/SKILL.md)维护。

## 失败边界

失败发生在进入领域调用之前时，CLI 保证没有副作用；进入 Core 或 Templates 后，由各自的事务与临时目录约束保证不留下半成品。失败分类固定为用法拒绝、业务前置失败与持久化失败，消息只写 stderr，stdout 保持为空或保留完整结果。

CLI 不补偿已经成功的操作：模板在 rename 成功后不回滚，Workspace 删除也不恢复外部目录。调用方应按退出码与 stderr 判断，而不是把“命令返回”当作成功。

## 演进

新领域沿用 `locus <domain> <action>`，先建立普通 package，再在组合根注册命令；不增加隐式当前对象、插件加载器或第二套持久化。当前计划中的 `remote-targets` 领域在实现前不登记命令；其复杂输入按“文档承载 schema”的原则设计，避免长参数链。

## 验证

CLI 子进程用例位于 `apps/cli/test/`，通过真实子进程运行构建后的 bin，使用临时 `LOCUS_HOME` 覆盖版本、Workspace 读写、关系、挂载、shell 上下文、JSON 与退出码，并验证跨进程恢复；各模块命令域用例位于模块 `test/`。e2e 覆盖真实进程、完整命令链与 `pnpm locus` 包装。测试分层与运行约束见[测试系统](../testing.md#归属与去重)，快速门禁为 `pnpm verify`。
