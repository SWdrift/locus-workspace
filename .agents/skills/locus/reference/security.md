# 安全与凭据参考

## 查询与 Profile

```sh
locus help locus://security
locus --json get locus://security
locus --json get locus://security/provider
locus --json get locus://credentials
locus --json get locus://security/operations
locus --profile development --json get locus://security
```

信封 data 只提供公开元数据与绑定，不返回秘密。development 隔离数据和 Keyring 命名空间，不是 OS 沙箱；真实后端验证仍需隔离 OS 账户。

## 可信本地交互

```sh
locus init
locus security reset-root
locus post locus://security/actions/change-root-password
locus put locus://security/operations/postgres/pg.database.query --data '{"level":"root"}'
locus delete locus://security/operations/postgres/pg.database.query
locus post locus://credentials/actions/cleanup --data '{"apply":false}'
```

Root 密码、confirmation 和本机接管 confirm 只允许 TTY，不接受 --field-file、普通 Body、argv/env/.env。不要让用户把密码粘贴到聊天，不伪造 authenticated=true，也不把缺少交互当作可绕过的条件。

operation 等级覆盖会影响后续调用；删除覆盖恢复组件声明。cleanup 的 apply:true 会删除当前精确 service 下的孤立条目，必须得到用户明确授权；不能扩成前缀批量删除。凭据删除使用 locus://credentials/<component>/<slot>/<resourceKey>，会删除绑定，不应靠猜测引用执行。

## 普通工作与远程边界

Human 与 Agent 共用默认 User，普通获准使用不重复 Root 认证；组件健康或 YAML 不授予主体权限。Root 重置是本机管理接管，不删除 Workspace 或恢复资源秘密。详细模型见[安全设计](../../../../docs/subsystems/core/security.md)。资源凭据的 TTY／文件来源由 operation 字段声明决定，具体 rt:// 操作见[远程目标](remote-targets.md)。
