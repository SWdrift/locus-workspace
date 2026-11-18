# Core Security

## 简述

Core Security 是 Locus 的统一权限真源与凭据保管平面。它提供本机 Root／User 身份、进程内 Session、operation 级授权、Root 认证等级覆盖、operation／session 两种 Grant、按 `component + slot + resourceKey` 精确绑定、公开／秘密字段拆分，以及 OS Keyring 保管。Compose 用 `defineComponent` 声明 operation 表与凭据 slot；CLI 在组件命令中完成参数、提示与 Root 提权，普通 User 通过已获准的 operation 消费字段。

Core 不实现 PostgreSQL、HTTP、SSH 或具体业务协议。各 Compose 在自己的普通包中提供 operation handler：`@locus/postgres`、`@locus/gitea` 和 `@locus/remote-targets`。目标配置不保存凭据引用；引用由 `context.credential.write` 生成并由 Core 的绑定内部持有。CLI 是可信本地认证 Host，Web 仍占位。URI、Dispatcher、结果信封与事件的通用协议归[统一资源调用](../invocation.md)。

## 职责

Core 拥有固定身份、Session、operation 等级判定、Root 验证、Challenge／Grant、凭据公开字段元数据、绑定、Provider 接口与默认 Keyring 适配器。可信 Host 拥有输入与原操作恢复；Compose 拥有 operation handler、消费者专属秘密载体及释放；CLI 拥有命令树与 TTY 输入。

