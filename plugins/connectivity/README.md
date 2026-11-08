# @locus/connectivity

## 简述与职责

SSH / FRP Connectivity Capability：按 Remote Machine 的 UUID 保存可复用的 Connection Profile，检查 OpenSSH 有效配置，执行一次只读连接验证，并给出原生命令入口。

Plugin 不拥有 Machine、SSH 配置、凭据或 FRP/FRPP 隧道生命周期。Profile 是机器级配置，不建立第二套 Workspace 成员关系，也不直接修改 Remote Machine 数据库。

## 装配与使用

按[开发与验证](../../docs/development.md#宿主运行)将本包链接到项目内 `locus` profile 并合入插件行。Plugin 注入 `locus` 与 `locusRemoteMachine`，提供 `locusConnectivity`；Capability 为 `locus.connectivity`，提供方 `@locus/connectivity`，Tag `connectivity` 仅分类。

Connection Profile 通过 `machineId` 关联已有 Remote Machine。Profile 的增删改不改变 Machine Identity，也不改变 Workspace 与 Machine 的 Core 关系。CLI 语法由[命令手册](../../docs/commands.md#workspace-操作)维护；非终端调用使用 `createConnectivityService(locus, remoteMachine)` 与 [contracts](../../packages/contracts/README.md) 中的局部协议。

## Connection Profile

| 字段 | 语义 |
| --- | --- |
| `id` | Profile UUID，独立于 Machine |
| `machineId` | Remote Machine UUID，不复制机器资料 |
| `transport` | `direct` / `proxy-jump` / `frp`，描述预期通路 |
| `target` | SSH alias、host 或 visitor 地址 |
| `port` | SSH 或本地 visitor 端口；frp 必填 |
| `user` | SSH 登录用户 |
| `proxyJump` | OpenSSH ProxyJump 目标；仅 proxy-jump 可设置 |
| `identityFile` | 引用现有私钥路径；不读取、复制或保存内容 |
| `knownHostsFile` | 引用现有 known_hosts；不自动信任未知主机 |
| `sshConfigFile` | 可选的非默认 OpenSSH 配置文件 |

Profile 只保存连接约定。私钥、密码、Token、FRP Secret、运行中的隧道状态和临时 Session 均不进入 Connectivity 数据库。

## 检查、验证与入口

`connect inspect <profile>` 不连接远端：

- 运行 `ssh -G` 解析系统 OpenSSH 或指定配置文件的**有效配置**。
- 返回 hostname、port、user、ProxyJump、身份文件候选数量和 known_hosts 数量；默认不输出路径。
- 检查指定 config/identity/known_hosts 文件是否存在；缺失是明确错误。
- 检查 proxy-jump Profile 是否真的解析出跳板；direct/frp 若 OpenSSH 配置额外引入 ProxyJump/ProxyCommand，给出 warning。
- 对 `frp` Profile 只探测本地 visitor 端口是否监听（1.5 秒 TCP），不连接远端，也不证明隧道已注册到 frps。
- 区分 `ready`、`warning`、`error`、`unavailable`。

`connect verify <profile>` 执行一次真实 SSH：

- `BatchMode=yes`、`ConnectTimeout=5`、连接尝试 1 次、总时限 10 秒。
- 强制 `StrictHostKeyChecking=yes`，不自动接受未知或变化的主机密钥。
- 不请求 TTY，不转发 Agent/X11，不执行本地命令；远端只运行 `hostname`。
- 区分 `connected`、`config-error`、`denied`、`host-key`、`unreachable`、`target-unavailable`、`unavailable`、`error`。
- 一次失败只说明本次尝试失败，不删除 Machine、Profile 或 Workspace 关系。

`connect open <profile>` 返回 `ssh ...` 原生命令。当前 DSH 的 `terminalController` 与 `terminals` 服务绑定 Agent/Web Session，CLI 没有可移交的 Agent 或终端窗口，因此本轮不伪造 PTY 接管；交互式使用仍复用系统 OpenSSH。Profile 的 `identityFile` 等路径仅在 `open` 的必要命令中出现，`list/show` 默认脱敏。

## FRP / FRPP 边界

`frp` Profile 只引用**已经存在的本地 visitor**：通常是 `127.0.0.1:<port>`，并可引用既有设备密钥和 known_hosts。`connect verify` 通过该 visitor 的 SSH 入口验证；它不启动 FRPP client、不修改面板配置、不下发 Link、不管理 visitor 或隧道生命周期。

FRP 的真实恢复、配置下发和 Link 变更属于外部状态变更，需单独明确目标、权限和回滚条件，不能混入无副作用的 `inspect`。当前 `inspect` 的 visitor 监听检查只能证明本地端口存在，不能证明远端目标或面板隧道健康。

## 数据与生命周期

本 Plugin 独占 `locus.dataDirectory/connectivity.sqlite`，实验版本 `user_version=1`。使用 SQLite 事务、DELETE journal 与 FULL synchronous；未知版本、损坏库或已有结构却无版本时拒绝覆盖。0 字节库按初始化中断后的空库处理。

fiber 卸载等待在途 inspect/verify 并关闭数据库，不删除 Profile、Remote Machine 或 Core 关联。当前不实现 Profile 跨设备同步、连接尝试历史或自动选择最佳 Profile。备份需停止全部 Locus 写者后复制整个数据目录；SSH/FRP 配置与凭据不属于备份内容。

## 验证

`pnpm test` 覆盖 Profile 持久化、machine 关联、inspect、verify 分类、FRP visitor 检查、脱敏与 open；`pnpm verify:full` 覆盖真实 profile、插件停用和跨进程恢复。真实 OpenSSH 直连与 ProxyJump 使用本机临时 sshd 验证；真实 FRP 使用现有 FRPP visitor 和已登记 Windows Dev 设备验证。证据与限制见 [Connectivity 决定](../../.agents/notes/implemented/feature/2026-11-09-connectivity.md#测试)。验证入口见[开发与验证](../../docs/development.md#修改与验证)。
