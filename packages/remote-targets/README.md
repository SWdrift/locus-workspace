# 远程目标

## 简述与职责

声明式登记远程 SSH 目标，并通过统一入口执行只读探测、单次命令与交互 Shell。目标定义保存为 YAML，探测结果保存为 SQLite；模块只构造系统 OpenSSH/Plink 调用并通过 `execa` 执行，不实现 SSH 协议，也不创建或修改凭据文件。

不负责：目标侧账号与密钥的生成、FRP 隧道生命周期、S3 访问、调用方身份与授权模型。目标自身的安全边界仍由远端 sshd 与网络决定。

## 使用前提

- Node.js 24 或更高；使用构建产物 `lib/`。
- 密钥认证需要 `ssh` 在 `PATH` 中；密码认证需要 Plink，并提供 `connectivity.trust.fingerprint`。
- 凭据文件必须由用户放入目标根目录或 `identity.auth.root` 指向的绝对目录内；模块只检查存在性，不读取内容。
- 目标根目录为 `<dataDirectory>/remote-targets/`，必须由现有 CLI 以绝对数据目录提供；`dataDirectory` 的解析见 [Core](../../packages/core/README.md#持久化与恢复)。

## 使用

```sh
locus remote-targets add win-x --spec target.json
locus remote-targets add win-x --spec -          # 从 stdin 读取 YAML 或 JSON
locus remote-targets list
locus remote-targets show win-x
locus remote-targets probe win-x
locus remote-targets exec win-x -- whoami
locus remote-targets shell win-x
locus remote-targets remove win-x --yes
```

`remote-targets` 可缩写为 `rt`。`add` 只写配置；`probe` 才建立连接并执行 `whoami`。

```yaml
resource:
  kind: windows-device
  label: 223 机器
identity:
  login: Administrator
  auth:
    method: key
connectivity:
  via: frp
  host: 127.0.0.1
  port: 6001
```

默认凭据路径为 `credentials/<id>/id_ed25519`（密钥）或 `credentials/<id>/password`（密码），相对于 `auth.root`。凭据已在其他目录时，设置 `identity.auth.root` 指向该绝对目录即可复用，不需要复制。`add` 创建 `credentials/<id>/` 空目录（权限按平台默认），但不创建凭据文件，也不会加密内容。

```text
<dataDirectory>/remote-targets/
├─ targets.yaml
├─ state.sqlite
└─ credentials/<id>/password | id_ed25519 | known_hosts
```

## 配置与契约

| 字段 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `resource.kind` | 否 | `server` | `windows-device` 时默认远端 Shell 为 `cmd` |
| `resource.label` | 否 | 无 | 可作为 `show`/`exec` 的唯一引用 |
| `identity.login` | 是 | 无 | 目标侧登录名 |
| `identity.auth.method` | 是 | 无 | `key` 或 `password` |
| `identity.auth.path` | 否 | 按方法生成 | 相对 `auth.root`，禁止绝对路径与 `..` |
| `identity.auth.root` | 否 | 目标根目录 | 凭据根的绝对路径；用于复用已有凭据目录 |
| `access.capabilities` | 否 | `exec, shell` | 当前只接受这两个值 |
| `connectivity.transport` | 否 | `ssh` | 目前只支持 `ssh` |
| `connectivity.via` | 否 | `direct` | `direct` 或 `frp`；仅用于诊断 |
| `connectivity.host` | 是 | 无 | 主机名或地址 |
| `connectivity.port` | 否 | `22` | 1-65535 |
| `connectivity.remoteShell` | 否 | 按资源类型 | `posix` 或 `cmd` |
| `connectivity.client` | 否 | `ssh` / `plink` | 客户端可执行文件 |
| `connectivity.trust.knownHosts` | 否 | `credentials/<id>/known_hosts` | 显式提供时使用 `StrictHostKeyChecking=yes` |
| `connectivity.trust.fingerprint` | 密码认证必填 | 无 | Plink `-hostkey` 使用 |

未知字段直接拒绝，不静默忽略。目标引用顺序：精确 id → 唯一前缀 → 唯一标签；歧义时列出候选并失败。

密钥认证使用 OpenSSH，默认 `StrictHostKeyChecking=accept-new` 并把主机密钥写入目标根下的 `known_hosts`；显式提供 `trust.knownHosts` 后改为严格校验。密码认证使用 Plink，`-pwfile` 读取凭据文件，`-hostkey` 钉死指纹。

远端命令按 `remoteShell` 拼接：`posix` 使用单引号转义，`cmd` 对含空白或元字符的参数加双引号。`cmd` 转义只覆盖常见情况，复杂命令应由调用方直接给出单条脚本。

## 失败与限制

| 错误码 | 触发条件 |
| --- | --- |
| `invalid-spec` | 字段缺失、未知字段、路径逃逸、id 格式错误、缺少远端命令 |
| `target-exists` | `add` 的 id 已存在 |
| `target-not-found` | 引用无法匹配 |
| `ambiguous-target` | 前缀或标签匹配多个目标 |
| `unsupported-protocol` | `transport` 不是 `ssh` |
| `credential-missing` | 凭据文件不存在；在连接前失败 |
| `capability-unsupported` | 目标未声明 `exec` 或 `shell` |
| `io` | 配置读写失败 |

当前限制：

- 只实现 SSH；S3 与 HTTP 未实现。
- 没有调用方身份与授权模型；`capabilities` 是目标级能力声明。
- 没有 `edit` 与交互式补全；修改需重写 `targets.yaml` 或重新 `add`。
- 探测结果只保留最近一次；`state.sqlite` 可删除并由下一次探测重建。
- 密码认证依赖 Plink，非 Windows 环境需自行提供可执行文件。

## 扩展与实现边界

- 新拓扑（直连、FRP、跳板）只改 `connectivity`，不新增代码。
- 新协议需要一个适配器（构造调用 + 能力声明）并在组合根显式接入；不建立动态插件加载器。
- `targets.yaml` 是唯一可编辑真源；`state.sqlite` 只存探测结果，不从数据库反向生成配置。
- 写入使用临时文件 + rename，单文件整体替换；不做跨进程并发合并。

## 验证依据

- `pnpm test` 覆盖配置校验、路径逃逸、引号、SSH/Plink 参数、能力检查与 SQLite 跨实例读取；测试不启动真实 SSH。
- CLI 用例只验证命令行独有契约：stdin/文件输入、JSON/人类输出、`--yes` 确认与错误退出码；配置校验与执行语义由服务测试覆盖。
- 真实目标验证需手动执行 `probe` 与只读命令；未执行的外部连接不作为测试通过依据。
