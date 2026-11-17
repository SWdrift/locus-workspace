# @locus/cli

## 简述与职责

独立 `locus` 可执行程序。负责参数/帮助、调用 Core／远程目标用例、人类/JSON 渲染、可信本地安全输入与原操作恢复；不直接写领域持久化，不实现第二套授权规则。

CLI 不依赖 DSH、Cordis 或插件装配。每次调用创建自己的 Core，命令完成后 `dispose()`；安全 Profile 只选择本地隔离数据与凭据命名空间，不是插件运行时。

## 构建与运行

```sh
pnpm install
pnpm build
pnpm locus --help
pnpm locus workspace list
pnpm locus template list
pnpm locus remote-targets list
pnpm locus shell <workspace>
pnpm locus get locus://info
```

`pnpm locus` 等价于 `node apps/cli/lib/index.js`，参数原样转发。包声明了 `locus` bin，供发布或外部安装后直接调用；当前仓库内统一使用 `pnpm locus`。完整命令、参数与成功判据由[命令手册](../../docs/commands.md#workspace-操作)维护；各层 `--help` 可查看用途与参数。

## 输出与确认

默认输出人类可读文本；`--json` 输出单行 JSON，诊断写 stderr，不混入提示或 ANSI。查询与写入都支持 JSON，创建和关系写入返回后续操作所需的 Identity/关系 ID。

普通命令不隐式等待输入；删除 Workspace、取消挂载、解除关系与移除远程目标必须携带 `--yes`。安全初始化及 Root 管理操作只在本地 TTY 隐藏输入，非 TTY 明确失败，不接受 argv/env/.env 密码。CLI 不保存隐式当前 Workspace，也不把上一条命令的选项带入下一条。

`locus get|post|put|patch|delete <uri...>` 直接调用 operation；多 URI 只允许 GET，非 GET 批量在 CLI 层拒绝。`--data` 与 `--file` 互斥，Body 只接受 `application/json` 与 `+json`；`--pretty` 只影响 JSON，`--human` 强制人类可读输出。URI、operation 与结果契约见[统一资源调用](../../docs/subsystems/invocation.md)。

退出码：0 表示调用成功；1 表示参数、帮助树或调用参数拒绝，如未知命令、缺参数、无效选项值、缺少 `--yes`、非法 URI／方法／媒体类型，以及 `component probe` 未通过、`component deploy` 失败；2 表示业务、授权或持久化失败；3 表示批量 GET 部分失败；`shell --command`、`remote-targets exec` 与 `remote-targets shell` 的子进程退出码原样返回。

## 统一 Shell

`locus shell <workspace>` 启动用户当前平台的 shell，并在子进程中注入：

- `PATH` 前置的临时 `locus` 启动器；
- `LOCUS_CLI`、`LOCUS_WORKSPACE_ID`、`LOCUS_WORKSPACE_NAME`、`LOCUS_WORKSPACE_ROOT`；
- `LOCUS_MOUNTS` 与每个挂载的 `LOCUS_MOUNT_<NAME>`。

`--shell <path>` 指定 shell；`--command <command>` 执行一条命令后退出，子 shell 退出码成为 CLI 退出码；`--print-env` 只输出上下文 JSON。第一个可访问挂载作为 `cwd`，缺失挂载会报告并跳过。完整契约见 [Skill Shell 参考](../../.agents/skills/locus/reference/shell.md)。

`--print-env` 包含继承环境；安全实现不把 Root 密码、Credential 或 Grant 放入环境，不能将此调试输出当作通用环境脱敏器。

## 安全 Host 与 Profile

仓库根 `.env` 不再随开发环境提供；开发 shell 使用 `.env.dev`（`LOCUS_HOME=temp/.locus`、开发用 `_LOCUS_ROOT_PASSWORD`），pro 使用 `.env.pro`（`LOCUS_HOME=~/.locus`），两者都由 bash/cmd 先加载，CLI 自身不读取。手工验证如果改用其他数据目录，应显式覆盖该变量或切换 CWD；不同初始化路径出现的 `security-uninitialized` 不是 Core 故障。开发环境变量与 Root 脚本约定见[开发与验证](../../docs/development.md)。


CLI 组合根只通过 Core 的 receiveHost 回调取得可信管理端口；组件不能接管输入或伪造认证成功。TTY 输入隐藏，Ctrl+C 取消并恢复终端；Core 不读 stdin。Root 认证后只用 resume(grant) 执行原操作，不能替换参数。`--grant-scope operation|session` 默认 operation；session 只在当前真实 Session 内复用，Session 结束、Root 重置或 Host 关闭即失效，不跨进程。CLI 每条命令创建并结束 Session，因此 session scope 不跨命令生效；复用要等常驻 Host。安全失败退出 2，`--json` stdout 含固定 code／可选 reason，诊断写 stderr，不输出秘密或后端异常对象。

全局 `--profile production|development` 默认 production，原有 LOCUS_HOME 解析保持不变；development 使用生产解析目录下的 `profiles/development/`，包含独立 SQLite 与安装 UUID，Keyring 命名空间也独立。Profile 名和 LOCUS_HOME 不是 OS 级隔离；真实 Keyring 测试另需独立 OS 账户。

`init`、`security reset-root/change-root-password`、`security operation set/reset`、`credential remove/status/cleanup` 是可信交互入口。`security operation list/set/reset` 需要加载全部包定义，因此按 `security` 命令域注册全集。`pg register/list` 当前只服务临时 PostgreSQL 验证消费者，验证完成后与包一起移除。`pg register` 通过 `pg://databases/<id>` operation 写入目标与字段并隐藏输入密码；`pg list` 以 User 级读取登记时固定的目标与绑定字段，调用者不能再指定 host、port 或 database。`credential list` 与 `credential bindings` 只查询公开 metadata 与 `component + slot + resourceKey` 绑定，不读取秘密；`credential cleanup` 只按当前精确 service 报告或删除未登记元数据的孤立账户；没有 `credential put/bind`，也没有 get-secret。

`security reset-root` 同时可经 `locus post locus://security/actions/reset-root` 调用。URL 入口要求可信 Host 收集 tty 字段 `password`、`confirmation` 与 `confirm`，且 `confirm` 必须为 `RESET ROOT`；命令别名会先显示本机接管警告并完成隐藏输入确认。两条路径都没有 `--yes` 绕过。完整命令和成功判据由[命令手册](../../docs/commands.md#安全与凭据)维护，模型和恢复后果见[安全子系统](../../docs/subsystems/core/security.md)。

## 项目模板

`locus template list` 列出内置模板；`locus template create <template> <destination>` 复制文件夹并写入 `.template.json`。`--dry-run` 只计算文件、目录与 digest。模板命令不读取或创建 Workspace，也不执行模板脚本；完整语义见 [Templates](../../packages/templates/README.md)。

## 远程目标

`locus remote-targets ...`（别名 `rt`）把目标登记与访问交给 `@locus/remote-targets`。定义保存在 `<dataDirectory>/remote-targets/targets.yaml`，探测结果保存在同目录 `state.sqlite`；CLI 只读取 `--spec` 并渲染结果，不解析目标字段。

`add --spec <file|->` 接受 YAML 或 JSON，要求在 Root 批准后同时写入配置与凭证字段；私钥用 `--file` 或等价的 `--credential-file` 提供（二者互斥），密码只走 TTY。`update-credential` 只更新凭证并重新确认目标安全摘要；`migrate` 显式导入旧文件后改写配置；目标 host/port/login、能力、客户端或信任锚变化后访问以 `target-config-mismatch` 失败，需 Root 重新 `update-credential` 或重新登记；`probe` 成功退出 0、失败退出 1；`services` 与 `restart` 只服务 `cmd` 目标；`exec` 与 `shell` 的远端退出码原样返回。命令语法见[命令手册](../../docs/commands.md#远程目标)，字段、默认值与失败码见 [Remote Targets](../../packages/remote-targets/README.md)。

## 组件

`locus component ...` 提供组件的发现、登记、升级与状态操作；`locus <id>` 对未知顶层命令解析为 `component show <id>`，不进入 `--help` 列表。

| 命令 | 用途 |
| --- | --- |
| `component list` | 列出包组件与动态组件；含状态时长，损坏定义以 `problems` 单独返回 |
| `component show <id>` / `locus <id>` | 定义、版本、外部/部署状态、配置路径与说明 |
| `component add <file\|dir\|->` | 登记动态组件；只接受 `kind: external` |
| `component upgrade <id>` | 按包代码重写定义字段，保留 `config` |
| `component remove <id> --yes` | 只删除动态组件定义与状态 |
| `component probe <id>` | 执行探针并记录；未通过退出 1 |
| `component probe --all` | 逐个探查 external 组件，跳过无探针定义；任一未通过退出 1 |
| `component deploy <id> --yes` | 执行部署入口并记录；失败退出 1 |

CLI 按顶层命令的包域注册包定义；首次访问组件服务时，把已注册的定义物化到 `<dataDirectory>/components/`。`component`、`security` 与未知组件入口注册全集，`pg`、`remote-targets`、`template` 只注册各自包；URL 动词与 `events` 使用默认全集。版本不一致只提示，`upgrade` 才改写；`version` 与 `--help` 不触发物化。组件字段、状态与失败边界见[组件子系统](../../docs/subsystems/core/components.md)，命令参数见[命令手册](../../docs/commands.md#组件操作)。

## 数据与生命周期

CLI 启动时只读取工作目录下可选的 `.env`（如存在），已存在的环境变量优先；仓库开发环境改用 shell 加载 `.env.dev`；`version` 与 `--help` 不创建目录或数据库。数据目录由 `LOCUS_HOME`（可为相对，按工作目录解析）与 `LOCUS_FOLDER_NAME`（数据文件夹名，缺省 `.locus-workspace`）决定，完整规则由 [Core](../../packages/core/README.md#使用)维护。组件定义位于数据目录的 `components/`，Remote Targets 使用 `remote-targets/` 子目录。持久化、版本、备份与恢复由 [Core](../../packages/core/README.md#持久化与恢复)维护，CLI 不复制这些规则。

## 验证

`pnpm test` 中的 CLI 用例通过真实子进程运行构建后的 bin，使用临时 `LOCUS_HOME` 覆盖版本、Workspace 读写、关系、挂载、shell 上下文、组件物化/登记/探针/部署/升级、远程目标登记与失败路径、JSON、退出码与跨进程恢复。验证入口见[测试系统](../../docs/testing.md#分层与入口)。
