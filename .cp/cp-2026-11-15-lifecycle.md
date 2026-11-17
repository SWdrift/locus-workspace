# CP 生命周期管理

## Control Plane Role

本平面控制 Core Session 的生命周期语义、Root 提权批准范围，以及未来常驻 Host 的演进边界。身份、KDF、Grant 字段、CredentialRef 与密钥交付契约仍归 [Core Security](../docs/subsystems/core/security.md#身份session-与grant)，本平面不复制这些正文。

当前 Core 是进程内库，CLI 每条命令通常创建并结束一个 Session；默认 Root 批准按单次操作计算。Core 已支持 `operation` 与 `session` 两种 Grant，session 绑定真实进程内 Session，供长生命周期 Host 复用；CLI 的 session scope 仍受命令内 Session 生命周期约束，不跨进程。

后续可能引入常驻 Host/Core；在该前提成立前，不通过环境变量、文件 Token、`locus shell` 环境或伪造 Session 模拟跨进程 Session。

## Meta Reference

- [cp-meta](./cp-meta.md)：控制平面结构、命名与更新规则。
- [Core Security CP](./cp-2026-11-15-core-security.md)：密钥、Root、CredentialRef 与平台证据。
- [权限控制面 CP](./cp-2026-11-15-permission-plane.md)：能力注册、有效等级、组件 API 与 CLI 消费。
- [Core Security 契约](../docs/subsystems/core/security.md#身份session-与grant)：Session、Grant 与 Root 认证的当前事实。
- [CLI](../apps/cli/README.md#安全-host-与-profile)：可信 Host、TTY 与命令生命周期。
- [测试](../docs/testing.md#安全与平台验证)：自动测试与真实验证入口。
- 创建或更新使用 `create-control-plane`；收束使用 `compact-control-plane`。

## Scope

- `SecurityHost.createSession` / `endSession`、Session 对象身份、活动状态与撤销。
- `authenticate(challenge, password, scope)`、`resume(grant)`、操作级与 Session 级 Grant 的生命周期边界。
- CLI 命令生命周期、Root 提权次数、原子登记/迁移。
- 未来常驻 Host 的可信 IPC、Session 创建/撤销、崩溃与多客户端边界。
- 不包含：KDF、Keyring、CredentialRef 绑定、组件业务协议、CLI 参数语法。

## Core Rules

- Session 是可信 Host 在当前进程内创建的不透明生命周期对象；不是 OS 登录、TTY、`locus shell` 或数据库会话，不持久化，不跨进程。
- `sessionId`、`userId`、`source` 字段不是凭证；复制字段或字符串不能冒充 Session。Core 只按对象身份关联内部记录。
- Session 本身不授权，也不改变 User 身份；Root 认证只签发绑定到该 Session 的 Grant。
- 当前 CLI 一条命令通常对应一个 Session；命令结束即撤销未完成 Challenge、待执行操作与 Session Grant。
- Root 批准默认是单次操作；显式 `session` scope 只在同一真实 Session 内复用，不提供跨进程 Token。
- 一条组件命令应在一个 Core 操作内完成其敏感步骤（登记密钥、绑定、连接、查询），从而只触发一次 Root Challenge；禁止把内部步骤拆成多次提权。
- Session Grant 只能在同一真实 Session 内按 component + capability + 精确 resource 复用，不扩大为全局 Root。
- 常驻 Host 是演进方向，不是当前已交付事实；没有真实需求与可信 IPC 前，不提前建设 daemon、租约或恢复平台。
- 修改 Session/Grant 行为必须同步 Core 文档、CLI 文档、测试与平台证据；未运行不得写成已验证。

## Task Board

### 当前收敛

- [x] CLI 提供 `--grant-scope operation|session`；默认 operation，session 不跨进程。
- [ ] 将 `pg register`、`remote-targets migrate` 等多步骤命令收敛为一次 Core 原子操作，保证一次 Root 批准。
- [x] 增加测试：一条命令只触发一次 Challenge；内部密钥读取不重复提权；Session 结束撤销未消费 Grant。
- [x] 实现 `SecurityGrantScope`：operation 与 session；session 随 Session 结束、Root 重置或 Host 关闭撤销。
- [x] 更新 Core/CLI/命令文档，区分操作级批准与 Session 内部复用。

### 常驻 Host 演进（待真实需求）

- [ ] 冻结可信 IPC 与 Host 生命周期；禁止 env/file Token。
- [ ] 定义长生命周期 Session 的创建、撤销、崩溃与多客户端边界。
- [ ] 常驻 Host 出现真实消费方后，评估跨命令 Session 复用与可信 IPC；当前只在进程内实现。

## 概念对齐

### Core Session

Host 在当前进程内创建的对象，记录 `sessionId`、默认 `userId=user`、诊断用 `source`、开始/结束状态。它把一组操作、Challenge、待执行闭包与 Session Grant 绑定到同一个可撤销生命周期。

### 一次 Session

从 `host.createSession()` 到 `host.endSession()` 的区间。当前 CLI 通常把它压缩到一条命令内；`locus shell` 的环境变量不是 Session，也不提供跨进程 Grant。

### Session Grant

Root 认证成功后绑定到真实 Session 的授权记录，限定 component、capability、action 与精确 resource。它在同一 Session 内可复用，Session 结束、Root 重置、Host 关闭或 Core dispose 时撤销。它不是 Token，不持久化，不跨进程。

### 操作级 Grant

默认 Root 批准方式：60 秒内只恢复 Core 捕获的一次原操作，首次恢复后消费。当前 CLI 的产品语义以它为主。
