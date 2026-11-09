# @locus/cli

## 简述与职责

DSH 应用插件，提供 Workspace、能力选择、Filesystem、只读 Git、Remote Machine、Connectivity、Gitea 观察及 Session 关联的用户入口。只负责参数、用例编排、确认、渲染和退出；不直接生成身份、扫描文件、执行 Git/SSH、访问 Gitea API、读取 Session 日志或写持久化。

## 启动与命令

使用项目内 DSH 和 `locus` profile，装配步骤见[开发与验证](../../docs/development.md#宿主运行)。`version` 仍打印产品版本 `0.0.0`；`--version` / `-V` 由 DSH 启动器拥有。

完整命令语法、参数与成功判据由[命令手册](../../docs/commands.md#workspace-操作)维护。各层 `--help` 可查看用途与参数；`workspace show` 的 `open` 别名按 Identity 读取，不建立隐藏的当前目录或会话。

## 输出与确认

默认输出人类可读文本；`--json` 输出独立 JSON，诊断写 stderr，不混入提示或 ANSI。查询与写入都支持 JSON，创建和登记返回后续操作所需的 Identity/位置 ID。

关系确认、能力选择和位置登记是显式操作；发现不自动写成员。解除关系、取消能力或位置登记必须携带 `--yes`，且只修改 Locus 自有状态。单次命令在 TTY 与非 TTY 均不隐式等待输入；只有显式 `shell` 进入读线循环。

退出码：0 表示调用成功（包括 `fs inspect` 明确查询到缺失/拒绝资源、Git 的非仓库结果，以及 `session links` 显示已保存但不可访问的关联）；1 表示参数/帮助树拒绝，如未知命令、缺参数、无效选项值或缺少 `--yes`；2 表示业务前置条件、能力缺失、读取/发现/Git/Session/Remote Machine/Connectivity/Gitea 查询或持久化失败。`fs discover` 根不可访问、`session show/open` 不可访问、`machine observe` 非 observed、`connect inspect` error/unavailable、`connect verify` 非 connected、`gitea instance verify` 非 ok、`gitea repo inspect` 非 available 时以 2 退出；`fs read` 的拒绝读取也是失败。

## 能力与生命周期

Plugin 注入 `locus`、`cmdlineArgs`、`appExit`、`appReady`，通过 DSH `parseCmdline` 和 commander 解析。语法解析只选择动作；等待 profile 启动完成后读取可选领域服务，异步用例完成才请求退出，确保正常清理。

`locusFilesystem` / `locusGit` / `locusRemoteMachine` / `locusConnectivity` / `locusGitea` / `locusSession` 不是 CLI 的必需注入项。缺失领域 Plugin 时仍可打开 Workspace、查看保存的关系和能力选择；只有相应用例明确失败。`session links` 在 Session Plugin 停用时仍列出关联并标记 unavailable；`gitea repos/status` 在 Gitea Plugin 停用时仍显示长期关系；`machine dissociate`、`connect profile remove` 与 `gitea repo unlink` 只修改 Locus 自有配置/关系，不依赖外部连接。`capability list` 的“声明”只来自当前已加载提供方；保存的选择、配置、加载、可用性和按操作检查的授权状态分别显示，不以 Tag 推断可用或授权。

选择能力时接受 `filesystem` / `git` / `remote-machine` / `connectivity` / `gitea` / `session`、完整能力标识或提供方包名；用户不需要先区分语义能力与具体实现。`fs` / `git` / `machine associate` / `session associate` / `gitea repo link` 用例提示“尚未启用能力”时，先配置对应能力，Workspace 与其他 Plugin 不受影响。Connectivity Profile 是机器级配置，Gitea 实例与仓库查询也不要求 Workspace 选择；`gitea repo link` 才写入长期关系。

Core、Filesystem、Git、Remote Machine、Connectivity、Gitea、Session 均有不经过 CLI 的实际调用入口；后续 Web 应复用这些用例，不解析 CLI 文本或复制规则。Session 列表不返回消息正文，`session show` 只读取标题；Remote Machine/Connectivity/Gitea 只返回脱敏失败类别并保留 `--json` 结构。Connectivity 的 `connect open` 会输出必要原生命令参数，其他 Profile 视图默认隐藏身份文件与 known_hosts 路径；Gitea 凭据只显示名称，`gitea runs/run show` 不读取日志或 Artifact。未来 Web 入口仍需限制来源与字段。服务与数据所有权见[架构](../../docs/architecture.md)。

## 长驻 shell

`dsh --profile locus shell` 在同一个 DSH 进程中逐行执行现有命令。CLI 不复制命令处理器：初始化时仍由 `parseCmdline` 识别 `shell`，随后每行重新建立命令树，领域服务从当前 Context 读取，因此 Filesystem/Git/Remote Machine/Connectivity/Session 热重载后无需重启进程。单行失败写入 stderr 并继续；`exit`、`quit` 或 stdin EOF 才请求 `appExit`，退出码取最后一条命令。

每行独立解析意味着不保存隐式当前 Workspace，也不把上一条的 `--json` 或选项带入下一条。Shell 由 CLI 插件持有：CLI 自身热重载时旧读线关闭但不请求进程退出，新插件实例重新进入 shell；Core/host 重载会因服务依赖重建 CLI 实例，同样由新实例接管。

## 验证

`pnpm verify:full` 在真实 profile 上覆盖 launcher、退出码、跨进程恢复、插件停用与一条长驻 shell 会话；验证入口与分层见[测试系统](../../docs/testing.md#分层与入口)。
