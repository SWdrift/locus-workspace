# Workspace Foundation 验收记录

## 范围与环境

本记录只保存实际运行证据与复现入口，不维护产品规则或未来计划。当前行为由[架构](architecture.md)、各模块 README 和[命令手册](commands.md#workspace-操作)维护。

2026-11-08 至 2026-11-09，在 Windows 10.0.26200 x64、Node v26.13.0、pnpm 11.24.0、项目内 DSH 0.2.1-rc.5 / Cordis 4.0.5、Git 2.42.0.windows.2 上执行。内置 SQLite 探针返回 3.54.0。仓库没有配置 remote，未核对远端默认分支，不把工作树核实写成远端主线证据。

## 复现

先按[开发与验证](development.md#宿主运行)安装实际插件并合入[配置示例](../examples/locus.profile.yml)，在仓库根执行：

```sh
pnpm build
pnpm test
pnpm smoke:workspace
pnpm docs:check
```

验证分两层，避免为每个微场景启动完整 profile：

- `pnpm test` 使用隔离临时数据库、文件、Git 仓库和 Cordis Context，覆盖领域边界与**进程内 CLI 命令矩阵**。CLI 测试直接复用应用命令树和真实领域服务，不复制业务规则。
- `pnpm smoke:workspace` 只保留必须经过 launcher/profile 的链路：真实命令、退出码、跨进程恢复、插件停用、备份和只读 Git 组合。每次仍是独立 DSH 进程，但不重复已由测试覆盖的矩阵。

## 已观察结果

| 检查 | 实际结果 |
| --- | --- |
| 构建 | `pnpm build` 退出 0，实际生产者与消费者均编译 |
| 回归与 CLI 测试 | `pnpm test`：55 项，54 通过、0 失败、1 跳过；跳过 Windows 不适用的 POSIX 特殊文件场景 |
| 真实 profile 链路 | `pnpm smoke:workspace`：PASS，21 次独立 DSH 进程；正常及预期失败退出符合断言 |
| 身份与关系 | Workspace 可无目录；改名与跨进程重开不改 UUID；成员、仅关联、未确认发现保持区分；重复确认幂等；自引用被拒绝且不写入半条关系 |
| Filesystem 原生操作 | 真实单层发现、文件读取、范围越界拒绝；Windows `icacls` 拒绝读取时 inspect 为 denied、read 失败；恢复 ACL 后清理夹具 |
| 能力状态 | “声明”只来自已加载提供方；保存选择、配置、加载、可用性分别显示。插件停用后仍可打开 Workspace、查看关系与保存选择 |
| 生命周期与共享 | 取消一处关系/位置不删除共享文件或另一 Workspace 的关系；真实 Cordis 卸载/重载恢复身份与位置，重复提供服务失败，释放后用例不可继续使用 |
| 恢复 | 停止写者后复制整个数据目录到干净位置，身份、关系与位置配置一致；未知版本和损坏返回失败，未自动重建；0 字节初始化残留可安全建立当前结构 |
| 中断与并发 | 测试进程在真实 Core 库未提交事务中退出，重开仅保留已确认对象；写锁失败不丢既有数据；多连接读取最新提交 |
| Git 组合 | 真正 git init/commit/remote 后从 Filesystem 位置查询；分支、提交、dirty 与脱敏 Remote 正确；非仓库为正常状态；显式关联，关闭 Git 后 Filesystem 和关系仍可用 |
| Git 原生只读 | 实际测试包括 unborn/detached、缺失 Git、非仓库与格式/权限故障区分；查询前后 index/config 内容不变，fsmonitor 测试钩子未执行 |
| 应用交互 | 人类输出、独立 JSON、帮助、缺参数、未知命令、非法选项和缺 `--yes` 实际执行；非 TTY 不等待；`version` 保持 `0.0.0` |

## 独立复核与修正

首次使用者探针使用独立临时数据目录，逐个执行 create/open/configure/register/discover/confirm/link/read/git/unregister/restart。它暴露并促成以下修正：

- `capability list` 曾把“已保存选择”显示为“声明”。现在声明只来自当前已加载提供方；保存选择、配置、加载、可用性分别显示，测试覆盖启用与停用两种状态。
- `fs` / `git` 前置条件错误曾只提提供方包名。现在报告 Workspace、能力标识和配置动作，普通操作不需要先理解 Core 或 Provider 内部。
- 未知子命令曾报“参数过多”。现在明确“未知命令”；无参数提示查看帮助，均退出 1。
- `capability configure/remove` 接受能力标识与提供方包名，减少用户区分实现细节的负担。
- Core 拒绝把 Workspace 保存为自身成员/关联，避免无意义的自引用。
- 初始化中断可能留下 0 字节数据库；现在按空库建立结构，已有表结构但无版本仍拒绝覆盖，未知版本与损坏仍明确失败。
- 完整 profile 冒烟从 67 次启动缩减到 21 次；原矩阵移入进程内 CLI 测试，保留 launcher、重启和停用覆盖。

修正后测试、CLI 测试和真实 profile 均重新执行；没有为通过而放宽业务断言。

## 边界审查

- **Core 与领域 Plugin**：Core 只保存 Workspace 身份、关系、来源与能力选择，不解析路径或 Git 结构；Filesystem/Git 不写 Core 的长期事实，CLI 才调用关系用例。
- **Capability 与 Plugin**：Capability 标识稳定，Provider 是具体实现；Tag 只保存与展示，不参与依赖、授权或兼容判断。同能力不同提供方不会被自动替换。
- **Protocol 与 DSH**：服务通过 Cordis `provide`/`inject` 与 fiber 生命周期装配；Git 直接消费 Filesystem 服务；没有第二运行时、中央注册表或服务转发层。
- **状态所有权**：Core 与 Filesystem 各自拥有数据库，Git 不持久化观察；原生事实归外部系统。观察每次重读，不把缓存当当前状态；插件不可用不删除长期关系。

Blueprint 目前是[动作配方](../examples/README.md#可选的初始配置配方)，没有解析器或运行时依赖；修改或移除该示例不影响已有 Workspace。其复用价值限于文档化的操作顺序，尚未证明需要执行器。

## 存储与路径实验

未加锁的 JSON 读改写重现丢更新；SQLite 真实写事务能拒绝竞争写者，在未提交退出后回滚，并在关闭后复制恢复。该对比不代表 JSON 不能正确实现，而是本轮不再自建文件锁、提交及恢复协议，采用内置 SQLite 的成熟事务。

父子目录、大小写别名和 Windows junction 探针均实际执行。Windows `realpath` 可保留请求大小写，同一原生对象不保证同一返回字符串；因此位置按显式地址登记，不将别名自动合成全局对象身份。符号链接只观察不遍历；这不是抵御恶意并发路径替换的 OS 沙箱。

## 未验证或未交付

- Linux/macOS、其他 Node 版本、真实跨设备迁移/同步、在线多文件备份未验证。异机引用只验证了保留来源并拒绝本机同名重绑的当前策略。
- Git 仅支持当前本地工作树观察，未交付裸仓库状态面、写操作、fetch/push 或 Gitea/CI；没有真实远端认证验证。
- 当前授权是 OS 与原生系统逐操作判定，没有独立权限平台。不能从“已配置”推导已授权。
- Blueprint 没有执行器；多提供方仲裁、Web、Session 和其他候选仍属提案。
- Workspace 显式删除未实现；当前只解除关系/位置和取消能力选择。跨 Core 身份、Plugin 配置与外部资源的删除边界未设计，不能以“解除关系”冒充删除。
- CLI 每个用户操作仍对应一次 profile 启动；尚无面向 Agent 的批处理/长驻入口，资源成本见下方限制说明。
- 文档检查只证明机械约束；业务结论来自上述真实运行，不以文档检查代替产品验收。

## 运行成本

本次完整 profile 单次启动约 4–6 秒；缩减后的 21 次冒烟约 116 秒。该成本适合验收，不适合把每条命令都当作交互操作。若 Agent 需要连续操作，应另行设计长驻或批处理入口；不能用测试脚本的启动方式推断交互性能，也不应重新把完整矩阵塞回每次操作都启动 profile 的冒烟。
