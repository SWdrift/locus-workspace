# CP Remote Targets

## Control Plane Role

本平面控制 `remote-targets` 子系统的建设：目标身份（Identity）、访问授权（Access）、连接通道（Connectivity）三域的边界、持久化分工与首个切片。参考实现为 `X:\APPs\Server`（连接目录 + 入口脚本），产品形态是接入面而非服务端。

它不拥有领域正文：三域的职责、数据模型、流程、不变量与失败边界归 `docs/subsystems/remote-targets.md`，模块用法归包旁 README。子系统排队与跨子系统顺序由 [Subsystems 平面](./cp-2026-11-14-subsystems.md)维护；本平面只控制该子系统内部推进，不重复其清单与依赖决策。

三域划分与“配置文件 + SQLite”是已定方向；其余细节（配置文件位置与格式、SQLite 承载范围、首切片目标类型、访问模型初版范围）尚未确定，以本平面“待定决策”为准，未定前不写进设计文档或代码。

## Meta Reference

- [cp-meta.md](./cp-meta.md)：控制平面结构、命名与更新规则。
- `X:\APPs\Server\AGENTS.md`：目录组织、凭据边界、入口契约与失败码。
- `X:\APPs\Server\SERVICES.md`：FRP 设备、直连服务器与 S3 连接的现行登记格式。
- [项目架构](../docs/architecture.md)：新增能力建立普通 package、在组合根显式接入。
- [子系统设计规范](../docs/subsystems/README.md)：子系统文档的归属与写作要求。
- [开发与验证](../docs/development.md)、[测试系统](../docs/testing.md)：验证入口与分层。
- 扩展使用 `create-control-plane`；收尾与压缩使用 `compact-control-plane`。

## Scope

- `packages/targets`（暂名）：Identity / Access / Connectivity 三域模型与校验、目标导入、适配器与失败语义。
- 声明式配置文件：候选格式（YAML / JSON）、schema、加载与校验、与现网 `SERVICES.md` / `*.conf.cmd` 的导入关系。
- SQLite：投影表、Workspace 关联、运行时状态与迁移。
- `apps/cli` 的 `target` 子命令与 JSON 输出；`.agents/skills/locus` 的对应参考。
- 不包含：SSH/FRP/rclone 协议实现、集中式服务端与凭证库、frp-panel 管理 UI、隧道编排、远程开发环境编排、批量配置管理。

## Core Rules

- 三域只回答各自问题，不互相内联：Identity 回答“目标是谁、用什么认证主体与信任锚”；Access 回答“能做什么、在什么条件下允许”；Connectivity 回答“经哪条路径、用什么地址到达”。跨域只以稳定目标 ID 引用。
- 单一真源：同一事实只允许一个可编辑真源。当前默认配置为真源、SQLite 为投影索引与运行时状态；若改为 SQLite 可编辑注册表，必须同时删除配置侧的重复定义。配置变更通过显式同步进入 SQLite，不靠启动扫描。
- 秘密只存引用：配置文件与 SQLite 都不保存密码、私钥、Access Key；执行时按引用读取，错误、日志与 JSON 输出全链路脱敏。
- 传输调用现成客户端（OpenSSH / Plink / rclone），不实现协议；主机密钥钉死是连接前提，TOFU 仅显式授权。
- 未登记或未授权的目标必须明确失败，不得静默回退到未登记连接或降低校验。
- 三域边界先于实现冻结：每域先定不变量与失败模式，再定 schema 与命令。
- 行为变更先取得真实运行证据；完成以 `pnpm verify` 与真实目标只读 `exec` 的可观察结果为准，需要 e2e 时遵循 2 小时冷却。
- 长期结论写设计文档、包 README 或 Agent Notes；本平面只保留行动判断、未决状态与该子系统后续仍需的坑点（写入同 scope CPM）。

## Task Board

