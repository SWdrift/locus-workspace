# 实用命令

本页登记当前命令语法与成功判据。环境准备见[开发与验证](development.md)，测试分层见[测试系统](testing.md)，领域语义链接 [Core](../packages/core/README.md)。

## 工程命令

| 命令 | 用途与成功判据 |
| --- | --- |
| `pnpm install` | 安装 workspace 依赖并链接本地包 |
| `pnpm build` | 编译 Core、PostgreSQL、Gitea、Remote Targets、Templates 与 CLI，退出 0 |
| `pnpm test` | 运行模块、CLI、跨包与 Skill 脚本测试，退出 0；范围见[测试系统](testing.md#分层与入口) |
| `pnpm test:all` | 全量进程内测试，经 `tests/run.mjs` 收集并记录，退出 0 |
| `pnpm e2e` | 真实 CLI 端到端测试，经 `tests/run.mjs` 执行；2 小时冷却未解除时退出 3 |
| `pnpm test:file <文件>` | 直接运行单个测试文件；可附加 `--test-name-pattern <模式>` |
| `pnpm verify` | 快速门禁：`build` + `test` + `docs:check` |
| `pnpm verify:full` | 完整门禁：`build` + `test:all` + `docs:check` + `e2e` |
| `pnpm locus <参数>` | 运行构建后的独立 CLI，等价于 `node apps/cli/lib/index.js` |
| `pnpm locus:register` | 安装本机 Skill 与 `locus` 启动器；默认读取 `.env.pro`，退出 0 |
| `pnpm locus:unregister` | 删除本机注册的 Skill 与启动器，保留数据目录；退出 0 |
| `pnpm locus:purge --yes` | 删除本机注册、`--env` 解析出的数据目录；没有 `--yes` 只列出计划并退出 1 |
| `pnpm locus:backup` | 按时间戳把 `--env` 解析出的数据目录备份到 `temp/locus-backup/`，退出 0 |
| `pnpm docs:check` | Markdown 结构、链接与 Agent Notes 生命周期检查通过 |
| `pnpm docs:test` | 文档检查器测试通过；仅修改检查器时要求执行 |

## 本机注册与备份

`scripts/local.mjs` 与 `scripts/backup.mjs` 默认读取仓库根 `.env.pro`，相对 `--env` 按当前工作目录解析；`LOCUS_HOME` 中的 `~` 由脚本展开。文件不存在时输出最小创建示例并退出 1。测试数据位于 `temp/.locus`，对应 `.env.dev`；需要操作它时显式传 `--env .env.dev`。环境文件的开发与生产约定见[开发与验证](development.md#开发环境与-_locus_root_password)。

| 命令 | 行为与成功判据 |
| --- | --- |
| `pnpm locus:register [--env <文件>] [--agent-dir <目录>] [--bin-dir <目录>] [--force]` | 把 `.agents/skills/locus` 复制到 `PI_CODING_AGENT_DIR`（缺省 `~/.omp/agent`）的 `skills/locus`，写入安装标记；把 `locus` 启动器写入 `~/.local/bin`（Windows 为 `locus.cmd`）。调用者未设置 `LOCUS_HOME` 时，启动器使用环境文件解析出的目录；显式设置时沿用调用者环境。启动器不注入 Root 密码。要求 `pnpm build` 产物存在；已存在非本脚本管理的 Skill 或启动器时拒绝覆盖，`--force` 才替换 |
| `pnpm locus:unregister [--agent-dir <目录>] [--bin-dir <目录>] [--force]` | 只删除本脚本注册的 Skill 与启动器；数据目录保留。非本脚本管理的目标同样需要 `--force` |
| `pnpm locus:purge --yes [--env <文件>] [--agent-dir <目录>] [--bin-dir <目录>]` | 删除数据目录与本脚本注册。没有 `--yes` 时只列出将删除的路径并退出 1；拒绝文件系统根、用户主目录和包含仓库的目录。OS Keyring 中的凭据秘密不在删除范围内，需要时使用 `credential remove` 或 `credential cleanup` |
| `pnpm locus:backup [--env <文件>] [--dest <目录>]` | 备份整个数据目录到 `temp/locus-backup/<YYYYMMDD-HHmmss>`；同一秒冲突时追加序号。复制后核对条目、大小与修改时间，源目录在复制期间变化时删除副本并退出 1。备份包含 Root 离线验证材料，不含 Keyring 秘密与外部挂载目录 |

注册后重启 OMP 或开始新会话，Agent 才会加载安装的 Skill。备份要求没有 Locus 写者。构建产物或仓库路径变化后需要重新注册；`LOCUS_HOME` 变化时同样重新执行 `register`。

## Workspace 操作

数据目录、首次打开时机与恢复由 [Core](../packages/core/README.md#持久化与恢复)维护。`--json` 可放在子命令前，得到单行 JSON；人类输出与 JSON 都只写 stdout。

| 参数 | 行为与成功判据 |
| --- | --- |
| `version` | stdout 根 `package.json` 的 `version`、退出 0；不创建数据目录；来源见[版本管理](versioning.md) |
| `workspace create <name>` | 返回具有稳定 UUID 的新 Workspace，不要求目录 |
| `workspace list` | 列出长期 Workspace 与挂载数量；空集合不是错误 |
| `workspace show <workspace>` / `workspace open <workspace>` | 按 Identity 或唯一名称查看挂载与长期关系 |
| `workspace rename <workspace> <name>` | 改名，Identity 不变 |
| `workspace remove <workspace> --yes` | 删除 Workspace 及自有挂载/关系，不删除外部目录 |
| `workspace mount <workspace> <path> [--name <name>]` | 挂载本机绝对目录；名称默认取目录名 |
| `workspace mounts <workspace>` | 列出挂载与路径 |
| `workspace unmount <workspace> <mount> --yes` | 取消挂载，接受挂载 ID 或名称；不删除目录 |
| `workspace link <workspace> <namespace> <reference> [--kind member\|association] [--source <说明>]` | 显式保存外部引用；默认 association；引用 Workspace 使用 namespace `locus.workspace` |
| `workspace unlink <workspace> <relation-id> --yes` | 仅解除该关系，不删除目标或其他归属 |

## 安全与凭据

以下参数接在 `locus` 后；全局 `--profile production|development` 默认 production，development 数据隔离见 [CLI](../apps/cli/README.md#安全-host-与-profile)。Root 密码与凭据秘密只由可信本地 TTY 隐藏输入；非交互失败，不支持通过 argv、环境变量、`.env` 或普通 stdin spec 提交。`--grant-scope operation|session` 默认 operation；operation 按单次操作生效，session 只在当前真实 Session 内复用，Session 结束、Root 重置或 Host 关闭即失效，不跨进程；CLI 每条命令结束 Session，因此不跨命令生效。

### 组件命令

`pg` 当前只用于临时 PostgreSQL 验证消费者；权限控制面验证完成后命令与包会一起移除，不作为长期稳定依赖。

| 参数 | 行为与成功判据 |
| --- | --- |
| `pg register <resource> --host <host> --database <name> [--port <port>] --username <name> [--credential <ref>]` | Root 批准并隐藏输入 PostgreSQL 密码；一次登记 `database-auth` 的可信目标、公开用户名与秘密密码，并为 `register` 与 `list` 建立精确绑定 |
| `pg list <resource> [--sql <sql>] [--credential <ref>]` | User 级读取登记时固定的目标与绑定字段，使用真实 `pg.Pool` 连接；调用者不能再指定 host、port 或 database；缺少绑定或字段不匹配时不触发 Root |
| `security capability list` | 列出组件能力、默认等级、Root 覆盖与最终来源；需要已初始化 Root 元数据 |
| `security capability set <component:capability> <user\|root>` | Root 覆盖该能力的认证等级；`write` 能力默认 root，Root 降为 user 即显式委派覆盖权，覆盖是预期行为 |
| `security capability reset <component:capability>` | Root 清除覆盖，恢复组件 `defaultAuthLevel` 或 `user` |

### Root 诊断

| 参数 | 行为与成功判据 |
| --- | --- |
| `init` | 两次隐藏输入，初始化 Root／默认 User 与安装身份；重复调用不覆盖，不删除已有 Workspace |
| `security status` | 查询初始化、Profile 与固定身份，不输出验证材料；空目录不建库 |
| `security change-root-password` | 输入新密码后以旧 Root 密码认证，单次恢复原密码变更，旧授权失效 |
| `security reset-root` | 显示本机管理接管警告，TTY 确认后替换密码；无旧密码，无 `--yes` 绕过，不删除 Workspace／Keyring |
| `credential provider-status` | 查询 Provider／后端声明与绑定加载状态；unverified 不等于真实后端已可用，不读取任何条目 |
| `credential list` | 只输出当前 Profile 的引用元数据与公开字段，不读取秘密 |
| `credential bindings` | 列出组件能力、slot、精确资源与引用，不读取秘密 |
| `credential remove <credential:id>` | Root 授权删除条目、引用元数据与关联绑定，不输出原值 |
| `credential status <credential:id>` | Root 检查元数据与 Provider 条目是否存在，只返回 `present`，不输出秘密 |
| `credential cleanup [--yes]` | Root 检查当前 Profile 精确 Keyring service 下未登记元数据的孤立账户；无 `--yes` 只报告，`--yes` 才删除孤立条目；不删除已知凭据、元数据或绑定 |

普通业务凭据使用组件命令，不提供 `credential put`、`credential bind` 或 get-secret。`credential cleanup` 只按当前安装 UUID 与 Profile 推导出的完整 service 操作，不接受 `locus*` 前缀批量删除，也没有 `--all` 清空当前 Service；已知凭据用 `credential remove`。Provider 的平台容量限制独立判定，超限不分片、不回退明文。丢失重置与备份后果见[安全设计](subsystems/core/security.md#root-认证与恢复)。

## Shell

`locus shell <workspace>` 启动用户当前平台的 shell 并注入 Workspace 上下文；`<workspace>` 接受 Identity 或唯一名称。

| 参数 | 行为与成功判据 |
| --- | --- |
| `shell <workspace>` | 进入交互 shell；第一个可访问挂载作为 `cwd`，缺失挂载写 stderr |
| `shell <workspace> --shell <path>` | 使用指定 shell 可执行文件 |
| `shell <workspace> --command <command>` | 执行一条命令后退出；CLI 退出码取子 shell 退出码 |
| `shell <workspace> --print-env` | 只输出上下文 JSON，不启动 shell |

注入清单、缺失挂载与能力边界见 [CLI Shell](../apps/cli/README.md#统一-shell)与 [Skill Shell 参考](../.agents/skills/locus/reference/shell.md)。

## 模板操作

模板命令只操作文件系统，不读取或创建 Workspace。`<template>` 可以是内置 ID（如 `minimal`）或本地模板目录；`<destination>` 相对路径按当前进程目录解析，目标必须不存在。

| 参数 | 行为与成功判据 |
| --- | --- |
| `template list` | 列出内置模板；空集合不是错误 |
| `template create <template> <destination>` | 复制文件夹，写入 `.template.json` 来源记录 |
| `template create ... --dry-run` | 只计算文件、目录与 digest，不写目标 |

完整格式、排除规则与失败见 [Templates](../packages/templates/README.md)。

## 远程目标

目标定义保存在 `<dataDirectory>/remote-targets/targets.yaml`，探测结果保存在同目录 `state.sqlite`；`dataDirectory` 由 `LOCUS_HOME` / `LOCUS_FOLDER_NAME` 决定，见 [Core](../packages/core/README.md#持久化与恢复)。`remote-targets` 可缩写为 `rt`；`<target>` 接受 id、唯一前缀或唯一标签，歧义时失败并列出候选。`--json` 输出单行 JSON。

| 参数 | 行为与成功判据 |
| --- | --- |
| `remote-targets add <id> --spec <file\|-> [--file <path>] [--dry-run]` | 校验目标；Root 批准后同时写入配置与凭证字段，要求 CredentialRef；私钥必须用 `--file`，密码隐藏输入；`--dry-run` 只校验不落盘 |
| `remote-targets update-credential <target> --credential <ref> --method private-key\|password [--file <path>]` | 只更新目标已引用的私钥或密码字段，不改目标配置；同时由 Root 重新确认当前目标安全摘要；别名 `register` |
| `remote-targets list` | 列出目标；空集合不是错误 |
| `remote-targets show <target>` | 显示身份、CredentialRef、能力、连接与最近探测；不输出凭据值 |
| `remote-targets migrate <target> --credential <credential:id> --yes` | 显式导入旧凭据文件到 Core、回读验证、绑定目标资源后改写配置；原文件保留；带口令私钥明确阻塞 |
| `remote-targets remove <target> --yes` | 只移除定义，不删除外部目标或 Core 绑定；复用 id 前重新登记正确引用或由 Root 删除旧凭据 |
| `remote-targets probe <target>` | 执行 `whoami` 并记录结果；成功退出 0，失败退出 1 |
| `remote-targets exec <target> [command...]` | 执行远端命令；远端退出码原样返回；命令选项放在 `--` 之后 |
| `remote-targets shell <target>` | 进入交互 Shell；退出码取客户端退出码 |

字段、默认值与失败码见 [Remote Targets](../packages/remote-targets/README.md#配置与契约)。

密钥认证要求 `openssh` 组件为 `healthy`，密码认证要求 `plink` 组件；随后通过 Core 主体授权与凭据绑定，未初始化时需先在本地 TTY 运行 init。普通 User 访问不触发 Root；没有授权入口或绑定不能启动客户端。新目标只接受 `method: private-key|password` 与 `credential:<id>`；旧 `auth.path/root` 仅供 `migrate` 读取。目标 host/port/login、能力、客户端或信任锚变化后，访问以 `target-config-mismatch` 失败，需 Root 重新执行 `update-credential` 或重新登记。迁移与阻塞条件见 [Remote Targets](../packages/remote-targets/README.md#凭据交付与迁移)。

## 组件操作

组件定义位于 `<dataDirectory>/components/`：包组件在首次访问组件服务时物化，动态组件通过 `component add` 登记。版本不一致只标记“需要升级”，由 `component upgrade` 手动改写；字段、状态与失败边界见[组件](subsystems/core/components.md)。

| 参数 | 行为与成功判据 |
| --- | --- |
| `component list` | 列出包组件与动态组件；人类输出含状态时长；空集合不是错误，损坏定义进入 problems |
| `component show <id>` / `<id>` | 显示定义、版本、外部/部署状态、配置路径与说明；`<id>` 只在未知顶层命令时解析 |
| `component add <file\|dir\|->` | 校验并登记 `kind: external` 组件；`-` 从 stdin 读取；已存在则失败 |
| `component upgrade <id>` | 按包代码重写定义字段、保留 `config`、更新 `version`；动态组件明确拒绝 |
| `component remove <id> --yes` | 只删除动态组件定义与状态，不卸载外部软件 |
| `component probe <id>` | 执行声明的探针并记录状态；未通过退出 1；`locus` 组件按 `requires` 派生 |
| `component probe --all` | 逐个探查所有 `external` 组件；无探针的定义跳过；任一未通过退出 1 |
| `component deploy <id> --yes` | 执行声明的部署入口并记录结果；失败退出 1 |

示例组件位于仓库 `examples/components/`（`docker.yaml`、`openssh.yaml`、`plink.yaml`、`postgres-service.yaml`），复制到其他机器后需重新登记与探测。

## 输出与退出码

默认输出人类可读文本；`--json` 输出独立 JSON，诊断写 stderr。普通命令不隐式等待输入，安全交互命令使用可信 TTY；删除 Workspace、取消挂载、解除关系与移除远程目标必须显式携带 `--yes`。安全失败的 JSON stdout 含 code／reason，不能按普通命令失败时 stdout 总为空处理。

退出码：0 表示调用成功；1 表示参数/帮助树拒绝，包括未知命令、缺参数、无效选项值与缺少 `--yes`，以及 `remote-targets probe`、`component probe` 未通过、`component deploy` 失败；2 表示业务前置条件或持久化失败；`shell --command`、`remote-targets exec` 与 `remote-targets shell` 的子进程退出码原样返回。
