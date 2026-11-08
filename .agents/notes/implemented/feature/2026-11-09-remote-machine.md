# 决策记录：Remote Machine 作为可关联的外部机器对象

Status: implemented

## 问题

Workspace 已经可以独立于目录和 Session 存在，但仍不能持久引用“工作所依赖的外部机器”。若用 hostname、IP 或 SSH 地址充当身份，地址变化、重用或两台机器共享入口就会造成误合并；若登记机器要求先建立 SSH 连接，又会让离线、不可达或尚未配置凭据的长期语境无法成立。

本轮交付最小的 Remote Machine Capability：登记稳定机器身份、保存多个地址、显式关联 Workspace，并在现有 OpenSSH 上做带来源和时间的只读观察。不建设 SSH/FRP 管理、远程执行、IaC 或监控平台。

## 决定

### 机器身份与资料

Remote Machine Plugin 独占 `locus.dataDirectory/remote-machine.sqlite`，保存机器 UUID、名称、描述、时间和地址；Core 的 schema 与关系种类不变。机器引用使用：

- `namespace`: `locus.remote-machine`
- `id`: Plugin 生成的 UUID

名称、描述、地址增删、地址变化、不可达、Plugin 卸载和 DSH 重启都不改变 Identity。机器可被多个 Workspace 关联；一个 Workspace 也可关联多台机器。登记是全局领域操作，不要求某个 Workspace 已选择能力；`machine associate` 才要求目标 Workspace 选择 `locus.remote-machine` 提供方。

### Address、Connection 与 Observation

- **Address** 是机器已知的访问地址，持久化多个 `ssh`、`hostname`、`ip` 或 `other` 条目；同一地址可以属于不同机器，登记时不自动按地址去重或合并。地址 ID 与机器 ID 分离，修改地址不改变机器身份。
- **Connection** 在 v0 不建立独立持久实体。OpenSSH 是当前唯一观察通路，由本次 Observation 的 `source` 表示；Remote Machine 不读取、保存或修改 SSH 配置，也不拥有连接生命周期。未来 FRP/SSH 能力应引用 Machine Identity，而不是接管机器所有权。
- **Observation** 每次按需生成，包含 `scope: single-address`、SSH 地址、时间、状态和可选 hostname；不写入数据库。SSH 地址可达只表示该通路当前可用，不提升为机器全局在线。失败区分 `unreachable`、`denied`、`unavailable` 与 `error`，一次失败不回写机器不存在或已下线。

观察执行无 shell 的原生 `ssh`，最多 10 秒、64 KiB 输出，使用 `BatchMode=yes`、5 秒连接超时，不请求 TTY、不转发 Agent/X11、不执行本地命令；只运行 `hostname`。默认遵循 OpenSSH 主机密钥策略，不自动信任未知主机；不回显可能含敏感信息的原生 stderr。

### Core 与 CLI

Core 继续只保存 Workspace 长期关系与不透明引用；Remote Machine 通过现有 `workspaces.link/unlink` 建立或解除关联，不直接写 Core 数据库。`machine list <workspace>` 与 `machine workspaces <machine>` 从 Core 关系反查，不建立第二套成员模型。

CLI 增加 `machine register/list/show/update/address/associate/workspaces/dissociate/observe`；登记、资料和地址操作不需要 Workspace 选择，关联需要能力选择。解除关联只删除 Core 关系；本轮不提供机器删除，因为没有解决共享引用与破坏性确认边界。

Plugin 提供 `locusRemoteMachine`，Capability 为 `locus.remote-machine`，提供方 `@locus/remote-machine`，Tag `environment` 只分类。`availability()` 检查 OpenSSH 是否可用，但机器登记、资料、地址和关联不依赖它；只有观察在 OpenSSH 缺失时返回不可用。

## 测试

- Remote Machine 包内测试覆盖登记与重启、多地址、同地址不同机器不合并、改名/地址修改保持 Identity、地址删除、观察来源/时间/范围、成功与失败分类、无 SSH 仍可登记、非法地址输入和未知数据版本。
- 跨包 CLI 测试覆盖两 Workspace 共享机器、能力选择前置、地址修改、`machine observe`、解除不删除机器、重启恢复，以及 Plugin 停用后关联保留且仍可解除。
- 真实 profile smoke 覆盖注册、地址、共享关联、机器视角反查、改名、插件停用和跨进程恢复；失败观察使用不可达端口验证 `unreachable` 形状。
- 真实 OpenSSH 成功观察使用本机临时 sshd 完成：`127.0.0.1:22222` 返回 `hostname=CZXyee`，Observation 记录 `scope=single-address` 和观察时间。没有现成外部主机或 SSH 配置，因此未验证外部机器、ProxyJump、FRP 或跨网络条件；没有用 mock 冒充真实连接成功。
- 长驻 shell 中修改 Remote Machine 构建产物后观察到模块重新加载标记，随后 `machine register` 在同一 shell 成功，进程未退出；Filesystem/Git/Core-Host/CLI 的既有 shell 回归同时通过。
- 未保存 SSH 私钥、密码、Token 或原始 stderr；测试结束后移除临时 SSH 服务与配置。

## 备选方案

**在 Core 新增 machines 表或通用机器解析器。** 会把地址、SSH 与机器领域规则提前固化进 Core，并制造第二份权威状态；当前由 Plugin 解释领域规则，Core 只保存不透明关联。

**用 hostname、IP 或 SSH 地址作为唯一身份，并自动去重。** 地址会变化、被重用，也可能由多台机器共享；当前只允许显式登记和确认，地址重合不证明机器等价。

**把 Machine、Address、Connection、Observation 分别建成四套实体。** 当前真实用例只需要机器资料、多地址和一次 SSH 观察；独立 Connection 生命周期、凭据和 FRP 尚未有调用方，先保留语义边界而不预建表或接口。

**登记时要求 SSH 可达或保存连接凭据。** 会让离线机器、权限不足和尚未配置 SSH 的语境无法建立，也会把凭据引入普通机器资料；当前登记与连接验证分离。

**自动扫描网络或按 SSH 配置导入机器。** 会产生隐式发现、权限扩大和重复身份；当前不扫描，也不把 SSH 配置当作机器登记来源。

**观察失败时删除机器或关联。** 失败可能是网络、认证或临时不可达，不等于资源不存在；当前保留长期事实，只把本次 Observation 标为失败。

## 后果

Workspace 获得独立于目录和 Session 的外部机器语境：同一机器可被多个 Workspace 引用，改名或地址变化不破坏身份，机器暂时不可达也不丢失关联。OpenSSH 观察提供了后续 FRP/SSH、Nginx、Database 和部署管理的组合基础，但本轮没有交付这些能力。

代价是 Remote Machine 目前只有单一 SSH 观察通路，Connection 没有独立生命周期，也不支持 ProxyJump、FRP、网络扫描、自动发现、机器删除或远端执行。没有真实外部主机与凭据环境时，只能验证失败分类；不能据此声称跨网络或生产机器可达。

## 暂缓

- 独立 FRP/SSH Connection Capability、连接配置与凭据管理；它们应引用 Machine Identity，不成为机器所有者。
- 机器删除、共享引用清理、地址历史与自动迁移；需要明确的破坏性确认和数据所有权规则。
- 网络扫描、按 SSH 配置自动导入、hostname/IP 自动去重和身份确认。
- 远端执行、部署、监控与操作系统/服务信息采集；当前只运行 `hostname`。
- Gitea、Nginx、Database 等组合能力；需要各自真实实例与授权条件。