- [ ] 确认三域语义：Identity 是否包含调用方（人/Agent/Workspace）身份，或仅目标与认证身份
- [ ] 确认机制清单（10 个核心机制），并作为设计文档骨架的章节输入
- [ ] 依赖决策：`yaml` 直接引入；传输层在系统客户端与 `ssh2` 之间做真机 spike 后再定
- [ ] 冻结 `SecretRef` 模型：`file` / `env`、根内解析、四类失败码
- [ ] 脱敏测试：错误、JSON、日志与子进程 argv 均不含已加载的秘密值
- [ ] 创建 `docs/subsystems/remote-targets.md` 骨架，冻结三域职责、不变量与失败边界
- [ ] 定声明式配置文件格式与 schema：目标、认证引用、信任锚、授权、连接参数
- [ ] 定 SQLite 表与迁移：投影索引、Workspace 关联、运行时状态
- [ ] 定首切片：直连 SSH 与 FRP 的 `exec`，S3 作为第二适配器
- [ ] 冻结 `packages/targets` 入口、调用方与最小公共 API
- [ ] 只读导入 `X:\APPs\Server` 的一个直连目标与一台 FRP 设备，真实执行只读命令验证

## 设计草案：三域

| 域 | 回答的问题 | 主要内容 | 明确不负责 |
| --- | --- | --- | --- |
| Identity | 目标是谁；以谁的身份、凭什么信任访问 | 稳定目标 ID、名称、类型；认证主体（用户/角色）；凭据引用；主机密钥指纹 | 地址与端口、隧道参数、可执行操作集合 |
| Access | 能做什么；什么条件下允许 | 能力集合（`exec` / `shell` / `copy` / 对象读写）；授权主体；确认与限制条件 | 凭据值、传输路径、连接健康 |
| Connectivity | 怎么到达 | 传输类型（直连 / FRP stcp / S3 endpoint）、地址、端口、区域、客户端选择、可达性状态 | 目标身份定义、凭据内容、授权判定 |

## 草案：存储分工

| 数据 | 归属 | 说明 |
| --- | --- | --- |
| 目标身份、认证引用、信任锚、授权、连接参数 | 声明式配置文件（格式待定） | 可评审、可版本化；秘密只写引用 |
| 目标投影索引、Workspace 关联、可达性/最近使用等运行时状态 | SQLite | 由同步命令从配置投影；不反向成为可编辑真源 |
| 密码、私钥、Access Key / Secret | 目标目录下的既有凭据文件 | 两处都不保存；仅执行时读取并脱敏 |

## 机制草案（待确认）

当前能力可归约为 10 个核心机制；前 10 项缺一即无法安全复现现有能力，后 3 项为可延后项。

