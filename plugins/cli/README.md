# @locus/cli

## 简述与职责

DSH 应用插件，提供 Workspace、能力选择、Filesystem 及只读 Git 的用户入口。只负责参数、用例编排、确认、渲染和退出；不直接生成身份、扫描文件、执行 Git 或读写持久化。

## 启动与命令

使用项目内 DSH 和 `locus` profile，装配步骤见[开发与验证](../../docs/development.md#宿主运行)。`version` 仍打印产品版本 `0.0.0`；`--version` / `-V` 由 DSH 启动器拥有。

完整命令语法、参数与成功判据由[命令手册](../../docs/commands.md#workspace-操作)维护。各层 `--help` 可查看用途与参数；`workspace show` 的 `open` 别名按 Identity 读取，不建立隐藏的当前目录或会话。

## 输出与确认

默认输出人类可读文本；`--json` 输出独立 JSON，诊断写 stderr，不混入提示或 ANSI。查询与写入都支持 JSON，创建和登记返回后续操作所需的 Identity/位置 ID。

关系确认、能力选择和位置登记是显式操作；发现不自动写成员。解除关系、取消能力或位置登记必须携带 `--yes`，且只修改 Locus 自有状态。TTY 与非 TTY 均不隐式等待输入。

退出码：0 表示调用成功（包括 `fs inspect` 明确查询到缺失/拒绝资源，以及 Git 的非仓库结果）；1 表示参数/帮助树拒绝，如未知命令、缺参数、无效选项值或缺少 `--yes`；2 表示业务前置条件、能力缺失、读取/发现/Git 或持久化失败。`fs discover` 根不可访问时返回观察并以 2 退出；`fs read` 的拒绝读取也是失败。

## 能力与生命周期

Plugin 注入 `locus`、`cmdlineArgs`、`appExit`、`appReady`，通过 DSH `parseCmdline` 和 commander 解析。语法解析只选择动作；等待 profile 启动完成后读取可选领域服务，异步用例完成才请求退出，确保正常清理。

`locusFilesystem` / `locusGit` 不是 CLI 的必需注入项。缺失领域 Plugin 时仍可打开 Workspace、查看保存的关系和能力选择；只有相应用例明确失败。`capability list` 的“声明”只来自当前已加载提供方；保存的选择、配置、加载、可用性和按操作检查的授权状态分别显示，不以 Tag 推断可用或授权。

选择能力时接受 `filesystem` / `git`、完整能力标识或提供方包名；用户不需要先区分语义能力与具体实现。`fs` / `git` 用例提示“尚未启用能力”时，先配置对应能力，Workspace 与其他 Plugin 不受影响。

Core、Filesystem、Git 均有不经过 CLI 的实际调用入口；后续 Web 应复用这些用例，不解析 CLI 文本或复制规则。服务与数据所有权见[架构](../../docs/architecture.md)。

## 验证

`pnpm smoke:workspace` 在真实 profile 上连续启动独立 DSH 进程，覆盖完整命令链、人类/JSON、帮助/错误、非交互确认、能力缺失与重启恢复；结果和限制见[验收记录](../../docs/workspace-foundation-validation.md)。
