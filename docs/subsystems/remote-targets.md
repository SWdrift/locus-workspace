# 远程目标

## 范围

远程目标是接入面的第一个实现：把异构网络中的 SSH 目标登记为声明式数据，经统一入口探测与执行，不暴露第二条直连路径。当前覆盖 `packages/remote-targets`、`apps/cli` 的 `remote-targets` 命令域与 `.agents/skills/locus` 的参考页。传输客户端的可用性由[组件](components.md)提供：密钥认证依赖 `openssh`，密码认证依赖 `plink`。

不拥有调用方身份、权限或凭据保管；它通过窄接口接入 [Core Security](core-security.md)。不包含 S3/HTTP 协议、FRP 隧道生命周期、凭据生成与轮换。

## 三域与资源锚点

每个目标由三段组成，资源 id 是唯一锚点：

| 段 | 回答 | 当前字段 |
| --- | --- | --- |
| Identity | 以谁的身份访问、凭据引用是什么 | `login`、`auth.method`、`auth.credential`；旧 `auth.path/root` 仅供迁移 |
| Access | 能对目标做什么 | `capabilities`（`exec`、`shell`） |
| Connectivity | 经哪条路径到达 | `transport`、`via`、`host`、`port`、`remoteShell`、`trust` |

`resource`（`kind`、`label`）描述被访问对象，不携带身份、路径或能力。`capabilities` 是目标级声明，不是主体授权；主体、Session 与 Grant 由 Core 拥有，组合根按目标 id 提供精确授权。

## 存储

- `<dataDirectory>/remote-targets/targets.yaml`：唯一可编辑真源，保存全部目标定义。
- `<dataDirectory>/remote-targets/state.sqlite`：只保存最近一次探测结果，可删除并重建。
- `<dataDirectory>/remote-targets/trust/<id>/`：仅保存 `known_hosts` 等公开材料；`add` 创建目录但不创建秘密文件。
- 资源秘密保存在 OS Keyring；SQLite 只保存 CredentialRef 元数据与组件／能力／资源绑定。

目标根目录由 CLI 从 Core 的 `dataDirectory` 派生，不在模块内推断默认位置。写入使用临时文件 + rename；读取时校验字段、id 唯一性、CredentialRef 格式与路径是否逃逸凭据根。

## 流程

1. `add`：校验 spec、要求 `identity.auth.credential`、检查 id 未占用；Root 批准后创建 `known_hosts` 目录、整体写入 `targets.yaml`，并经 `register-private-key` / `register-password` 写入字段与绑定；私钥只走受控文件，密码隐藏输入。
2. `update-credential`：校验目标配置引用的 CredentialRef 与认证方式，只更新对应字段，不改配置。
3. `show`：按精确 id、唯一前缀或唯一标签解析，附加最近一次探测。
4. `migrate`：读取旧 `auth.path/root` 文件，经 Root 通过对应登记能力写入 Core、回读验证并绑定到目标资源，再改写为 CredentialRef；原文件保留。私钥先做受限临时副本预检，带口令明确阻塞。
5. `probe`：检查传输组件、Core 授权与绑定，取临时凭据，构造 `whoami` 调用，记录成功/失败与时间。
6. `exec`：检查 `exec` 能力、传输组件、Core 授权与绑定，执行并由 CLI 透传远端退出码。
7. `shell`：检查 `shell` 能力、传输组件、Core 授权与绑定，以继承 stdio 启动 SSH 客户端。

## 不变量

- 定义只有 `targets.yaml` 一个可编辑真源；SQLite 不反向生成配置。
- 新配置只保存 `credential:<id>`；旧 `auth.path/root` 不允许运行时执行，必须先迁移。
- 未知字段、重复 id、非法 CredentialRef 都明确失败，不静默回退。
- 能力检查在建立连接前完成；Core 绑定或 Provider 条目缺失时不启动客户端。
- 没有 Core 授权／凭据入口时默认拒绝；授权不由目标 YAML 或组件状态代替。
- 传输组件未登记或状态非 `healthy` 时在连接前失败，不静默改用其他客户端。
- 传输只调用系统 OpenSSH/Plink，不实现协议；主机密钥默认写入凭据根下的 `known_hosts`，密码认证必须钉死指纹。
- 秘密值不进入配置、SQLite、输出或命令行参数；SSH 只接收受限临时文件路径。
- Core 在凭据公开字段保存目标安全配置摘要 `targetBinding`；host/port/login、能力、客户端、remoteShell 与 trust 锚变化后，访问在启动客户端前以 `target-config-mismatch` 失败，需 Root 重新确认。
- 临时凭据目录在正常或异常返回后清理，probe 超时同样清理；exec/shell 未接取消信号，强杀可能残留同用户临时文件；不维护 lease、PID 追踪或崩溃恢复平台。

## 失败边界

| 场景 | 行为 |
| --- | --- |
| 配置无效 | `invalid-spec`，退出码 2，不写文件 |
| 目标重复 | `target-exists`，退出码 2 |
| 引用歧义 | `ambiguous-target`，列出候选，退出码 2 |
| 仍使用旧认证 | `migration-required`，连接前失败 |
| 私钥带口令 | `encrypted-key-unsupported`，迁移不写配置 |
| 凭据缺失 | `credential-missing`，连接前失败，退出码 2 |
| 传输组件未就绪 | `component-unavailable`，连接前失败，退出码 2 |
| 远端退出码非零 | `exec` 原样透传；`probe` 记为失败并以 1 退出 |
| 主机指纹不符 | SSH/Plink 自身拒绝，stderr 保留诊断 |

## 未实现

带口令私钥的 CredentialRef／askpass 交付契约、真实 Plink 登录验证、S3 协议、目标编辑、交互式 spec 补全、并发写入合并。现有旧文件只作为迁移输入保留；新增协议按适配器接入，不恢复插件运行时。