不包含多 User、Service Identity、租户、Human/Agent 差异化授权、RBAC/ABAC/Policy DSL、审批、Vault/OIDC、OS 沙箱、独立审计日志或 SSH 协议实现。命令语法归[命令手册](../../commands.md#安全与凭据)，公开 API 用法归 [Core README](../../../packages/core/README.md#安全服务)，消费者交付归各 Compose README。

## 身份、Session 与 Grant

Root 与默认 User 是固定主体，稳定 id 为 `root` / `user`，只有两级权限。Human、Agent 与 component 来源都使用默认 User；`source` 只提供诊断线索，不参与授权。Root 是独立管理授权来源，不创建持久 Root Session，也不改变原 Session 的 User 身份。

Session 保存 sessionId、userId、source、startedAt、endedAt 和活动状态，仅存在于当前进程。Host 创建并持有不透明 Session 对象；复制字段或自行传入 userId 无法冒充身份。CLI 命令结束销毁其工作 Session，Core dispose 撤销全部会话和未完成授权。`locus shell` 的环境变量不是 Session 凭证，也不提供跨进程 Grant。

`core.security` 只公开安全状态与 Provider 状态查询。可信组合根通过 `security.receiveHost` 得到管理端口，再把绑定后的组件窄接口注入消费者；普通组件没有初始化、认证或身份选择入口。组件绑定只接受装配时注册的组件 id 与 `kind: locus` 定义；同名复制对象、可编辑 YAML 和 external 登记不会自动取得信任。

Root 级 operation 抛出带不透明 Challenge 的 `SecurityFailure`。Host 在可信输入后调用 `authenticate(challenge, password, scope)`；只有密码验证成功才签发 Grant。scope 支持 `operation` 与 `session`：

- `operation` 默认 60 秒；只恢复 Core 捕获的原 operation 与参数，首次恢复后消费，失败不返还。
- `session` 绑定真实进程内 Session，同一 operation 与精确参数可复用；Session 结束、Root 重置、Host 关闭与 Core dispose 都撤销，不跨进程。当前 CLI 每条命令创建并结束 Session，因此 `--grant-scope session` 只在命令内有效；常驻 Host 尚未交付。
- 两种 Grant 都绑定主体、Session、组件、operation 与参数；参数哈希覆盖 method、规范 URI、query 与实际 input，调用方不能替换动作或参数。Session Grant 不扩大为全局 Root，也不接受环境变量／文件 Token。
- 并发恢复同一未消费 Grant 只能有一个成功；已消费、过期、撤销与取消分别可判。

## operation 与等级

`defineComponent(...)` 返回两个视图：

```text
defineComponent(...)
  ├─ component：可序列化元数据，给 Core
  └─ operations：operation id -> 路由、契约与 handler，给 Dispatcher
```

operation 的 `id` 是稳定授权键；Root 覆盖键为 `${component.id}:${operation.id}`。`auth` 取 `user`、`root` 或 `none`；`none` 只允许 `locus.security.initialize`，且仅在未初始化时成功。operation 声明路由、query／input／output 与输入字段元数据；声明本身不授予权限。

有效认证等级固定为：Root 覆盖 > operation 的 `auth`。Root 通过 `security operation set/reset` 覆盖，命令语法见[命令手册](../../commands.md#安全与凭据)；清除覆盖后恢复声明等级。各组件的凭据写入 operation 声明为 root，只读查询通常声明为 user。Root 可以把某 operation 显式降为 user，此时 operation 本身可由普通 User 执行；但 `context.credential.write` 仍要求本次实际获准 Root，降级后的写入会被拒绝。Root 是信任锚，不在 Core 额外阻止显式委派 operation 执行。

`operations` 与 `credentials` 不写入可编辑 YAML；YAML 只保存描述性元数据。动态 `kind: external` 组件没有可执行 operation，也没有凭据字段。Core 不维护 operation 白名单，只保留 Host 管理规则；受信任边界是装配时注册的 `kind: locus` 组件定义。

## 凭据字段、登记与绑定

凭据定义与 operation、组件彼此独立。`defineCredential({ id, fields })` 只声明 slot 与字段结构，不另设 `schema` 或 `format`：

```ts
{
  id: 'database-auth',
  fields: [
    { name: 'username', secret: false, required: true },
    { name: 'password', secret: true, required: true },
  ],
}
```

- `secret: false` 字段进入凭据公开元数据（SQLite）；`secret: true` 字段作为一个 JSON 值与凭据元数据一起进入 Keyring。
- 写入时校验必填、未知字段与字段名；读取时合并公开/秘密字段，字段与当前声明不一致以 `credential-fields-mismatch` 失败。
- 字段变化显式重写，不做静默转换；秘密字段合并后超过 Keyring 单条容量即失败。
- 绑定键为 `component + slot + resourceKey`。`component` 是命名空间，组件只能访问自己的 namespace；`slot` 是 `defineCredential.id`；`resourceKey` 由 handler 显式提供，通常取自一个或多个 URL 参数，长度最多 2048（按 JavaScript `string.length` 计）。输入边界与 Store 复用同一规则，非法输入不伪装成持久化损坏。
- 凭据引用由 `context.credential.write` 生成，形如 `credential:<id>`，由绑定内部持有；URL `locus://credentials/<component>/<slot>/<resourceKey>` 只返回元数据与绑定，永不返回秘密。
- `CredentialMetadata` 持久化 `owner` 组件 id；第一版一个引用只对应一个 owner 组件。其他组件已绑定的引用不能覆盖；同一组件内多个 operation 可以共享 slot 与 resourceKey。
- 没有执行前凭据预检。读取在 `context.credential.read` 的回调前判定，缺失绑定或字段不匹配直接失败，不触发 Root 提权。
- 写入只在本次 operation 实际获准 Root 时可用，与声明等级无关：声明为 root 但被覆盖为 user 时拒绝；声明为 user 被覆盖为 root 并获批准后可写。
- 凭据缺失、未绑定或字段不匹配不触发 Root 提权；Root 不足才返回 Challenge。

登记由 operation handler 通过 `context.credential.write` 完成。Core 在一个逻辑操作内写 Provider、公开字段元数据与绑定；Provider 写后回读验证，数据库提交失败时按前值补偿。配置文件更新属于领域包的 operation 边界，CLI 不自行编排存储补偿，不宣称跨存储 2PC。

删除凭据会级联删除绑定；对应管理入口只允许 Root 使用。普通业务命令不提供 get-secret。

## 凭据交付与上下文

handler 不直接接触 Host、Keyring 或 SQLite。Core 在授权后注入 `OperationContext`；接口、调用签名与字段类型由 [Core README](../../../packages/core/README.md#安全服务)维护。

- `run(query, input, context)` 只触发一次授权；handler 内部的 `context.credential.read` / `write` 不重新 Challenge。
- `read(credential, resourceKey, consume)` 按当前组件、slot 与 key 查找绑定，读取 Provider 秘密，合并公开字段后调用 `consume`；缺失绑定在回调前失败。
- `write(credential, resourceKey, values)` 写入公开字段与绑定，返回稳定 `CredentialRef`；只在实际 Root 时可用。
- 两个方法都校验组件命名空间、slot、精确绑定与 Root 世代；Root 重置后旧上下文失效，组件不能绕过上下文读取原始凭据。
- 秘密只经 `context.credential` 交付。注册秘密由可信 Host 通过 TTY 或文件收集，校验后作为 handler input 传入，不进入 URL、外部 JSON Body、日志或事件。

## 入口边界

命令树、参数、提示、渲染与退出码归 `apps/cli`；组件包不注册 CLI，也不包含 CLI 命令文本。命令语法见[实用命令](../../commands.md#安全与凭据)。

CLI 只传参数与展示结果，不接触 Keyring、字段拆分或绑定内部。Dispatcher 在解析路由后按 operation 等级判定；授权门先于凭据门：权限不足返回 Challenge，凭据缺失、字段不符或未绑定返回独立错误，不触发 Root 提权。

## Root 认证与恢复

初始化入口在可信本地 TTY 隐藏输入两次密码；重复初始化不覆盖验证材料，不删除已有 Workspace。Core 不读取 stdin，也不读取环境变量。Root 密码由调用方提供：人在可信 TTY 输入，Agent 从环境文件的 `_LOCUS_ROOT_PASSWORD` 读取后经 Host 注入；密码不能进入 argv、普通配置、日志、JSON、Challenge 或 Grant。环境文件的登记位置与同步规则见[开发与验证](../../development.md#开发环境与-_locus_root_password)。非交互或输入中断明确失败。

验证使用 Node 原生异步 scrypt，固定 N=32768、r=8、p=1、maxmem=64 MiB，随机 16 字节 Salt，32 字节派生结果，固定长度 timingSafeEqual 比较。SQLite 保存版本、算法与参数、Salt、派生验证值和认证世代，不保存明文。

连续 5 次错误锁定 60 秒，成功清零；取消不算错误，锁定期间不运行 KDF。SQLite 事务预记一次失败并登记 60 秒认证租约，阻止跨进程并发验证；异步 KDF 不持有 SQLite 事务。正常结束核对租约与世代后完成计数，进程在验证中崩溃时保守保留预记失败，不能通过重启清零。

丢失密码只提供明确本地管理接管：可信 TTY 展示警告、要求确认，再设置新密码；不要求旧密码，不生成恢复码、恢复密钥或跨设备恢复体系。重置原子替换验证材料、清除锁定、递增认证世代并使旧 Grant／上下文失效，不删除 Workspace 或 Keyring 条目，也不自动恢复资源凭据。拥有同 OS 用户文件权限的代码可以模拟重置，这是接受的软件边界。

## 消费者交付边界

PostgreSQL、Gitea 与 Remote Targets 各自负责协议、目标领域约束、operation handler 与秘密载体；Core 只负责字段拆分、精确绑定与交付。PostgreSQL 在 Root 登记时固定 host/port/database，Gitea 固定 origin，SSH 使用目标配置中的 host/port/login 与信任锚，并由 Remote Targets 保存目标安全摘要；配置变化需要 Root 重新确认；这些端点不由 User 请求参数替换。具体 API、失败与平台限制由各包 README 维护：

- [PostgreSQL](../../../packages/postgres/README.md)：临时验证消费者，验证完成后移除。
- [Gitea](../../../packages/gitea/README.md)：绑定 origin 的 Bearer 请求。
- [Remote Targets](../../../packages/remote-targets/README.md)：系统 OpenSSH/Plink 与受限临时文件。

## 远程目标安全边界

SSH 协议、目标模型、迁移流程与临时文件交付归 Remote Targets；本页只记录与 Core 的交界：目标配置只保存认证方式，凭据按 `component + slot + target id` 绑定并在 Core 内部持有引用；旧 `auth.path/root` 只供显式迁移读取，字段与绑定由 Core 校验，带口令私钥仍明确阻塞。详见[远程目标](../remote-targets.md)与 [Remote Targets README](../../../packages/remote-targets/README.md)。

## 持久化、错误与备份

Core SQLite 当前 `user_version=8`，包含 Workspace、关系、挂载、组件状态，以及安装、Root 验证材料、失败计数／租约／世代、Profile、凭据公开字段与 owner、`component + slot + resourceKey` 绑定、operation 等级覆盖与事件记录。安全表不保存资源秘密。开发阶段不维护旧 schema 逐版本迁移；版本不符时要求备份后重建数据目录，未知版本、冲突结构或损坏验证材料明确拒绝，不重建覆盖；没有自动备份。备份仍按 [Core 约定](../../../packages/core/README.md#持久化与恢复)停写后复制整个目录。

数据库备份包含敏感离线验证材料，但不包含 Keyring 秘密；恢复引用和绑定不等于恢复秘密。Session／Challenge／Grant 不持久化，重启不能恢复授权。丢失 Keyring 或换机须重新录入资源凭据。事件记录是 best-effort，不作为完整审计或重放依据。

`SecurityFailure` 保留 Core 的固定 code／reason，不携带原始 Provider／消费者异常或 cause。领域服务可用 `DomainFailure` 表达自身分类，能力包的 operation 必须将其转换为 `InvocationFailure`；Dispatcher 不解释消费者专属 code，未知异常只返回固定 `internal` 信息。CLI 只负责把已知类型渲染为命令结果与退出码。未初始化、拒绝、需要认证、错误密码、取消、非交互、锁定、Challenge／Grant 过期或撤销、已消费、凭据缺失、字段不匹配、Provider 不可用、超限、交付失败和安全存储 IO 分别可判；Provider 原生 IO 合并为不可用。CLI 安全错误在 JSON stdout 返回 code／reason，诊断写 stderr、退出 2；Gitea 交付返回认证失败／网络失败的独立结果。

## 平台证据与安全边界

| 路径 | Windows x64 当前证据 | 其他平台与未覆盖项 |
| --- | --- | --- |
| Root、SQLite、CLI Host | 真实 TTY 初始化／密码变更／重置／Ctrl+C；跨进程锁定与世代回归通过 | macOS／Linux TTY 尚未运行 |
| Keyring | 独立临时非管理员 OS 账户、ASCII／Unicode／RSA PEM、原生 2560/2561 边界、Missing、跨进程读取、条目及账户／Profile 清理通过 | 重启持久性、锁定、共享服务不可用未验证；macOS／Linux 后端未运行 |
| PostgreSQL | 临时 PostgreSQL 16、scram-sha-256、Core 交付字段、真实 `pg.Pool` 查询 | 外部生产数据库、连接池故障与长事务未覆盖 |
| Gitea | 真实 Node fetch 本地 HTTP 服务，Header、跨源、重定向、401/403、网络失败 | 未连接真实 Gitea 实例 |
| SSH | 真实 OpenSSH 9.5 客户端与本地 Git OpenSSH 9.4 服务端；Core 字段、正确密钥、错误密钥、主机固定、临时文件清理 | POSIX 权限代码未在 POSIX 系统运行；未验证外部生产目标；Plink 真实登录未验证 |
| 带口令私钥 | 迁移明确拒绝，不自动去口令 | 口令交付契约未冻结 |

验证入口与报告范围见各 Compose README 及[测试系统](../../testing.md)。真实消费者手工入口：

```sh
node packages/postgres/test/manual-postgres.mjs
node packages/remote-targets/test/manual-ssh.mjs
```

未运行平台不得声称已验证。

同 OS 用户的恶意代码、管理员及可观察内存的进程可以绕过软件接口；Root 不是 Windows UAC、OS Root、强隔离或零信任。KDF 和在线限制不能抵御持有验证材料的离线短密码破解。JS 字符串及驱动可能复制秘密，清零可控 Buffer 和缩短引用不等于内存零残留。

## 后量子边界

SSH 会话后量子协商交给系统 OpenSSH，取决于客户端、服务端及实际协商；本次未记录最终 KEX，不宣称已证明后量子会话，也不等于身份签名后量子化。OS Keyring 与 Root KDF 均不宣称自身具备完整后量子安全。Git 加密秘密文件首版不实现，未来方向为 SOPS＋age PQ；不自研 ML-KEM／ML-DSA，不增加通用密码算法包。稳定凭据引用允许未来更换秘密保管方式而不改业务配置。
