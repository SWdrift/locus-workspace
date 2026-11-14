# 远程目标参考

对已登记目标执行探测、单次命令或交互 Shell。所有访问都经 `locus remote-targets`（别名 `rt`）；不要直接调用 `ssh`、`plink` 或读取凭据文件。

## 读取当前事实

```sh
locus --json remote-targets list
locus --json remote-targets show <target>
```

`show` 返回 `resource`、`identity`、`access`、`connectivity` 与可选的 `lastProbe`。`<target>` 接受 id、唯一前缀或唯一标签；歧义时命令失败并列出候选。

## 登记目标

```sh
locus remote-targets add <id> --spec - --json
```

从 stdin 读取 YAML 或 JSON；`add` 写 `<dataDirectory>/remote-targets/targets.yaml` 并创建 `credentials/<id>/` 空目录，不建立连接，也不创建凭据文件。

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

默认凭据路径为 `credentials/<id>/id_ed25519` 或 `credentials/<id>/password`，由用户放入；模块只检查存在性。未知字段会被拒绝。

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
| `缺少凭据文件` | 连接前失败；按 `show` 的 `identity.auth.path` 放置文件 |
| `目标未授权能力` | `access.capabilities` 未包含 `exec`/`shell` |
| `目标前缀不唯一` / `目标标签不唯一` | 使用完整 id |
| `password 认证必须提供 ... fingerprint` | 密码目标缺少 `connectivity.trust.fingerprint` |

远端命令失败时保留 stderr 并返回远端退出码；不要把入口命令的成功当成任务完成，需用远端可观察状态复核。
