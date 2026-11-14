# 远程目标

## 范围

远程目标是接入面的第一个实现：把异构网络中的 SSH 目标登记为声明式数据，经统一入口探测与执行，不暴露第二条直连路径。当前覆盖 `packages/remote-targets`、`apps/cli` 的 `remote-targets` 命令域与 `.agents/skills/locus` 的参考页。

不包含：调用方身份与授权模型、S3/HTTP 协议、FRP 隧道生命周期、凭据生成与轮换。

## 三域与资源锚点

每个目标由三段组成，资源 id 是唯一锚点：

| 段 | 回答 | 当前字段 |
| --- | --- | --- |
| Identity | 以谁的身份访问、凭据在哪里 | `login`、`auth.method`、`auth.path` |
| Access | 能对目标做什么 | `capabilities`（`exec`、`shell`） |
| Connectivity | 经哪条路径到达 | `transport`、`via`、`host`、`port`、`remoteShell`、`trust` |

`resource`（`kind`、`label`）描述被访问对象，不携带身份、路径或能力。当前尚未引入调用方 principal 与 grant；`capabilities` 是目标级声明，不是主体授权。

## 存储

- `<dataDirectory>/remote-targets/targets.yaml`：唯一可编辑真源，保存全部目标定义。
- `<dataDirectory>/remote-targets/state.sqlite`：只保存最近一次探测结果，可删除并重建。
- 凭据文件：位于目标根目录或 `identity.auth.root` 指向的绝对目录内，由 `identity.auth.path` 相对引用；配置文件只保存路径。
- `<dataDirectory>/remote-targets/credentials/<id>/`：`add` 创建的空目录，用户放入密码、私钥或 `known_hosts`；不加密，属于临时方案。

目标根目录由 CLI 从 Core 的 `dataDirectory` 派生，不在模块内推断默认位置。写入使用临时文件 + rename；读取时校验字段、id 唯一性与路径是否逃逸凭据根。

## 流程

1. `add`：校验 spec、检查 id 未占用、创建默认凭据目录、整体写入 `targets.yaml`；不建立连接，不创建凭据文件。
2. `show`：按精确 id、唯一前缀或唯一标签解析，附加最近一次探测。
3. `probe`：检查能力与凭据，构造 `whoami` 调用，记录成功/失败与时间。
4. `exec`：检查 `exec` 能力与凭据，执行并由 CLI 透传远端退出码。
5. `shell`：检查 `shell` 能力与凭据，以继承 stdio 的方式启动 SSH 客户端。

## 不变量

- 定义只有 `targets.yaml` 一个可编辑真源；SQLite 不反向生成配置。
- 凭据引用必须是凭据根内的相对路径，禁止绝对路径与 `..`；凭据根缺省为目标根目录。
- 未知字段、重复 id、无法解析的引用都明确失败，不静默回退。
- 能力检查在建立连接前完成；缺少凭据时不启动客户端。
- 传输只调用系统 OpenSSH/Plink，不实现协议；主机密钥默认写入凭据根下的 `known_hosts`，密码认证必须钉死指纹。
- 秘密值不进入配置、SQLite、输出或命令行参数。

## 失败边界

| 场景 | 行为 |
| --- | --- |
| 配置无效 | `invalid-spec`，退出码 2，不写文件 |
| 目标重复 | `target-exists`，退出码 2 |
| 引用歧义 | `ambiguous-target`，列出候选，退出码 2 |
| 凭据缺失 | `credential-missing`，连接前失败，退出码 2 |
| 远端退出码非零 | `exec` 原样透传；`probe` 记为失败并以 1 退出 |
| 主机指纹不符 | SSH/Plink 自身拒绝，stderr 保留诊断 |

## 未实现

调用方 principal 与授权、S3 协议、目标编辑、交互式 spec 补全、并发写入合并。新增协议时按适配器接入，不恢复插件运行时。
