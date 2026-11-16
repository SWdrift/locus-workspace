# 开发与验证

构建、运行与数据位置见本页；测试分层、夹具与编写约束见[测试系统](testing.md)。

## 前置条件与构建

Node.js 24 或更高、pnpm 11.24.0。执行 `pnpm install`，修改源码后执行 `pnpm build`。构建先生成 Core 的版本模块，再按根 tsconfig 编译 Core、PostgreSQL、Gitea、Remote Targets、Templates 与 CLI，产物写入各自 lib；包 exports 不依赖运行时转译。版本号只改根 package.json，规则见[版本管理](versioning.md)。

## 运行 CLI

构建后从仓库根执行：

```sh
pnpm locus --help
pnpm locus workspace list
```

安全开发使用 `--profile development`，CLI 的初始化与管理仍只在可信本地 TTY 输入。

`pnpm locus` 需先构建；命令入口、参数与成功判据见[实用命令](commands.md#工程命令)。CLI 装配与生命周期由 [CLI](../apps/cli/README.md)维护，数据目录、首次打开时机与恢复由 [Core](../packages/core/README.md#持久化与恢复)维护。调试时使用单独数据目录，不以清空数据库作为修复失败的默认动作。

## 开发环境与 `_LOCUS_ROOT_PASSWORD`

仓库开发环境使用 `.env.dev`，不再使用 `.env`。CLI/Core 不自动读取 `.env.dev`；由当前 bash/cmd 显式加载：

```sh
set -a
. ./.env.dev
set +a
```

文件包含 `LOCUS_HOME=temp`、`LOCUS_FOLDER_NAME=.locus` 与开发用 `_LOCUS_ROOT_PASSWORD`。

`_LOCUS_ROOT_PASSWORD` 是开发和迭代约定，不是 CLI/Core 配置：

- 常规 `locus` 命令仍只从可信本地 TTY 读取 Root 密码；
- 一次性开发脚本可以直接读取该变量并调用 Host 的 `initializeRoot` / `authenticate`；
- 对 CLI Root 提示，只可注入开发专用 `CliSecurityUI`，对 `Root 密码` 提示返回该值；
- 不用于生产数据目录、CI 或共享终端；变量会进入当前 shell 和子进程环境；
- 当前 `temp/.locus` 的 Root 密码由它初始化，开发完成后应更换并从 `.env.dev` 删除。

自动化测试仍使用内存 Provider；真实后端验证另需独立 OS 账户，入口见[测试隔离](testing.md#安全与平台验证)。

## 修改与验证

- 类型与构建：`pnpm build`。
- 行为测试：`pnpm test`，包含 Core 与 Remote Targets 的真实 SQLite 用例及真实 CLI 子进程用例；运行前需要构建。
- 全量进程内：`pnpm test:all`，经 `tests/run.mjs` 收集模块测试与跨模块测试并写入记录。
- 单文件：`pnpm test:file <文件>`。
- CLI 端到端：`pnpm e2e`，运行真实构建产物与 `pnpm locus` 包装；受 2 小时冷却限制，未解除时退出 3。`pnpm e2e --force` 可跳过冷却并记录强制运行。
- 门禁：`pnpm verify`，依次执行构建、测试与文档检查。
- 完整门禁：`pnpm verify:full`，依次执行构建、全量测试、文档检查与 e2e。
- 文档：修改 Markdown 后执行 `pnpm docs:check`；修改检查器时再执行 `pnpm docs:test`。

Web 当前只有占位，不参与构建与测试。新增 app 时再补构建与验证入口，不为占位建立空服务。

## Skill 与脚本

Agent 入口是 [.agents/skills/locus/SKILL.md](../.agents/skills/locus/SKILL.md)，按 Workspace、Shell 与脚本分层索引。脚本的 CLI 定位与运行方式见 [Skill 脚本](../.agents/skills/locus/scripts/README.md)；脚本测试已包含在 `pnpm test`。
