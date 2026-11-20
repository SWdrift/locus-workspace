# 决策记录：Core Security 统一权限与凭据平面

Status: implemented

> 部分被取代：`capabilities` 授权键、执行前凭据预检与 `withCredential()`／`registerCredential()` 接口已由[统一资源调用与 operation 授权](2026-11-17-invocation-api.md)取代；本记录继续解释身份、Root KDF、Provider、Grant 与消费者交付的理由。

## 问题

Locus 需要让 Compose 使用 PostgreSQL、SSH、Gitea 等业务能力，但 User 不应接触原始秘密。把每个凭据使用都变成 Root 提权、让组件声明自行授权、把消费者协议放进 Core，或为每个消费者建设独立 Delivery 平台，会分别扩大交互成本、越权面、内核耦合与维护面。

## 决定

Core 是统一的权限真源与凭据保管者：固定 Root／User 身份、进程内 Session、operation 等级、Root Challenge／Grant、`component + slot + resourceKey` 绑定和 Provider。Compose 在 ComponentSpec 中声明 `operations` 与 `credentials`；声明不授予权限。Root 通过凭据写入 operation 登记并绑定到组件、slot 与 resourceKey，User 通过已授权 operation 消费。

普通使用与 Root 认证保持两条流程。Grant 支持 `operation` 与 `session`：操作级 60 秒、首次恢复后消费；Session 级绑定真实进程内 Session，同一 operation 与精确参数可复用，Session 结束、Root 重置或 Host 关闭时撤销。Grant 对象依赖 Core 内部记录与对象身份，恢复只执行预先捕获的原 operation 与参数，不接受新回调；不引入持久 Token、Daemon 或跨进程授权。

凭据引用由 `context.credential.write` 生成并由绑定内部持有。Core 持久化 `component + slot + resourceKey` 绑定，`context.credential.read` 只按当前组件、slot 与 key 查找；调用方不能自行选择其他引用。凭据缺失、字段不匹配、Provider 不可用与权限拒绝分开，Missing 不触发 Root。

Keyring service 由安装 UUID 与 Profile 推导，不额外重复存储。Provider 增加只返回账户名的 `list()`；Root 的 `credential cleanup` 只比较当前精确 service 的账户与 `security_credentials` 元数据，默认报告、`--yes` 才删除孤立账户，不触碰已知凭据、绑定或其他 service。

Root 使用本地短密码与 Node 原生 scrypt；SQLite 只保存验证材料、失败计数／租约／世代。丢失时采用可信本地交互重置，接受同 OS 用户能接管的边界，不建设恢复码或跨设备恢复。默认 Provider 为懒加载 `@napi-rs/keyring`，自动化测试显式注入内存 Provider；Windows 单条 2560 字节上限，不分片、不回退明文。

消费者交付放回各自领域包：`@locus/remote-targets` 通过受限临时私钥或密码文件调用系统 OpenSSH/Plink；PostgreSQL 与 Gitea 验证原型已移出仓库到 `temp/packages/`。删除独立 `security-delivery` 包，避免“Delivery 平台”和伪造 Compose；进程执行复用 execa。SSH 临时文件只保留基本异常、取消与超时清理，不建设 lease／PID 恢复平台。

Remote Targets 新配置使用 `method: private-key|password`；旧 `auth.path/root` 只供显式 `migrate` 读取，运行时不再使用。迁移先导入 Core、回读验证，再改写配置，不删除原文件。带口令私钥没有冻结的口令交付契约，迁移明确阻塞，不自动去口令。

Core SQLite 不自动迁移；结构变更按[本机部署的一跳数据迁移](2026-11-19-single-hop-data-migrations.md)保留从上一版本到当前版本的迁移，不维护逐版本迁移链和历史格式测试。

## 备选方案

**所有普通凭据使用也触发 Root**：否决。资源秘密可用性与管理权限不同，获准 User 工作不应反复认证。

**Human／Agent 独立身份、逐次审批、RBAC／ABAC／Policy DSL**：不采用。与共用默认 User 的冻结决定冲突，并引入未经需要验证的策略面。

**恢复码、恢复密钥与跨设备恢复系统**：不采用。当前只提供本机软件级额外阻力，本地重置及其后果比另一套秘密分发体系更小、更诚实。

**共享 ssh-agent、统一 env／临时文件交付所有消费者、保留独立 Delivery 包**：不采用。共享 Agent 缺少 Host 可控制的钥匙归属与生命周期；数据库与 HTTP 可直接在内存消费；Delivery 包会复制 Compose 能力声明并把“平台”放在错误的层。

**SQLite／明文文件回退、首版 SOPS/age、Vault/OIDC、Docker、内置 SSH 客户端、自动去私钥口令**：不采用。破坏秘密边界或超出当前范围；口令交付需要单独契约。

## 后果

组件不能靠可编辑声明扩权，CLI 非交互认证明确失败；领域边界与依赖方向保持可组合。代价是 Host 被明确纳入信任边界，Provider 与 SQLite 不具有跨系统事务，SSH 临时文件需要真实 ACL 验证，崩溃后可能保守留存。

同 OS 用户恶意代码可以绕过接口；Root KDF 不防持有验证材料的离线短密码破解，JS／驱动秘密复制无法保证零残留。备份包含 Root 离线验证材料但不带 Keyring 秘密；恢复引用与绑定不能恢复凭据。

运行证据包括真实 OpenSSH 本地 sshd 登录与错误私钥拒绝、Windows Keyring 历史隔离账户验证；PostgreSQL 16 scram 查询与 Gitea Header 边界在移出前的原型上完成。平台矩阵与未覆盖项统一归[安全子系统](../../../../docs/subsystems/core/security.md#平台证据与安全边界)；没有把 Windows 结果、假执行器或 askpass hook 调用当作全平台完成。
