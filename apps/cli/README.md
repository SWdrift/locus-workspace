# @locus/cli

## 简述与职责

独立 `locus` 可执行程序。只负责参数/帮助、调用 `@locus/core` 的 Workspace 用例、人类/JSON 渲染与退出码；不生成身份、不写持久化，也不实现第二套领域规则。

CLI 不依赖 DSH、Cordis、profile 或插件装配。每次调用创建自己的 Core，命令完成后 `dispose()`；提供 Workspace/挂载管理与统一 shell，没有 `ui` 或 `fs` 命令。

## 构建与运行

```sh
pnpm install
pnpm build
pnpm locus --help
pnpm locus workspace list
pnpm locus template list
pnpm locus shell <workspace>
```

`pnpm locus` 等价于 `node apps/cli/lib/index.js`，参数原样转发。包声明了 `locus` bin，供发布或外部安装后直接调用；当前仓库内统一使用 `pnpm locus`。完整命令、参数与成功判据由[命令手册](../../docs/commands.md#workspace-操作)维护；各层 `--help` 可查看用途与参数。

## 输出与确认

默认输出人类可读文本；`--json` 输出单行 JSON，诊断写 stderr，不混入提示或 ANSI。查询与写入都支持 JSON，创建和关系写入返回后续操作所需的 Identity/关系 ID。

单次命令在 TTY 与非 TTY 均不隐式等待输入；删除 Workspace、取消挂载与解除关系必须携带 `--yes`。CLI 不保存隐式当前 Workspace，也不把上一条命令的选项带入下一条。

退出码：0 表示调用成功；1 表示参数/帮助树拒绝，如未知命令、缺参数、无效选项值或缺少 `--yes`；2 表示业务前置条件或持久化失败。

## 统一 Shell

`locus shell <workspace>` 启动用户当前平台的 shell，并在子进程中注入：

- `PATH` 前置的临时 `locus` 启动器；
- `LOCUS_CLI`、`LOCUS_WORKSPACE_ID`、`LOCUS_WORKSPACE_NAME`、`LOCUS_WORKSPACE_ROOT`；
- `LOCUS_MOUNTS` 与每个挂载的 `LOCUS_MOUNT_<NAME>`。

`--shell <path>` 指定 shell；`--command <command>` 执行一条命令后退出，子 shell 退出码成为 CLI 退出码；`--print-env` 只输出上下文 JSON。第一个可访问挂载作为 `cwd`，缺失挂载会报告并跳过。完整契约见 [Skill Shell 参考](../../.agents/skills/locus/reference/shell.md)。

## 项目模板

`locus template list` 列出内置模板；`locus template create <template> <destination>` 复制文件夹并写入 `.template.json`。`--dry-run` 只计算文件、目录与 digest。模板命令不读取或创建 Workspace，也不执行模板脚本；完整语义见 [Templates](../../packages/templates/README.md)。

## 数据与生命周期

数据目录由绝对 `LOCUS_HOME` 决定，未配置时使用 `~/.locus-workspace/`；`version` 与 `--help` 不创建目录或数据库。持久化、版本、备份与恢复由 [Core](../../packages/core/README.md#持久化与恢复)维护，CLI 不复制这些规则。

## 验证

`pnpm test` 中的 CLI 用例通过真实子进程运行构建后的 bin，使用临时 `LOCUS_HOME` 覆盖版本、Workspace 读写、关系、挂载、shell 上下文、JSON、退出码与跨进程恢复。验证入口见[测试系统](../../docs/testing.md#分层与入口)。
