# 决策记录：远程目标接入面

Status: implemented

## 问题

工作环境中存在直连服务器、经 FRP 暴露的 Windows 设备与对象存储，访问方式各不相同，凭据、主机密钥与入口脚本散落在各目标目录中。Agent 需要统一入口执行只读检查与命令，但又不能读到凭据值，也不能绕过入口直连。首个需要解决的问题是：目标定义存在哪里、传输用什么、授权做到什么程度。

## 决定

新增 `components/remote-targets`，由 CLI 的 `remote-targets` 命令域调用，把目标登记为声明式数据并提供 `probe`、`exec`、`shell` 三个动作。

### 存储

- `<dataDirectory>/remote-targets/targets.yaml` 是唯一可编辑真源，保存 `resource`、`identity`、`access`、`connectivity` 四段。
- `<dataDirectory>/remote-targets/state.sqlite` 只保存最近一次探测结果，可删除并由下次探测重建。
- 凭据只保存相对路径引用，凭据根缺省为目标根目录；`identity.auth.root` 可指向已有凭据目录，模块检查存在性，不读取内容，也不创建凭据文件。
- 默认凭据目录为 `credentials/<id>/`，由 `add` 创建但不填充；明文保存是临时方案，待密钥基础设施接管。
- 写入使用临时文件 + rename；读取时校验未知字段、重复 id、绝对路径与 `..` 逃逸。

### 传输

- 密钥认证调用系统 OpenSSH，密码认证调用 Plink；模块只构造参数，不实现 SSH 协议。
- 主机密钥默认写入目标根下的 `known_hosts` 并使用 `accept-new`；显式提供 `knownHosts` 后改为严格校验。密码认证必须提供 `SHA256:` 指纹。
- 远端命令按 `remoteShell` 拼接：POSIX 单引号转义，Windows cmd 对含空白或元字符的参数加双引号。

### 授权

- 当前只有目标级 `capabilities`（`exec`、`shell`），没有调用方 principal 与 grant。
- 未实现的身份与授权不进入配置结构之外的抽象；后续加入时复用同一目标定义，不重写 `connectivity`。

## 备选方案

**采用 `ssh2` 库统一 Windows/Linux。** 收益是单一路径、结构化错误与内置 SFTP/转发；否决原因是协议面与密码材料进入进程，且与 Windows OpenSSH 的算法组合未经验证。首切片的证据只能来自系统客户端，保留后续以真机 spike 再评估的空间。

**以 SQLite 作为唯一注册表。** 否决原因是配置不可 diff、不可评审，单目标无法独立复制或迁移；SQLite 仍保留为运行状态与查询层。

**每个目标一个独立目录或文件。** 否决原因是四段数据的基数不同，每目标一份会把同一路径重复到多个身份，且当前规模不需要目录级拆分。

**立即实现 principal 与 grant。** 否决原因是首个版本需要先证明登记、探测与执行链路；调用方身份可以在不改变目标定义的前提下后置加入。

## 后果

- 目标新增只需要写一份 YAML 并放置凭据引用，不需要改代码；新拓扑（直连、FRP）只改 `connectivity`。
- 依赖系统客户端意味着 OpenSSH/Plink 的可用性与平台差异仍是外部前提；测试只验证参数构造，不启动真实 SSH。
- `targets.yaml` 整体替换，没有跨进程并发合并；并发写入需要后续显式加锁。
- 密码认证在非 Windows 环境需要自行提供 Plink；这是当前保留的兼容成本。
- 目标级能力不等于主体授权：本机任何调用者都能使用已登记目标，审计与最小权限要等 principal 落地。

## 测试

`pnpm test` 覆盖配置校验、路径逃逸、引号与远端命令拼接、OpenSSH/Plink 参数、能力检查、凭据缺失与 SQLite 跨实例读取。CLI 用例只验证命令行独有契约：stdin/文件输入、输出格式、确认与退出码；校验、默认值与执行语义不重复断言。真实目标连接需要手动执行 `probe`，未执行的外部连接不计入测试结论。
