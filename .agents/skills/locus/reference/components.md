# 组件参考

组件是 Locus 对现实软件能力的登记与观察。它回答“有什么、现在怎么样”，不授予权限，也不代替原生命令。纯 Locus 组件由包提供；外部组件（如 Docker、OpenSSH）需要显式登记。

## 读取当前事实

```sh
locus --json component list
locus --json component show docker
locus --json docker
```

`list` 返回 `{ components, problems }`，人类输出带状态时长；损坏定义只进入 `problems`，不影响其他组件。`show` 与顶层 `<id>` 等价，输出中 `external.state` 为 `null` 表示未探查，`checkedAt` 是观察时间。

## 登记外部组件

```sh
locus component add examples/components/openssh.yaml
locus component add examples/components/plink.yaml
locus component add examples/components/docker.yaml
locus component add ./my-component/          # 文件夹形态：component.yaml + 配置
locus component add - < my-component.yaml
```

只接受 `kind: external`。文件写入 `<dataDirectory>/components/<id>.yaml`，文件夹整体复制为 `<id>/`。重复 id、与包组件同 id，或使用 Core 自有的 `locus` 会被拒绝；与内置命令同名的组件使用 `component show <id>`，不会抢占内置命令。

批量登记可以直接把多个 YAML 复制到 `<dataDirectory>/components/`，不必逐条执行 `add`；损坏文件只进入 `list` 的 `problems`。

## 探测与部署

```sh
locus component probe docker
locus component probe --all
locus component deploy my-service --yes
```

- `probe` 支持三种定义：`argv`（默认，`ENOENT` 为 `absent`，退出 0 为 `healthy`，非零按 `onFailure`）、`tcp`（连接成功为 `healthy`）与 `http`（状态码匹配 `expectStatus` 为 `healthy`）。超时归为 `abnormal`。
- `probe --all` 在同一进程内逐个探查所有 `external` 组件，无探针的定义跳过；任一未通过时退出 1。
- Windows 的 `.cmd`/`.bat`（如 `pnpm.cmd`、`code.cmd`）由 execa 解析，探针直接写 `[pnpm, --version]`，不要额外包 `cmd /c`。UTF-16LE 输出会被识别，纯中文 UTF-16 与 GBK 仍可能乱码，以状态码为准。
- 端口或服务探针用 `tcp`/`http`，并声明 `onFailure: stopped`，把“未监听”与“异常失败”区分开：

```yaml
probe:
  kind: tcp
  host: 127.0.0.1
  port: 5432
  onFailure: stopped
```

- `deploy` 需要 `--yes`；本仓库的示例组件都不声明部署入口（`not-deployable`）。不要假设 Locus 会自动安装软件。
- 探测结果只是动作时点的观察；较早的 `checkedAt` 不能当作当前事实。

## 包组件与升级

包组件首次访问组件服务时物化到 `<dataDirectory>/components/`，定义字段来自包代码。文件 `version` 与代码不一致时，`show` 标记 `needsUpgrade`，但不会自动改写：

```sh
locus component upgrade remote-targets
```

升级会覆盖定义字段并保留 `config`。包组件不能删除；删除物化文件后会在下次访问时按当前版本重建。

## 与远程目标的关系

`remote-targets` 组件依赖 `openssh`；密钥目标在连接前检查该组件状态，密码目标检查 `plink`。未登记或状态非 `healthy` 时会失败：

```sh
locus component add examples/components/openssh.yaml
locus component probe openssh
locus remote-targets exec <target> -- whoami
```

不要直接调用 `ssh`/`plink` 绕过入口；组件状态检查不替代目标的凭据与能力检查。

## 硬规则

- 先 `show`/`probe` 再使用；`unknown` 不是可用。
- 不因组件存在就认为当前 Agent 被授权执行某个操作。
- capabilities 只是需求，修改 YAML、requires 或健康状态不能获得权限；Pure／Referenced 走统一 Core Security，external 不自动继承身份、Grant 或秘密。
- 不自动安装、不自动启停服务；`deploy` 只在用户明确要求时执行。
- 区分 `absent`（不存在）与 `stopped`（已安装但未运行），不要用“没装”解释运行失败。
- 只登记有状态、有门禁或有操作入口的软件；纯版本查询直接用原生命令。
- 定义可由用户编辑；机器相关值随文件复制，跨机后重新探测。
