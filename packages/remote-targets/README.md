# 远程目标

## 简述与职责

声明式登记远程 SSH 目标，并通过统一 operation 执行只读探测、服务操作、单次命令与交互 Shell。目标定义保存为 YAML，探测结果保存为 SQLite；模块构造系统 OpenSSH/Plink 调用，通过 Core 取得绑定凭据并在受限临时文件中交付，不实现 SSH 协议。包导出 `kind: locus` 的 `component` 与 `operations`，声明 `requires: [openssh]`、`rt://` operation 表与 `ssh-private-key` / `ssh-password` 字段槽。

## 使用前提

- Node.js 24 或更高；使用构建产物 `lib/`。
- 首次访问组件服务时物化 `remote-targets` 组件定义；密钥认证要求 `openssh` 组件为 `healthy`，密码认证要求 `plink` 组件；未登记或未就绪时传输前置明确失败。
- 密钥认证需要 `ssh` 在 `PATH` 中；密码认证需要 Plink，并提供 `connectivity.trust.fingerprint`。
- 凭据由 Root 通过 `remote-targets add`、`update-credential` 或 `migrate` 写入 Core，并按 `component + slot + target id` 绑定；目标配置只保存认证方式，不保存引用或秘密。
- 目标根目录为 `<dataDirectory>/remote-targets/`，必须由现有 CLI 以绝对数据目录提供；`dataDirectory` 的解析见 [Core](../../packages/core/README.md#持久化与恢复)。
- 执行前须由可信 Host 初始化 Core Security；probe/exec/shell 需要注入 Core 授权与凭据交付入口，普通 User 获准访问不要求 Root 密码。

## 使用

命令入口、参数与成功判据由 `apps/cli` 维护，见[命令手册](../../docs/commands.md#远程目标)。本包只提供 `component`、`operations`、目标服务与系统 SSH/Plink 执行边界；CLI 在 Root 批准后调用 `rt.target.register` 或 `rt.target.credential.update` 写入字段，普通访问调用 `rt.system.read`、`rt.services.list`、`rt.service.restart` 与 `rt.job.run`。

| operation | 方法与路由 | 等级 | 说明 |
|---|---|---|---|
| `rt.targets.list` | `GET rt://targets` | user | 列出目标与最近探测 |
| `rt.target.get` | `GET rt://targets/<id>` | user | 按 id、唯一前缀或标签查看 |
| `rt.target.register` | `PUT rt://targets/<id>` | root | 登记目标并写入对应凭据字段 |
| `rt.target.remove` | `DELETE rt://targets/<id>` | root | 只移除定义 |
| `rt.target.credential.update` | `POST rt://targets/<id>/actions/credential` | root | 只更新已绑定的私钥或密码 |
| `rt.target.migrate` | `POST rt://targets/<id>/actions/migrate` | root | 导入旧凭据文件并切换认证方式 |
| `rt.system.read` | `GET rt://targets/<id>/system` | user | 执行 `hostname` 并返回可达性 |
| `rt.services.list` | `GET rt://targets/<id>/services` | user | 列举 `cmd` 目标服务 |
| `rt.service.restart` | `POST rt://targets/<id>/services/<name>/actions/restart` | user | 重启 `cmd` 目标服务 |
| `rt.job.run` | `POST rt://targets/<id>/jobs` | user | 执行远端命令或交互 Shell |

## 配置与契约

| 字段 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `resource.kind` | 否 | `server` | `windows-device` 时默认远端 Shell 为 `cmd` |
| `resource.label` | 否 | 无 | 可作为 `show`/`exec` 的唯一引用 |
| `identity.login` | 是 | 无 | 目标侧登录名 |
| `identity.auth.method` | 是 | 无 | `private-key` 或 `password`；旧 `key` 只供迁移读取 |
| `identity.auth.path` | 否 | 按方法生成 | 旧文件相对路径，仅迁移读取；新配置拒绝 |
| `identity.auth.root` | 否 | 目标根目录 | 旧文件绝对根，仅迁移读取；新配置拒绝 |
| `access.capabilities` | 否 | `exec, shell` | 当前只接受这两个值 |
| `connectivity.transport` | 否 | `ssh` | 目前只支持 `ssh` |
| `connectivity.via` | 否 | `direct` | `direct` 或 `frp`；仅用于诊断 |
| `connectivity.host` | 是 | 无 | 主机名或地址 |
| `connectivity.port` | 否 | `22` | 1-65535 |
| `connectivity.remoteShell` | 否 | 按资源类型 | `posix` 或 `cmd` |
| `connectivity.client` | 否 | `ssh` / `plink` | 客户端可执行文件 |
| `connectivity.trust.knownHosts` | 否 | `trust/<id>/known_hosts` | 显式提供时使用 `StrictHostKeyChecking=yes` |
| `connectivity.trust.fingerprint` | 密码认证必填 | 无 | Plink `-hostkey` 使用 |

未知字段直接拒绝，不静默忽略。目标引用顺序：精确 id → 唯一前缀 → 唯一标签；歧义时列出候选并失败。

密钥认证使用 OpenSSH，默认 `StrictHostKeyChecking=accept-new` 并把主机密钥写入目标根下的 `known_hosts`；显式提供 `trust.knownHosts` 后改为严格校验。参数固定 `IdentitiesOnly=yes` 与 `IdentityAgent=none`，不继承共享 Agent 身份。密码认证使用 Plink，`-pwfile` 指向受限临时文件，`-hostkey` 钉死指纹。

远端命令按 `remoteShell` 拼接：`posix` 使用单引号转义，`cmd` 对含空白或元字符的参数加双引号。`cmd` 转义只覆盖常见情况，复杂命令应由调用方直接给出单条脚本。

## 凭据交付与迁移

Core 返回秘密后，本包在操作系统临时目录创建独占目录与文件：POSIX 目录 0700、文件 0600；Windows 在写入秘密前建立并核验仅当前 SID、SYSTEM 与 Administrators 的 DACL。OpenSSH/Plink 正常或异常返回后删除目录；probe 的 15 秒超时也走同一清理路径。exec/shell 当前未接取消信号，强杀进程可能留下同用户可读的临时文件；不维护 lease、PID 追踪或崩溃恢复平台，这是接受的残留窗口。

升级后已有远程目标凭据缺少 `targetBinding`，读取会以 `credential-fields-mismatch` 失败；Root 需重新执行 `update-credential`（或重新登记目标）补齐。

Core 把目标安全配置摘要 `targetBinding` 作为凭据公开字段保存。摘要覆盖 host、port、login、`access.capabilities`、`remoteShell`、客户端与 trust 锚；认证方法、目标 id 与仅展示字段不纳入。读取凭据时比较当前目标摘要与登记值，不一致以 `target-config-mismatch` 在启动客户端前失败。修改 `targets.yaml` 的安全字段后，必须由 Root 重新执行 `update-credential`（或重新登记目标）才能恢复访问。

旧 `auth.path/root` 不再参与运行时。`remote-targets migrate <target> --method private-key|password [--file <path>] --yes` 读取旧文件、经 `rt.target.migrate` 写入 Core 并回读验证，随后按 `component + slot + target id` 绑定并改写目标配置；原文件保留。私钥迁移先用受限临时副本执行 `ssh-keygen -y -P ''` 预检，带口令或无法解析时以 `encrypted-key-unsupported` 阻塞，不自动去口令、不删除原支持、不把口令放入 argv/env。密码迁移把旧密码文件写入 Core，之后由 Plink 临时文件交付。真实 Plink 登录未在当前环境验证。

## 失败与限制

| 错误码 | 触发条件 |
|---|---|
| `invalid-spec` | 字段缺失、未知字段、路径逃逸、id 格式错误、缺少远端命令、凭据类型与认证方式不符 |
| `target-exists` | `add` 的 id 已存在 |
| `target-not-found` | 引用无法匹配 |
| `ambiguous-target` | 前缀或标签匹配多个目标 |
| `unsupported-protocol` | `transport` 不是 `ssh` |
| `credential-missing` | Core 元数据或 Provider 条目缺失；在连接前失败 |
| `credential-too-large` | 迁移文件超过 1 MiB |
| `capability-unsupported` | 目标未声明 `exec` 或 `shell` |
| `component-unavailable` | 所需 `openssh`/`plink` 组件未登记或状态非 `healthy`；在连接前失败 |
| `target-config-mismatch` | 目标安全字段与 Root 登记的 `targetBinding` 不一致；需要 Root 重新确认 |
| `migration-required` | 目标仍是旧 `auth.path/root`；先显式迁移 |
| `already-migrated` | 目标已使用新认证方式，重复迁移 |
| `encrypted-key-unsupported` | 私钥带口令或无法解析；不自动去口令 |
| `delivery-failed` | 受限临时文件权限或写入失败 |
| `io` | 配置、迁移读取或临时文件清理失败 |

当前限制：

- 只实现 SSH；S3 与 HTTP 未实现。
- `access.capabilities` 仍是目标级能力；Locus 主体授权由注入的 Core 提供，不由目标配置自行决定。
- 没有 `edit` 与交互式补全；修改需重写 `targets.yaml` 或重新 `add`。安全字段变化后访问失败，必须由 Root 重新 `update-credential` 或重新登记目标。
- 探测结果只保留最近一次；`state.sqlite` 可删除并由下一次探测重建。
- 密码认证依赖 Plink，非 Windows 环境需自行提供可执行文件；未验证真实 Plink 登录。
- 带口令私钥没有口令交付契约，迁移明确阻塞。

## 扩展与实现边界

- 新拓扑（直连、FRP、跳板）只改 `connectivity`，不新增代码。
- 新协议需要一个适配器（构造调用 + operation 表）并在组合根显式接入；不建立动态插件加载器。
- 运行时组件状态与 Core 授权由 CLI 通过窄接口注入，不读取组件定义文件；包定义使用 Core 的 defineComponent。
- `targets.yaml` 是唯一可编辑真源；`state.sqlite` 只存探测结果，不从数据库反向生成配置。
- 写入使用临时文件 + rename，单文件整体替换；不做跨进程并发合并。
- 进程执行复用 `createCommandRunner()` 的 execa 路径，不新增 `child_process` 分支。

## 验证依据

- `pnpm test` 覆盖配置校验、路径逃逸、引号、SSH/Plink 参数、凭据绑定、迁移、能力检查、组件前置检查与 SQLite 跨实例读取；`packages/remote-targets/test/security-integration.test.mjs` 使用真实 Core 与内存 Provider。
- 真实目标验证：`node packages/remote-targets/test/manual-ssh.mjs` 在受控临时目录启动本地 OpenSSH sshd，使用 Core 绑定凭据、受限临时私钥和固定 known_hosts 执行 `whoami`，并验证错误私钥拒绝与临时文件清理。
- CLI 用例只验证命令行独有契约：stdin/文件输入、JSON/人类输出、`--yes` 确认与错误退出码；配置校验与执行语义由服务测试覆盖。
