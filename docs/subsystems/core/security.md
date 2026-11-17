# Core Security

## 简述



## 职责


不包含多 User、Service Identity、租户、Human/Agent 差异化授权、RBAC/ABAC/Policy DSL、审批、Vault/OIDC、OS 沙箱、独立审计日志或 SSH 协议实现。命令语法归[命令手册](../../commands.md#安全与凭据)，公开 API 用法归 [Core README](../../../packages/core/README.md#安全服务)，消费者交付归各 Compose README。

## 身份、Session 与 Grant

Root 与默认 User 是固定主体，稳定 id 为 `root` / `user`，只有两级权限。Human、Agent 与 component 来源都使用默认 User；`source` 只提供诊断线索，不参与授权。Root 是独立管理授权来源，不创建持久 Root Session，也不改变原 Session 的 User 身份。

Session 保存 sessionId、userId、source、startedAt、endedAt 和活动状态，仅存在于当前进程。Host 创建并持有不透明 Session 对象；复制字段或自行传入 userId 无法冒充身份。CLI 命令结束销毁其工作 Session，Core dispose 撤销全部会话和未完成授权。`locus shell` 的环境变量不是 Session 凭证，也不提供跨进程 Grant。



- 并发恢复同一未消费 Grant 只能有一个成功；已消费、过期、撤销与取消分别可判。


`defineComponent(...)` 返回两个视图：

```text
defineComponent(...)
  ├─ component：可序列化元数据，给 Core
```




## 凭据字段、登记与绑定


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
- 凭据缺失、未绑定或字段不匹配不触发 Root 提权；Root 不足才返回 Challenge。






## 入口边界

命令树、参数、提示、渲染与退出码归 `apps/cli`；组件包不注册 CLI，也不包含 CLI 命令文本。命令语法见[实用命令](../../commands.md#安全与凭据)。


## Root 认证与恢复

初始化入口在可信本地 TTY 隐藏输入两次密码；重复初始化不覆盖验证材料，不删除已有 Workspace。Core 不读取 stdin，也不读取环境变量。Root 密码由调用方提供：人在可信 TTY 输入，Agent 从环境文件的 `_LOCUS_ROOT_PASSWORD` 读取后经 Host 注入；密码不能进入 argv、普通配置、日志、JSON、Challenge 或 Grant。环境文件的登记位置与同步规则见[开发与验证](../../development.md#开发环境与-_locus_root_password)。非交互或输入中断明确失败。

验证使用 Node 原生异步 scrypt，固定 N=32768、r=8、p=1、maxmem=64 MiB，随机 16 字节 Salt，32 字节派生结果，固定长度 timingSafeEqual 比较。SQLite 保存版本、算法与参数、Salt、派生验证值和认证世代，不保存明文。

连续 5 次错误锁定 60 秒，成功清零；取消不算错误，锁定期间不运行 KDF。SQLite 事务预记一次失败并登记 60 秒认证租约，阻止跨进程并发验证；异步 KDF 不持有 SQLite 事务。正常结束核对租约与世代后完成计数，进程在验证中崩溃时保守保留预记失败，不能通过重启清零。

丢失密码只提供明确本地管理接管：可信 TTY 展示警告、要求确认，再设置新密码；不要求旧密码，不生成恢复码、恢复密钥或跨设备恢复体系。重置原子替换验证材料、清除锁定、递增认证世代并使旧 Grant／上下文失效，不删除 Workspace 或 Keyring 条目，也不自动恢复资源凭据。拥有同 OS 用户文件权限的代码可以模拟重置，这是接受的软件边界。

## 消费者交付边界


- [PostgreSQL](../../../packages/postgres/README.md)：临时验证消费者，验证完成后移除。
- [Gitea](../../../packages/gitea/README.md)：绑定 origin 的 Bearer 请求。
- [Remote Targets](../../../packages/remote-targets/README.md)：系统 OpenSSH/Plink 与受限临时文件。

## 远程目标安全边界


## 持久化、错误与备份




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