| # | 机制 | 必须保证 | 域 | 现有证据 |
| --- | --- | --- | --- | --- |
| 1 | 注册与稳定标识 | 每目标唯一 ID，与目录/配置一一对应；清单是索引，不是第二份定义 | Identity | `SERVICES.md` 章节与 `servers/<IP>/`、`frp/<设备>/` 同名约束 |
| 2 | 类型化定义与固定解析顺序 | 按目标类型校验必填字段、拒绝未知字段；优先级固定为内置默认 < 全局 < 目标 < 命令行 | Identity / Connectivity | `server.conf.cmd`、`ssh.conf.cmd`、`s3.conf.cmd` 三套变量；`if not defined` 覆盖 |
| 3 | 秘密引用与前置校验 | 只存引用；执行前校验存在且非空；值不进 argv、环境、日志、JSON | Identity | `-pwfile`、密钥文件路径、`.s3/credentials.cmd`、空文件退出 `2` |
| 4 | 信任钉死 | 指纹必填，连接前校验；不匹配即失败；TOFU 需显式一次性授权 | Identity | Plink `-hostkey`、OpenSSH 固定 `known_hosts` + `BatchMode` |
| 5 | 传输适配器 | 适配器拥有客户端选择、参数、超时与非交互模式；调用方只给目标与 argv | Connectivity | Plink / OpenSSH / rclone 三套调用形态 |
| 6 | 路径前置条件 | 本地端口监听、visitor 映射、隧道客户端就绪、endpoint 可达分别判定，不复用同一错误 | Connectivity | FRP visitor 端口映射、frpp 就绪日志 |
| 7 | 执行契约 | `exec(argv)` 与 `shell(pty)` 两态；引号与分词由适配器处理；stdout/stderr 分离；远端退出码透传 | Access / Connectivity | `access.cmd %*`、无参数时交互、退出码传播 |
| 8 | 错误分类 | 配置无效 / 秘密缺失 / 信任不符 / 不可达 / 认证失败 / 远端退出码，各自可判且消息含目标、规则与修复方式 | 全体 | 退出码 `2`/`1` 与失败模式表 |
| 9 | 注册生命周期 | 新增目标 = 复制模板 + 只改一处配置 + 校验 + 只读冒烟；模板可提交，凭据与目标目录不入 Git | 全体 | `win-template`、`s3-template`、`servers/1.2.3.4` |
| 10 | 调用契约 | CLI JSON 是唯一机器接口；禁止绕过入口直连；只读优先；破坏性操作先确认 | Access | `remote-machine-control` 的操作约束 |
| 11 | 状态投影（延后） | SQLite 记录可达性、最近使用、Workspace 关联，供 `list/status` 读取 | Connectivity | 目前无，新增 |
| 12 | 隧道监督（延后） | 本地 frpp 客户端启动/停止与就绪判定 | Connectivity | `temp/frpp` 手工启动与日志判据 |
| 13 | 最小审计（延后） | 记录目标、命令摘要、退出码；不含秘密与完整输出 | Access | `!!!注意-密钥与凭据.md` 的泄露教训 |

轻量判据（违反任一条即不再轻量）：无守护进程与网络服务；不实现协议；不存凭据值；新增目标只需改一处配置；单条命令可完成诊断与只读验证。

## 依赖评估（待确认）

版本与维护状态取自 npm registry（2026-11-14）；仓库要求 Node >= 24、ESM，Core 与 Templates 只依赖内置模块，新增依赖应落在独立 package。

| 用途 | 候选 | 结论 |
| --- | --- | --- |
| 配置解析 | `yaml@2.9.1`（ISC，0 依赖） | 直接引入：唯一明确收益，支持注释与稳定 diff |
| 配置校验 | 手写 / `valibot@1.5.0` / `zod@4.6.7`（均 0 依赖） | 首版手写；配置增长后再引入 |
| SSH 传输 | `ssh2@1.17.0`（MIT，2 依赖，可选原生 `cpu-features`） | 有条件：可统一 Windows/Linux 并替代 Plink；须真机 spike |
| PTY | `node-pty@1.1.0`（MIT，原生） | 延后；`shell` 先用继承 stdio |
| S3 | rclone / `minio@8.0.7`（Apache-2.0，13 依赖） | 保持 rclone；需要预签名或流式接口再评估 |
| SQLite | `node:sqlite` | 已在使用，无需包 |
| 进程调用 | `node:child_process` | 无需 `execa` / `cross-spawn` |
| 不引入 | `better-sqlite3`、`ssh2-sftp-client`、`tunnel-ssh`、`keytar`、`ssh-config`、`frp` | 分别被内置模块、`ssh2` 内置 SFTP、FRP 传输、文件凭据、自有配置格式与同名无关包替代 |

`ssh2` 的取舍：收益是单一路径（密码与密钥认证、`hostVerifier` 指纹校验、`exec`/`shell`/SFTP/端口转发、结构化错误），可去掉 Plink 与 `known_hosts` 两套信任存储的分叉；代价是协议面进入进程、密码需读入内存、与 Windows OpenSSH 的算法组合需真机验证，且可选原生依赖可能带来安装摩擦。未通过 spike 前不改变“调用现成客户端”的规则。

## 秘密处理（草案）

**不变量**

