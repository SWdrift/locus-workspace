# 决策记录：Connection Profile 与 SSH/FRP 连接验证

Status: implemented

## 问题

Remote Machine 已能保存稳定机器身份与地址，但用户仍无法保存“如何访问这台机器”的可复用约定，也看不到 OpenSSH 实际解析出的目标、ProxyJump、身份与 known_hosts 前提。若把 hostname、SSH alias、visitor 端口或 FRPP 配置当成 Machine Identity，更换通路就会误生成新机器；若自建 SSH 客户端或 FRP 运行时，又会复制成熟原生设施的权威状态。

本轮交付 Connectivity v0：按 Machine UUID 保存 Connection Profile，复用系统 OpenSSH 配置，检查有效配置，执行一次只读连接验证，并为当前 CLI 提供原生命令入口。FRP 只引用已有 visitor，不管理 FRPP 配置、Link 或隧道生命周期。

## 决定

### Connection Profile 与所有权

Connectivity Plugin 独占 `locus.dataDirectory/connectivity.sqlite`，保存 Profile UUID、`machineId`、名称、transport、target、端口、用户、ProxyJump 和可选配置/身份/known_hosts 路径。`machineId` 是不透明关联；Profile 不拥有 Machine，不直接写 Remote Machine 数据库。

Profile 是机器级配置：

- 同一 Machine 可以有多个 Profile，例如 direct 与 proxy-jump。
- Profile 更换 target、端口或 transport 不改变 Machine Identity。
- 删除 Profile 不删除 Machine、Workspace 关联或外部资源。
- Workspace 通过已有关联的 Machine 发现 Profile；不新增 Profile 级 Workspace 成员或关系。

当前不保存密码、Token、私钥内容、FRP Secret、完整 SSH 调试日志或临时 Session 状态；只保存必要路径引用。`list/show` 默认隐藏身份文件与 known_hosts 路径，`open` 为生成可执行原生命令才输出必要路径。

### Transport 与组合

- `direct`：由 target、端口、用户和 OpenSSH 配置决定直连路径。
- `proxy-jump`：必须保存 ProxyJump 目标；`ssh -G` 必须解析出跳板或 ProxyCommand。
- `frp`：引用**已经存在的本地 visitor**，通常 target=`127.0.0.1`、port=6000，并可引用设备专用密钥与 known_hosts。Connectivity 不启动 FRPP client、不修改面板配置、不下发 Link、不管理 visitor。

`frp` 仍使用系统 OpenSSH；因此 FRP 只是 SSH 的一条传输通路，不是新的协议实现。Profile 的 transport 和 OpenSSH 有效配置不一致时，`inspect` 给出 warning/error，不自动改写配置。

### Inspect、Attempt 与 Open

`inspect` 不连接远端：

- 用 `ssh -G` 解析系统 OpenSSH 或 `sshConfigFile` 的有效配置。
- 返回 hostname、port、user、ProxyJump、身份文件候选数量、known_hosts 数量和 strict host key 状态；不返回路径。
- 检查显式配置/身份/known_hosts 文件是否存在；默认 known_hosts 不存在只给 warning。
- 检查 proxy-jump Profile 是否真正有跳板；direct/frp 被 OpenSSH 配置额外引入 ProxyJump/ProxyCommand 时给 warning。
- 对 `frp` Profile 只探测本地 visitor 端口是否监听，不把 TCP 监听当作远端隧道健康。
- 状态为 `ready`、`warning`、`error`、`unavailable`。

`verify` 执行一次真实 SSH：

- `BatchMode=yes`、`ConnectTimeout=5`、连接尝试 1 次、总时限 10 秒。
- 强制 `StrictHostKeyChecking=yes`，不自动接受未知或变化的主机密钥。
- 不请求 TTY、不转发 Agent/X11、不执行本地命令；远端只运行 `hostname`。
- 区分 `connected`、`config-error`、`denied`、`host-key`、`unreachable`、`target-unavailable`、`unavailable`、`error`。
- 一次失败不删除 Machine、Profile 或 Workspace 长期关系；Attempt 不持久化。

`open` 返回 `ssh ...` 原生命令。当前 DSH 的 `terminalController` 和 `terminals` 服务都需要 Agent/Web Session 所有权；CLI 没有可移交的 Agent 或窗口，因此不伪造 PTY 接管，先保留明确原生命令入口。

### Core 与生命周期

