# @locus/remote-machine

## 简述与职责

第一个面向外部机器的 Capability：显式登记机器、保存 Locus 管理身份与多个地址、把不透明引用交给 Workspace 关联，并按需通过 OpenSSH 做只读观察。机器不由 hostname、IP、SSH 地址或 Workspace ID 定义；登记不要求 SSH 配置、连接成功或机器当前在线。

Plugin 只拥有机器资料与地址，不拥有 SSH 配置、凭据、连接生命周期或远端执行。Workspace 关联仍由 Core 的长期关系保存；本 Plugin 不读写 Core 数据库。

## 装配与使用

按[开发与验证](../../docs/development.md#宿主运行)将本包链接到项目内 `locus` profile 并合入插件行。Plugin 注入 `locus`，提供 `locusRemoteMachine`；Capability 为 `locus.remote-machine`，提供方 `@locus/remote-machine`，Tag `environment` 仅分类。

`machine register` 建立机器资料，不需要 Workspace 或 OpenSSH；`machine associate` 才要求目标 Workspace 已选择本提供方。注册是全局机器登记，不因某个 Workspace 解除关联而删除。CLI 语法由[命令手册](../../docs/commands.md#workspace-操作)维护；非终端调用使用 `createRemoteMachineService(locus, options?)` 与 [contracts](../../packages/contracts/README.md) 中的局部协议。

## 身份、地址与观察

- **Machine**：持久 UUID，改名、增删地址、不可达或 Plugin 重载都不改变。引用使用 `locus.remote-machine` 命名空间与 Machine ID。
- **Address**：一台机器可保存多个 `ssh`、`hostname`、`ip` 或 `other` 地址；地址可变化，也可属于其他机器。地址相同不自动合并；当前不自动按 hostname/IP 去重。
- **Connection**：Remote Machine 自身不建立独立连接实体或接管 SSH/FRP 生命周期。`machine observe` 把一次 SSH 通路作为本次 Observation 的 `source`；SSH/FRP 连接约定由独立的 [Connectivity](../connectivity/README.md) Profile 引用 Machine Identity。
- **Observation**：每次查询生成，包含 `scope: single-address`、SSH 地址、时间、状态与可选 hostname；不保存为长期事实。SSH 地址可达只说明该通路当前可用，不证明机器全局在线。

`machine observe` 只执行 OpenSSH `hostname` 命令，使用 `BatchMode=yes`、连接超时 5 秒、总时限 10 秒和 64 KiB 输出上限；不请求 TTY、不转发代理/X11、不执行本地命令。默认使用系统 OpenSSH 的主机密钥策略，不自动信任未知主机。结果区分 `observed`、`unreachable`、`denied`、`unavailable` 与 `error`，不回显可能含敏感信息的原生 stderr。

登记不保存 SSH 私钥、密码或 Token；不扫描网络、不自动创建连接、不修改远端系统。一次连接失败不回写机器不存在或已下线。

## 数据与生命周期

本 Plugin 独占 `locus.dataDirectory/remote-machine.sqlite`，实验版本 `user_version=1`；Core 不读写其中的领域数据。写入使用事务、DELETE journal 与 FULL synchronous；未知版本、损坏库或已有结构却无版本时拒绝覆盖。0 字节库按初始化中断后的空库处理。

fiber 卸载等待在途观察并关闭数据库，不删除机器、地址或 Core 关联。当前不实现机器删除；`machine dissociate` 只解除 Workspace 关联。备份需停止全部写者后复制整个 Locus 数据目录，SSH 配置与凭据不属于备份内容；完整恢复约定见 [Core](../../packages/core/README.md#持久化与恢复)。

## 验证

`pnpm test:all` 覆盖登记/重启、多地址、同地址不合并、改名与地址修改、观察分类、无 SSH、非法地址和未知版本；`pnpm verify:full` 在真实 profile 上覆盖注册、共享关联、地址修改、插件停用与跨进程恢复。真实 SSH 成功观察的条件与限制见 [Remote Machine 决定](../../.agents/notes/implemented/feature/2026-11-09-remote-machine.md#测试)。验证入口见[测试系统](../../docs/testing.md#分层与入口)。
