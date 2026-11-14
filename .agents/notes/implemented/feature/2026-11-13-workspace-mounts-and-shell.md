# 决策记录：Workspace 挂载与统一 Shell

Status: implemented

## 问题

Workspace 已有稳定身份、成员/关联与独立 CLI，但没有目录上下文：用户无法把一个 Workspace 关联到多个本机项目，也没有在 Workspace 内连续操作的环境。移除 Filesystem 后，位置登记与观察也一并消失，简单恢复旧插件会重新引入宿主、Provider 与通用资源抽象。

需要在不建设虚拟文件系统、权限系统或第二运行时的前提下，交付三件事：

- 一套可脚本化的 Workspace 管理 CLI；
- 多个本机目录挂载；
- 一个统一 shell，把 Workspace、挂载与 `locus` 命令注入用户真实 shell；
- 一个 Agent Skill，分层索引 Workspace/Shell 用法与实用脚本。

## 决定

### 挂载属于 Core

`core.sqlite` 升到 `user_version=2`，新增 `mounts` 表：Workspace 作用域、名称与路径各自唯一、保存绝对路径与创建时间。挂载名称限制为字母/数字开头、字母/数字/下划线/短横线、最长 64 字符；省略名称时取目录名并安全化，冲突时追加 `-2`、`-3`。

Core 不检查目录是否存在，也不解释目录内容；路径存在性属于 shell 与使用方观察。同一路径重复挂载、同名挂载、相对路径明确失败。`workspaces.remove()` 在同一事务删除该 Workspace 的挂载、自有关系、其他 Workspace 指向它的 `locus.workspace` 关系与身份，不删除外部目录。

`user_version=1` 的现有库在打开时自动迁移到 2；若版本为 1 但已存在 `mounts` 表，或版本为 2 但缺少 `mounts` 表，拒绝继续而不覆盖。

### CLI 与名称解析

CLI 增加 `workspace remove`、`workspace mount`、`workspace mounts`、`workspace unmount` 与顶层 `shell`。所有接受 `<workspace>` 的命令同时接受稳定 Identity 或唯一名称；名称重复时失败并要求 Identity。挂载取消接受挂载 ID 或名称。删除、取消挂载与解除关系继续要求 `--yes`。

### 统一 Shell 的注入契约

`locus shell <workspace>` 使用用户真实 shell，不改写 `.bashrc`、PowerShell profile 或全局 PATH。子进程环境注入：

- `LOCUS_CLI`、`LOCUS_WORKSPACE_ID`、`LOCUS_WORKSPACE_NAME`、`LOCUS_WORKSPACE_ROOT`；
- `LOCUS_MOUNTS` 与每个挂载的 `LOCUS_MOUNT_<NAME>`；
- 临时 bin 目录置于 `PATH` 前部，内含 `locus` 启动器。

第一个可访问挂载作为 `cwd`；缺失挂载在 `missing` 中报告并跳过，没有任何可访问挂载时使用用户主目录。`--shell` 覆盖 shell，`--command` 执行一条命令并传播子 shell 退出码，`--print-env` 输出上下文 JSON 而不启动 shell。临时启动器随 shell 退出清理。

注入是环境与命令，不是权限、容器或文件系统沙箱；shell 内的 `cd` 与环境修改不回写 Workspace。

### Skill 与脚本

`.agents/skills/locus/` 是 Agent 入口：`SKILL.md` 提供分层索引，`reference/workspace.md` 与 `reference/shell.md` 记录 CLI 与注入契约，`scripts/` 提供 `workspace-pick`、`workspace-summary`、`shell-context`。脚本只调用 `locus --json` 或 `shell --print-env`，通过 `LOCUS_CLI` 或构建后的本地 CLI 运行，不直接访问 SQLite，也不复制领域规则。

## 备选方案

**把挂载保存在 CLI 配置文件。** 少一次 schema 迁移，但 Workspace 身份、关系与挂载分属两份持久化，删除/备份/并发都会分叉。挂载是 Workspace 的长期事实，放入 Core。

**恢复 Filesystem 插件与位置登记。** 能复用旧实现，但会重新引入宿主、Provider、观察与授权边界；当前只需要绝对路径引用与 shell 环境，不需要虚拟文件系统。

**用符号链接或自建虚拟路径统一多个目录。** 可以制造单一根，但跨平台链接权限、路径逃逸、远程目录与清理语义都会变成新产品面；挂载列表与环境变量已足够。

**在 Node 内实现命令循环或 REPL。** 可控但复制 shell 的历史、补全、作业控制与用户配置，且不是用户真实环境；改为启动真实 shell。

**通过 rc/profile 注入函数与 `cd` 辅助。** 能提供更顺手的导航，但会修改用户 shell 配置或依赖每个 shell 的启动文件差异；当前只注入环境与 `locus` 启动器。

**每个 Workspace 只允许一个根目录。** 实现最小，但用户明确需要挂载多个文件夹；多挂载是 Workspace 的核心语义。

**Skill 脚本直接读写 SQLite。** 少一次进程启动，但绕过 CLI 的校验、名称解析与退出码，形成第二个业务实现；脚本只消费 CLI JSON。

## 后果

收益：Workspace 可以组织多个本机目录，`locus shell` 让 CLI、挂载与 Agent 在同一上下文中工作；挂载与身份共用 Core 持久化、事务与备份；删除 Workspace 不会误删外部目录；Skill 与脚本共享 CLI 契约。

代价：挂载是主机本地事实，不随 Workspace 跨设备迁移；路径缺失不会自动清理；默认名称会安全化，非 ASCII 目录名可能退化为 `mount`，需要显式 `--name`；shell 注入不提供权限隔离；`user_version=1` 自动迁移仍是实验格式，升级前必须备份。

重新引入条件：出现跨设备挂载需求时再设计可移植引用与重新绑定，不把本机路径当跨设备身份；需要权限隔离时另建执行环境，不给 shell 注入增加隐式授权。

## 测试

- Core 测试覆盖挂载唯一性、默认名称、级联删除、v1→v2 迁移与释放边界。
- CLI 测试覆盖挂载/取消/删除、名称解析、`shell --print-env`、`locus` 启动器与子 shell 退出码。
- Skill 测试通过真实 CLI 与 `LOCUS_CLI` 运行 pick/summary/context 脚本。
- e2e 覆盖挂载、shell 上下文、跨进程恢复与删除。
- 手工验证：PowerShell 内 `locus version` 与 `Write-Output $env:LOCUS_WORKSPACE_NAME` 通过；`shell --command "exit 7"` 返回 7。
