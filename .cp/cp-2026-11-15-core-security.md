# CP Core Security

## Control Plane Role

本平面控制 Core Security 的统一权限与凭据平面重构。Core、CLI 可信 Host、Keyring、Compose 消费者和 remote-targets CredentialRef 切换已实现；带口令 SSH 私钥仍明确阻塞，不把部分交付称为完整后量子或全平台能力。

当前契约唯一归[安全子系统](../docs/subsystems/core/security.md)，公开用法归模块 README，取舍归[已实施记录](../.agents/notes/implemented/architecture/2026-11-15-core-security-runtime.md)。[剩余提案](../.agents/notes/proposed/architecture/2026-11-15-core-security.md)只保留带口令私钥交付。operation 授权、凭证命名空间与绑定键归[统一资源调用](../docs/subsystems/invocation.md)与[调用 API 决策](../.agents/notes/implemented/architecture/2026-11-17-invocation-api.md)；[生命周期管理](./cp-2026-11-15-lifecycle.md)控制 Session 与常驻 Host 演进。本平面不重复。Workspace 与目标登录模型仍由各自子系统拥有。

## Meta Reference

- [cp-meta](cp-meta.md)、[同 scope 记忆](cpm-2026-11-15-core-security.md)：控制与恢复工作入口。
- [架构](../docs/architecture.md)、[开发](../docs/development.md)、[测试](../docs/testing.md)、[文档规范](../docs/AGENTS.md)：工程约束。
- [Core](../packages/core/README.md#安全服务)、[CLI](../apps/cli/README.md#安全-host-与-profile)、[PostgreSQL](../packages/postgres/README.md)、[Gitea](../packages/gitea/README.md)、[Remote Targets](../packages/remote-targets/README.md)：事实所有者。
- 更新使用 create-control-plane；收束使用 compact-control-plane。未验证项不得写成已交付事实。

## Scope

- Core 安全领域、公开装配、SQLite 元数据、绑定与迁移。
- CLI 可信 Host、TTY、Profile、初始化／重置、凭据登记／绑定与 Grant 范围。
- ComponentSpec 能力与凭据槽声明；PostgreSQL、Gitea、SSH 消费者交付。
- remote-targets CredentialRef 切换、显式迁移与阻塞。
- 平台证据、测试隔离与所属文档；不增加 OS 沙箱、身份体系或通用策略引擎。

## Core Rules

- Root／User、Human＝Agent、source 仅作线索已经冻结；不新增多 User、Service Identity 或差异授权。
- 普通凭据使用和 Root 认证是独立入口；Missing 不能自动触发 Root，组件声明／健康状态不能授权。
- Host 只在可信组合根取得；密码不能进入 Prompt、普通 Bash、argv/env/.env、配置、日志、JSON、Challenge 或 Grant。非交互明确失败，不建设审批流。
- Grant 只恢复 Core 保存的原操作；操作级单次、Session 级绑定真实 Session，消费前复核认证世代；不引入持久 token 或跨进程授权。
- 资源秘密不进 SQLite，不增加明文回退／分片。Root 派生验证材料另管，备份敏感性不得省略。
- 自动测试显式内存 Provider；真实 Keyring 仅隔离 OS 账户。Windows 证据不得外推到 POSIX 或重启／锁定场景。
- SSH 交给系统 OpenSSH；新执行器复用 execa；不新增 SSH 客户端或共享 Agent。
- 带口令私钥未冻结交付契约前，迁移明确阻塞；不自动去口令，不删除旧支持凑完成度。
- 开发阶段 SQLite 不维护旧 schema 逐版本迁移；结构变更按当前 schema 重建。
- 同 OS 用户仅软约束；Root KDF 不防离线短密码破解；SSH PQ 依实际协商，Keyring／Root 不等于后量子系统。

## Task Board

- [x] 统一 Core 权限、凭据、绑定与 Grant 模型。
- [x] 删除独立 security-delivery 包，拆分 PostgreSQL／Gitea Compose，SSH 交付归 remote-targets。
- [x] remote-targets 显式迁移、运行时 CredentialRef 与旧文件停用。
- [x] 真实 PostgreSQL、Gitea、SSH 消费验证。
- [ ] 带口令 SSH 私钥交付契约：见剩余提案；当前 `encrypted-key-unsupported` 阻塞。
- [ ] macOS／Linux TTY、Keyring 后端与 POSIX SSH 实跑证据。

## 核查入口与运行证据

| 范围 | 当前代码与已观察结果 |
| --- | --- |
| Core／SQLite | 安全服务与可信 Host 端口同步装配；当前 schema v5 含凭据与绑定；未知版本／冲突结构拒绝覆盖 |
| CLI | init／security／credential 诊断与 `security capability` 已接；`credential put/bind` 已收回，`--grant-scope operation|session` 已提供；真实 TTY 初始化／改密／重置历史证据；scrypt 单次 84 ms |
| Keyring | 2.1.2、独立临时非管理员 Windows 账户、UTF-8 原始字节、ASCII／Unicode／RSA PEM、原生 2560/2561 边界、Missing／跨进程／删除通过（本次运行） |
| PostgreSQL | 临时 PostgreSQL 16、scram-sha-256 拒绝无密码登录、Core 交付密码、真实 `pg.Pool` 查询通过 |
| Gitea | 真实 Node fetch 本地 HTTP 服务，Header、跨源、重定向、401、网络失败通过 |
| SSH | 真实 OpenSSH 9.5 客户端与本地 Git sshd 9.4；Core CredentialRef、正确密钥、错误密钥、固定 known_hosts、临时文件清理通过；Plink 真实登录未验证 |
| 迁移 | 私钥／密码迁移入口；带口令私钥明确阻塞；原文件保留 |
| 最终门禁 | `pnpm verify`：186/186 自动测试通过、`pnpm docs:check` 通过；真实 PostgreSQL／SSH 手工脚本通过；e2e 最近一次 36 次调用通过，本次改动后处于冷却窗口未重跑 |

未验证范围统一见[平台矩阵](../docs/subsystems/core/security.md#平台证据与安全边界)。
