# 远程目标参考

对已登记目标执行探测、单次命令或交互 Shell。所有访问都经 `locus remote-targets`（别名 `rt`）；不要直接调用 `ssh`、`plink` 或读取凭据文件。

执行还需 Core 主体授权与按 slot 绑定；未初始化时由用户在可信本地 TTY 运行 init，普通 User 访问不要求 Root。目标配置只保存 `credential:<id>`；Root 在 `remote-targets add` 时同时写入目标配置与字段，之后用 `update-credential` 修改字段。旧文件只用于显式迁移。详见[安全参考](security.md)。

## 读取当前事实

```sh
locus --json remote-targets list
locus --json remote-targets show <target>
```

`show` 返回 `resource`、`identity`、`access`、`connectivity` 与可选的 `lastProbe`。`<target>` 接受 id、唯一前缀或唯一标签；歧义时命令失败并列出候选。

## 登记目标

```sh
locus remote-targets add <id> --spec - --file <key> --json
```

从 stdin 读取 YAML 或 JSON；`add` 在 Root 批准后写 `<dataDirectory>/remote-targets/targets.yaml`、创建 `credentials/<id>/` 空目录并登记 CredentialRef 字段。私钥必须用 `--file`，密码隐藏输入。后续改密/换钥用 `update-credential`。

```yaml
resource:
  kind: windows-device
  label: 223 机器
identity:
  login: Administrator
  auth:
    method: private-key
    credential: credential:server-key
connectivity:
  via: frp
  host: 127.0.0.1
  port: 6001
```

密码目标使用 `method: password` 和密码引用。登记示例：

```sh
locus remote-targets add win-x --spec target.json --file /absolute/selected-key
locus remote-targets update-credential win-x --credential credential:server-key --method private-key --file /absolute/selected-key
```

未知字段会被拒绝。

## 迁移旧目标

```sh
locus remote-targets migrate <target> --credential credential:server-key --yes
```

命令读取旧 `auth.path/root` 文件，经 Root 通过对应 `register-*` 能力写入 Core、回读验证并绑定到精确目标资源，再改写目标配置；原文件保留。私钥带口令时以 `encrypted-key-unsupported` 阻塞；不要自行去口令或把口令放入 argv/env。

## 访问目标

```sh
locus remote-targets probe <target>
locus remote-targets exec <target> -- whoami
locus remote-targets shell <target>
```

- `probe` 执行 `whoami`，成功退出 0，失败退出 1，并记录最近结果。
- `exec` 的远端退出码原样成为 CLI 退出码；命令选项放在 `--` 之后。
- `shell` 继承当前终端；退出码取 SSH/Plink 客户端。
- `--json` 下 `exec` 返回 `{ targetId, exitCode, stdout, stderr }`。

## 失败判据

| 现象 | 含义 |
| --- | --- |
| `migration-required` | 目标仍使用旧文件认证；先显式迁移 |
| `encrypted-key-unsupported` | 私钥带口令或无法解析；迁移不写配置 |
| `credential-missing` | Core 元数据或 Provider 条目缺失；连接前失败 |
| `目标未授权能力` | `access.capabilities` 未包含 `exec`/`shell` |
| `目标前缀不唯一` / `目标标签不唯一` | 使用完整 id |
| `password 认证必须提供 ... fingerprint` | 密码目标缺少 `connectivity.trust.fingerprint` |

远端命令失败时保留 stderr 并返回远端退出码；不要把入口命令的成功当成任务完成，需用远端可观察状态复核。
