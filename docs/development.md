# 开发与验证

构建、运行与数据位置见本页；测试分层、夹具与编写约束见[测试系统](testing.md)。

## 前置条件与构建

Node.js 24 或更高、pnpm 11.24.0。执行 `pnpm install`，修改源码后执行 `pnpm build`。构建先生成 Core 的版本模块，再按根 tsconfig 编译 Core、Remote Targets、Templates 与 CLI，产物写入各自 lib；包 exports 不依赖运行时转译。版本号只改根 package.json，规则见[版本管理](versioning.md)。

当前开发与验证只在 Windows x64 上执行。Linux 与 macOS 有对应实现分支（POSIX 权限、Secret Service Keyring、系统 OpenSSH），但没有运行证据，尚未经过验证；已知缺口与未覆盖项见 [Core Security 平台证据](subsystems/core/security.md#平台证据与安全边界)。

## 运行 CLI

构建后从仓库根执行：

```sh
pnpm locus --help
pnpm locus get locus://ws
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

文件包含开发数据目录 `LOCUS_HOME=temp/.locus` 与 `_LOCUS_ROOT_PASSWORD`。设置 `LOCUS_HOME` 时它就是完整数据目录，不需要 `LOCUS_FOLDER_NAME`；解析规则由 [Core](../packages/core/README.md#使用)维护。

pro（生产）环境的配置放在同结构的 `.env.pro`：生产数据目录 `LOCUS_HOME=~/.locus` 与 `_LOCUS_ROOT_PASSWORD`。它不属于开发默认流程，同样由 shell 显式加载（`. ./.env.pro`）。`~` 由 shell 在赋值时展开；CLI 只对 `.env` 调用 `process.loadEnvFile`，那条路径不做展开，所以不要把 `~` 依赖写进 `.env`。

`temp/.locus` 是测试数据目录，对应 `.env.dev`；本机注册与备份脚本默认读取 `.env.pro`，需要操作测试数据时显式传 `--env .env.dev`，见[实用命令](commands.md#本机注册与备份)。这些脚本自行展开 `LOCUS_HOME` 的 `~`，不依赖 shell 加载。

`_LOCUS_ROOT_PASSWORD` 是 Locus Root 凭据的登记位置：密码只存在于环境文件，不登记进 Core 的 SQLite、Keyring、日志或命令行，Core 只保存 scrypt 派生验证值。人通过 `locus init` 与 Root 提示在可信本地 TTY 输入；Agent 从当前环境读取该变量完成认证，不需要人代输。

- 常规 `locus` 命令仍只从可信本地 TTY 读取 Root 密码，不自行读取环境变量；
- 脚本读取该变量后调用 Host 的 `initializeRoot` / `authenticate`；
- 对 CLI Root 提示，注入 `CliSecurityUI`，对 `Root 密码` 提示返回该值；
- 变量会进入当前 shell 与子进程环境，环境文件按凭据管理：不提交、不放进共享终端或日志；
- 环境文件与 Root 验证材料不自动同步：在 `locus security` 重置密码后要同步更新对应环境文件。

自动化测试仍使用内存 Provider；真实后端验证另需独立 OS 账户，入口见[测试隔离](testing.md#安全与平台验证)。

## 修改与验证

- 类型与构建：`pnpm build`。
- 源码依赖边界：`pnpm lint`；Core 不依赖业务包，跨包只使用公开 exports，公开入口显式导出。
- 代码外观：`pnpm format` 写入产品源码格式，`pnpm format:check` 只检查；两者使用根 Prettier 配置，生成文件由生成器负责。
- 行为测试：`pnpm test`，包含 Core 与 Remote Targets 的真实 SQLite 用例及真实 CLI 子进程用例；运行前需要构建。
- 全量进程内：`pnpm test:all`，经 `tests/run.mjs` 收集模块测试与跨模块测试并写入记录。
- 单文件：`pnpm test:file <文件>`。
- CLI 端到端：`pnpm e2e`，运行真实构建产物与 `pnpm locus` 包装；受 2 小时冷却限制，未解除时退出 3。`pnpm e2e --force` 可跳过冷却并记录强制运行。
- 门禁：`pnpm verify`，依次执行构建、依赖边界、格式检查、测试与文档检查。
- 完整门禁：`pnpm verify:full`，依次执行构建、依赖边界、格式检查、全量测试、文档检查与 e2e。
- 文档：修改 Markdown 后执行 `pnpm docs:check`；修改检查器时再执行 `pnpm docs:test`。

Web 当前只有占位，不参与构建与测试。新增 app 时再补构建与验证入口，不为占位建立空服务。

源码按领域定位，主要入口置于私有辅助函数之前；operation 的路由与契约逐字段展开，类型使用显式 `import type`。模块 README 的源码导航提供修改入口和对应测试，跨包跳转依赖已有 declaration map，不另建符号索引。

## 数据迁移

提升 `CORE_SCHEMA_VERSION` 时，在同一变更中为 Locus 自有数据库新增一份从上一 `user_version` 到新版本的一跳迁移，放在 `temp/migrations/`，例如 `core-v8-to-v9.sql`。`temp/` 不入库，迁移也不进入运行时：始终保留当前版本的一份迁移，更早的脚本可以删除，因此只保证落后一个版本的本机部署可以直接升级。

升级前停止全部 Locus 写者并复制整个数据目录；在 `core.sqlite` 上以单事务执行迁移 SQL，脚本末尾把 `PRAGMA user_version` 更新到目标版本；`PRAGMA integrity_check` 通过后用新构建启动，确认 Workspace 与凭据元数据可读后再删除更早的迁移。版本与脚本名不一致、跨多个版本或降级都不自动处理；Core 遇到不匹配版本明确拒绝，不覆盖数据。

## Skill 与脚本

Agent 入口是 [.agents/skills/locus/SKILL.md](../.agents/skills/locus/SKILL.md)，按 Workspace、Shell 与脚本分层索引。脚本的 CLI 定位与运行方式见 [Skill 脚本](../.agents/skills/locus/scripts/README.md)；脚本测试已包含在 `pnpm test`。
