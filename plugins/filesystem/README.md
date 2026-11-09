# @locus/filesystem

## 简述与职责

首个实际领域 Capability：显式登记本机位置、查询资源状态、单层发现与有界文件读取。Plugin 自有位置配置和原生 I/O；Core 只保存用户确认的长期关系，不解释路径、扫描或权限规则。观察不持久化，不自动创建成员、复制文件或修改原生目录结构。

## 装配与使用

按[开发与验证](../../docs/development.md#宿主运行)将本包链接到项目内 `locus` profile 并合入插件行。Plugin 注入 `locus`，提供 `locusFilesystem`；其 Capability 标识为 `locus.filesystem`，提供方为 `@locus/filesystem`，Tag `environment` 仅用于分类。

Workspace 必须先选择本提供方，才能登记或使用观察/发现/读取。取消能力选择后仍可列出和取消位置登记；卸载 Plugin 不删除配置或 Core 关系。CLI 语法由[命令手册](../../docs/commands.md#workspace-操作)维护，非终端调用使用 `createFilesystemService(locus)` 与 [contracts](../../packages/contracts/README.md) 中的实际局部协议。

## 位置与引用

同 Workspace、同主机、同规范化绝对路径的登记幂等；不同 Workspace 可以登记同一目录，父子和不相邻路径不强制合并。路径不存在仍可显式登记，登记动作不创建路径。取消位置只移除发现入口，不删除文件和此前已确认关系。

引用使用主机限定命名空间及本机 file URL，属于**地址引用**，不是跨设备对象身份。改名或移动文件不自动追踪，大小写别名、hardlink 与 symlink 不自动合并；异机恢复保留原引用并报告 `unavailable`，不重新绑定本机同名路径。

位置登记与成员确认是不同操作：`fs discover` 的候选只包含本次观察；`fs confirm` 才将所选引用及发现来源交给 Core。未确认的候选不成为长期成员。Core 也允许显式保存其他命名空间的外部引用，不要求 Filesystem 是所有 Workspace 的前提。

## 读取与失败语义

- `inspect` 每次进行真实 I/O，区分 `accessible`、`missing`、`denied`、`unavailable`、`error`，并返回资源种类和观察时间。权限检查以具体操作为准，不从能力选择或 Tag 推定。
- `discover` 只枚举指定目录一层，默认最多 200、上限 1000；多读一个目录项判断截断，不先收集完整目录。仅排序选中的有界原生枚举前缀，不承诺目录快照或跨调用的全局顺序。非目录返回其自身观察和空条目，不递归扫描。
- `read` 只读取普通文件，默认 65536 字节、最多 1MiB；UTF-8 截断保留完整字符前缀。读取失败明确抛错，不把拒绝读取当成空文件。
- 相对路径不得是绝对路径或越过登记范围；符号链接/junction 可以观察但不遍历，包括登记在链接下的路径。普通 Node 路径检查不构成对恶意并发替换的 OS 沙箱。
- 原生错误保留错误类别，不回显可能包含敏感内容的原生异常正文；未知状态不伪装成缺失或成功。

## 数据与生命周期

本 Plugin 独占 `locus.dataDirectory/filesystem.sqlite`，实验版本 `user_version=1`；Core 不读写其中的领域数据。位置写入使用 SQLite 原子语句及 DELETE/FULL 配置，锁等待 1000ms 后失败；未知版本或损坏库不自动重建。0 字节库按初始化中断后的空库处理并建立当前结构；已有结构却无版本则拒绝覆盖。完整备份与恢复要求见 [Core 恢复说明](../../packages/core/README.md#持久化与恢复)。

fiber 卸载等待在途有界 I/O 并关闭数据库，不删除登记；释放后拒绝新调用。Plugin 不持有 Core 内部对象，仅使用公开用例和共享数据目录位置。

## 验证

`pnpm test:all` 使用真实临时目录、文件、SQLite 和链接验证范围、状态、读取、配置恢复与生命周期；`pnpm verify:full` 通过真实 DSH profile 验证产品操作。平台与路径限制见本文，验证入口见[测试系统](../../docs/testing.md#分层与入口)。