1. 配置、SQLite、日志、错误、JSON 与 argv 只出现 `SecretRef`，不出现秘密值；`target show` 只输出 `hasCredential` 与相对引用。
2. `SecretRef` 初版只允许 `file`（相对目标根，规范化后必须仍在根内）与 `env`（仅注入子进程）；禁止内联值与绝对路径。
3. 读取发生在适配器执行前一刻，读取后只交给传输客户端，不进入通用上下文或缓存。
4. 权限按文件所在平台判定：POSIX 下目标目录 `0700`、秘密文件 `0600`/`0400`，否则 `secret-permission`；Windows 首版依赖 ACL，不解析，作为已知边界记录。
5. 失败分类：`secret-missing` / `secret-empty` / `secret-permission` / `secret-unreadable` 均在连接前失败；`auth-failed` 单独分类；任何失败都不回退到未登记连接或降低校验。
6. 脱敏是兜底：注册已加载值并替换输出中的精确出现，同时按构造避免把秘密拼入命令、错误消息与结构化字段。
7. 轮换使用临时文件 + rename 原子替换；只读验证通过后再删旧值；泄露即轮换，不依赖脱敏。
8. 传输凭据（frpp `.env`、frps token、stcp secretKey、面板 JWT）不归本子系统，不读取、不缓存、不代管。

**存储与消费**

| 秘密 | 文件 | 形式 | 消费方 |
| --- | --- | --- | --- |
| 服务器密码 | `<target>/.ssh/password` | 明文首行 | Plink `-pwfile`；`ssh2` 读取 |
| SSH 私钥 | `<target>/.ssh/id_ed25519` | OpenSSH 私钥 | OpenSSH `-i`；`ssh2` `privateKey` |
| S3 凭据 | `<target>/.s3/credentials` | `KEY=VALUE` 集合 | rclone 子进程环境；`minio` 读取 |

主机公钥与指纹是公开信息，不是秘密：可写入声明式配置作为信任锚，变更需重新核验。

**解析顺序**：引用 → 根内校验 → 存在/非空/权限 → 按类型读取（密码首行、私钥解析、凭据键值）→ 仅适配器持有 → 输出脱敏 → 释放引用。

**不采用**：SQLite 存值或哈希、全局环境变量、keychain/DPAPI/加密文件（首个真实需求前）、把秘密拼进远端命令。

## 待定决策

| 决策 | 选项 | 备注 |
| --- | --- | --- |
| Identity 范围 | 目标 + 认证主体 + 信任锚（推荐） / 另含调用方身份 | 调用方身份会牵入 Access 的主体模型 |
| 配置文件位置与作用域 | 用户级全局目录 / 每 Workspace / 仓库内 | 决定目标可否跨 Workspace 复用 |
| 配置格式 | YAML 主推；JSON 仅作生成物 | 需支持注释与稳定 diff |
| SQLite 承载范围 | 纯投影 + 运行时状态 / 另含可编辑注册表 | 前者保持单一真源，后者需冲突合并 |
| 传输层实现 | 系统客户端（现状）/ `ssh2` 库 | 需对直连 Linux 与 FRP Windows 做真机 spike |
| 权限校验强度 | POSIX 强制失败、Windows 依赖 ACL / 两平台仅告警 | 强制失败更安全，但会挡住现有 Windows 目标 |
| `SecretRef` 初版 | 仅 `file` / `file` + `env` | `env` 便于 CI 与临时目标 |
| 认证方式 | 密码与密钥并存 / 优先迁移到密钥 | 密钥可轮换且不进入内存明文 |
| 未来密钥库 | 暂不引入 / `@napi-rs/keyring` | 团队共享或跨机复用出现后再评估 |
| 首切片 | 直连 + FRP 的 `exec`，S3 次之 / 三类一次覆盖 | 前者可最快取得真实证据 |
| 访问模型初版 | 仅能力集合 / 主体级授权（人、Agent、Workspace） | 主体授权需先定调用方身份 |
| 与 Workspace 关系 | 独立目录 / 复用现有 `association` 关系 | 复用可避免第二套关联模型 |