Connectivity 通过 `locusRemoteMachine.get()` 验证 Machine，通过 Core 已有 Workspace 关系提供 Workspace 过滤；没有新增 Core schema、Machines 表或 Connection Registry。Plugin 卸载等待在途检查/验证并关闭数据库，不删除 Profile、Machine 或关联。

## 测试

- 包内测试覆盖 Profile 持久化、同一 Machine 多 Profile、同名拒绝、transport 一致性、修改/删除、inspect 有效配置与路径脱敏、ProxyJump、FRP visitor 探测、verify 成功与失败分类、open 命令、availability 和未知数据库版本。
- 跨包 CLI 测试覆盖 Profile 新建/查询/检查/验证/修改/删除、Workspace 过滤和 Machine Identity 保持。
- 真实直连与 ProxyJump 使用本机两个临时 OpenSSH 服务与临时 SSH config 验证：direct `direct` alias、proxy-jump `target` -> `jump` 均返回 `<local-host>`；`connect inspect` 的 resolved 配置与 `verify` 的 `connected` 结果一致。另用系统默认 `~/.ssh/config` 的 `<default-alias>` alias（不传 `sshConfigFile`）验证了默认配置复用。
- 真实 FRP 使用现有 FRPP client 与本机 visitor 验证：visitor 6000 监听后，Profile 通过既有设备密钥和 known_hosts 连接到已登记的 Windows Dev，`verify` 返回 `connected`，hostname 为 `<windows-dev>`。验证后停止 FRPP client；未修改面板配置、Link、visitor 或远端状态。
- FRPP 自带启动日志会打印运行配置字段；未把该日志写入仓库、测试或文档，也没有复制日志内容。
- 长驻 shell 中修改 Connectivity 构建产物后观察到 HMR 重载标记，随后同一 shell 的 `connect verify` 仍返回 `connected`；Filesystem/Git/Remote Machine/Session/Core-Host/CLI 回归通过。
- 未使用 Mock 宣称真实 SSH/FRP 成功；单元测试的 fake runner 只覆盖解析与失败分类。

## 备选方案

**把 Profile 作为 Remote Machine Address 或 Core 关联。** 地址定位与连接约定不是同一语义；把 alias/visitor/端口写进 Machine 会让更换通路影响机器身份。当前使用独立 Profile，仅引用 Machine UUID。

**在 Core 新建 connections 表或中央 Connection Registry。** 会把 SSH/FRP 领域规则和运行状态提升为 Core 原语；当前由 Plugin 解释，Core 只保留 Workspace 关联。

**内置 SSH 客户端或 FRP 运行时。** 会复制 OpenSSH/FRPP 的认证、隧道和主机密钥权威；当前只调用原生 OpenSSH，并把 FRP 当作已有 visitor。

**自动信任首次主机密钥或自动导入 SSH config。** 会降低主机身份保证并扩大隐式配置面；当前强制 strict host key，config 由用户显式引用。

**CLI 直接用 DSH `terminalController` 或 `terminals` 建 PTY。** 这些服务需要 Agent/Web Session 所有权，CLI 当前没有 Agent；先给原生命令入口，避免伪造会话所有权。

**在 Connectivity 中启停 FRPP、修改 visitor 或下发 Link。** 属于外部状态变更，需要单独权限、确认和回滚；当前只做只读连接检查与验证。

## 后果

Workspace 现在可以保存同一机器的多个访问约定，检查 OpenSSH 实际解析结果，并真实验证直连、ProxyJump 与已有 FRP visitor。Machine UUID 保持稳定，Profile 更换不会生成新机器。

代价是 Profile 不是实际运行连接，`inspect` 的 visitor 监听不等于隧道健康，`verify` 只验证当次 SSH；CLI 尚未接管交互式终端，FRPP 的配置下发、visitor 启停和 Link 管理仍未交付。

## 暂缓

- FRPP 配置管理、visitor 启停、Link 下发、故障恢复和删除；需要独立权限与确认流程。
- 连接尝试历史、Profile 自动选择、并发连接池和长连接复用。
- CLI/DSH PTY 交接、交互式 SSH 状态保留和终端重连。
- SSH Agent、密码/密钥管理、ProxyCommand 自定义与主机密钥自动导入。
- 远程执行、部署与服务观察；Gitea 只读 CI 观察已独立交付，但 CI→部署关系仍需真实部署证据。本轮只提供连接基础。
