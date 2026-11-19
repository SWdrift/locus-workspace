# 实用命令

本页登记当前命令语法与成功判据。环境准备见[开发与验证](development.md)，测试分层见[测试系统](testing.md)，调用协议与 operation 路由见[统一资源调用](subsystems/invocation.md)，领域语义链接 [Core](../packages/core/README.md)。

## 工程命令

| 命令 | 用途与成功判据 |
| --- | --- |
| `pnpm install` | 安装 workspace 依赖并链接本地包 |
| `pnpm build` | 编译 Core、PostgreSQL、Gitea、Remote Targets、Templates 与 CLI，退出 0 |
| `pnpm test` | 运行模块、CLI、跨包与 Skill 脚本测试，退出 0；范围见[测试系统](testing.md#分层与入口) |
| `pnpm test:all` | 全量进程内测试，经 `tests/run.mjs` 收集并记录，退出 0 |
| `pnpm e2e` | 真实 CLI 端到端测试，经 `tests/run.mjs` 执行；2 小时冷却未解除时退出 3 |
| `pnpm test:file <文件>` | 直接运行单个测试文件；可附加 `--test-name-pattern <模式>` |
| `pnpm lint` | 检查产品源码的公开入口与依赖边界 |
| `pnpm format` / `pnpm format:check` | 按根 Prettier 配置写入／检查产品源码格式 |
| `pnpm verify` | 快速门禁：`build` + `lint` + `format:check` + `test` + `docs:check` |
| `pnpm verify:full` | 完整门禁：`build` + `lint` + `format:check` + `test:all` + `docs:check` + `e2e` |
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
| `pnpm locus:purge --yes [--env <文件>] [--agent-dir <目录>] [--bin-dir <目录>]` | 删除数据目录与本脚本注册。没有 `--yes` 时只列出将删除的路径并退出 1；拒绝文件系统根、用户主目录和包含仓库的目录。OS Keyring 中的凭据秘密不在删除范围内，需要时使用 凭据绑定 DELETE 或 cleanup operation |
| `pnpm locus:backup [--env <文件>] [--dest <目录>]` | 备份整个数据目录到 `temp/locus-backup/<YYYYMMDD-HHmmss>`；同一秒冲突时追加序号。复制后核对条目、大小与修改时间，源目录在复制期间变化时删除副本并退出 1。备份包含 Root 离线验证材料，不含 Keyring 秘密与外部挂载目录 |

注册后重启 OMP 或开始新会话，Agent 才会加载安装的 Skill。备份要求没有 Locus 写者。构建产物或仓库路径变化后需要重新注册；`LOCUS_HOME` 变化时同样重新执行 `register`。

## URL 调用

默认命令面来自当前组件声明；先用 help 查看方法、URL 模板、认证与字段说明。五个方法入口只实现一次，新增 operation 不需要 CLI 代码。

```sh
locus --help
locus help
locus help rt://
locus help locus://workspaces
locus --json get locus://operations
locus --json locus://info
```

| 入口或参数 | 语义 |
| --- | --- |
| get/post/put/patch/delete <uri...> | 显式方法调用；多个 URL 只允许 GET |
| <uri> | 默认 GET，不推断写操作 |
| help [uri] | 无参数列出已注册域与路由数；给定 scheme:// 或资源 URL 时平铺显示声明；不执行 handler |
| --data <json> / --file <path或-> | 普通 JSON Body，互斥；- 从 stdin 读取 |
| --field-file <field=path> | 可重复；只用于 tty 且 file:true 的可信字段 |
| --prompt <field> | 可重复；显式选择可选的 TTY 字段 |
| --json / --pretty / --human | 信封 JSON／美化／强制人类输出，诊断仍写 stderr |

必需可信字段自动隐藏输入；同字段多来源和 Body 注入 tty 字段被拒绝。Root 密码不允许字段文件。所有普通数据由所属 schema 校验，不从内部 Zod 结构生成 flags。完整协议见[统一资源调用](subsystems/invocation.md)。

## Workspace 操作

```sh
locus post locus://workspaces --data '{"name":"研究"}'
locus get locus://workspaces
locus get locus://workspaces/<id>
locus patch locus://workspaces/<id> --data '{"name":"研究二"}'
locus post locus://workspaces/<id>/mounts --data '{"path":"/absolute/project","name":"project"}'
locus delete locus://workspaces/<id>/mounts/<mount>
locus delete locus://workspaces/<id>
```

资源规则归 [Core](../packages/core/README.md#workspace-与关系)。路径参数须 URL 编码，JSON 业务结果位于 data；旧 workspace 别名与 --yes 不再存在，显式写入方法表达调用意图。

## 安全与凭据

```sh
locus init
locus security reset-root
locus get locus://security
locus get locus://security/provider
locus get locus://security/operations
locus put locus://security/operations/<component>/<operation> --data '{"level":"root"}'
locus delete locus://security/operations/<component>/<operation>
locus post locus://security/actions/change-root-password
locus get locus://credentials
locus post locus://credentials/actions/cleanup --data '{"apply":false}'
```

除 init 和 security reset-root 外不保留安全领域别名。Root 密码与确认仅 TTY，非交互明确失败，不接受文件、Body 或环境密码。--profile production|development 与 --grant-scope operation|session 语义见 [CLI](../apps/cli/README.md#安全-host-与-profile)。清理 apply:true 和凭据删除必须得到明确授权；本机接管不接受 --yes 绕过。

## Shell

```sh
locus shell <workspace>
locus shell <workspace> --print-env
locus shell <workspace> --command "locus get locus://info"
```

--shell 指定解释器，--command 执行后退出，--print-env 只输出上下文。本地 shell 使用 UUID 或唯一名称，按挂载选择 cwd 并注入 LOCUS_*，不是沙箱；详情见 [CLI](../apps/cli/README.md#统一-shell)。

## 模板操作

```sh
locus help template://
locus get template://templates
locus post template://templates/minimal/instances --data '{"destination":"/absolute/project","dryRun":true}'
```

destination 必须是绝对路径，dryRun 是 Body 字段。复制、来源记录与失败语义归 [Templates](../packages/templates/README.md)。

## 远程目标

```sh
locus help rt://
locus get rt://targets
locus get rt://targets/<id>/system
locus put rt://targets/<id> --file registration.json --field-file privateKey=/absolute/key.pem
locus post rt://targets/<id>/actions/credential --data '{"method":"password"}' --prompt password
locus post rt://targets/<id>/jobs --data '{"command":["whoami"]}'
locus delete rt://targets/<id>
```

registration.json 的 Body 包含 spec 字符串；目标定义和凭据字段由组件校验。远端状态与 exitCode 位于 data，不透传为通用 CLI 退出码。交互 Shell 使用 jobs 的 interactive:true；凭据、迁移、信任与清理失败语义归 [Remote Targets](../packages/remote-targets/README.md)。

## 组件操作

```sh
locus help locus://components
locus get locus://components
locus get locus://components/docker
locus post locus://components --data '{"path":"/absolute/component.yaml"}'
locus post locus://components/docker/actions/probe
locus post locus://components/my-service/actions/deploy
locus post locus://components/remote-targets/actions/upgrade
locus delete locus://components/docker
```

探针和部署的业务结果在 data，调用成功不等于 healthy/deployed；只有用户明确要求时执行副作用。定义、物化和状态归[组件子系统](subsystems/core/components.md)。

## 事件

```sh
locus get 'locus://events?limit=20'
```

支持 type、subject、limit 查询。记录是 best-effort，不是完整审计或重放日志。

## 输出与退出码

调用 JSON 使用 InvocationResult，数据位于 data；help JSON 是描述数组，本地 Host 输入／认证失败按 code 诊断。退出码 0/1/2/3 分别表示 operation 成功、输入拒绝、业务或授权失败、批量部分失败；业务状态与远端进程退出码必须另外检查。本地 shell --command 仍透传子进程退出码。version 与帮助不创建数据目录，普通未知旧命令退出 1，不提供兼容翻译。
