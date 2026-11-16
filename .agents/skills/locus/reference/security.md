# 安全与凭据参考

## 查询与 Profile

```sh
locus --json security status
locus --json credential provider-status
locus --json credential list
locus --json credential bindings
locus --json credential status credential:postgres-local
locus --json security capability list
locus --profile development --json security status
```

status 不输出 Root 验证材料；list/bindings 只输出公开字段、slot 与绑定，不读取秘密；status 只返回 Provider 条目是否存在。没有 get-secret。Provider 的 unverified 只表示绑定可加载，不证明后端已可读写。development 使用独立数据目录与安装 UUID，但 Profile 不是 OS 沙箱，也不能替代真实 Keyring 测试的独立 OS 账户。

## 组件命令

```sh
locus pg register production --host 127.0.0.1 --database app --username app --credential credential:pg-production
locus pg list production --credential credential:pg-production
locus remote-targets add win-x --spec target.json --file /absolute/selected-key
locus remote-targets update-credential win-x --credential credential:server-key --method private-key --file /absolute/selected-key
locus remote-targets update-credential win-x --credential credential:server-password --method password
```

`pg register` 与 `remote-targets add/update-credential` 在 Root 批准后隐藏输入密码并固定目标；`pg list` 与远程访问是 User 级，不触发 Root，也不能替换登记目标。不要替用户读取或输出秘密内容，不要把秘密放入 argv、环境变量或 `.env`。

## 可信本地交互

```sh
locus --profile development init
locus security capability set postgres:register user
locus security capability reset postgres:register
locus credential remove credential:postgres-local
locus credential cleanup
locus credential cleanup --yes
locus security change-root-password
locus security reset-root
```

这些是需要本地可信 TTY 的入口，不是供 Agent 注入口令的语法。让用户在 Host 隐藏提示中输入 Root 密码；不要要求用户把密码粘贴到聊天，不用 argv/env/.env/stdin spec 或 Bash 包装提供密码，不模拟 authenticated=true，不用 --yes 绕过认证。非交互失败必须保留为明确失败，不能静默跳过。

Root 可以覆盖某个组件能力的认证等级；覆盖会影响后续命令。`credential cleanup` 只清理当前 Profile 精确 service 下未登记元数据的孤立账户；不要改成按 `locus*` 前缀批量删除，也不要删除已知凭据或其他 service。reset-root 是本机管理接管，必须警告和明确确认，不要求旧密码，不删除 Workspace 或资源凭据；不能作为普通操作的自动恢复。

## 普通工作与远程边界

Human 与 Agent 默认共享 User 权限，source 只作线索；普通获准凭据使用不提示 Root，不要求逐次人工审批。组件状态、可编辑 YAML 与目标 access 都不能自行产生主体授权。

远程操作仍经 `locus remote-targets`。新目标使用 `method: private-key|password` 与 `credential:<id>`；先 `add` 写入配置，再 `register` 登记字段；旧 `auth.path/root` 只供 `remote-targets migrate` 显式导入。不要替用户去掉私钥口令、伪造迁移完成或用共享 Agent 绕过阻塞。具体输入／失败与已知平台范围见[安全设计](../../../../docs/subsystems/core-security.md)和[命令手册](../../../../docs/commands.md#安全与凭据)。
