# 决策记录：数据目录由 LOCUS_HOME、LOCUS_FOLDER_NAME 与工作目录 `.env` 决定

Status: implemented

## 问题

数据目录原先只接受绝对 `LOCUS_HOME`，否则退回 `~/.locus-workspace/`。项目内 `.env` 没有任何加载器，写入其中的 `LOCUS_HOME` 不会生效；相对值（如 `temp`）也会被明确拒绝。实际使用时希望把 Workspace 数据留在仓库或项目内、由 `.env` 配置，避免直接写用户主目录，同时保留显式绝对路径与既有默认位置。

## 决定

- Core 的解析顺序为：显式 `dataDirectory`（必须是绝对路径，完整决定目录，不再叠加文件夹名）→ `LOCUS_HOME` 作为基目录（相对值按进程 CWD 解析）→ 用户主目录。
- `LOCUS_FOLDER_NAME` 是基目录下的数据文件夹名；未设置 `LOCUS_HOME` 时用它命名主目录下的文件夹；两者都缺省时保持 `.locus-workspace/`。
- 文件夹名拒绝空值、首尾空白、`.`、`..`、路径分隔符、`:` 与 NUL，避免路径逃逸与跨平台歧义。
- CLI 在创建 Core 前读取工作目录的 `.env`（Node `process.loadEnvFile`）；已存在的环境变量优先，文件缺失不算失败。
- Remote Targets 的 `remote-targets/` 继续位于数据目录下，不因本次配置变化另立位置。
- 既有 `~/.locus-workspace/` 数据不自动迁移；切换目录需停止全部写者后复制整个数据目录。

## 备选方案

**只允许绝对 `LOCUS_HOME`，由使用者写绝对路径。** 保持与原契约一致的 CWD 无关性；但 `.env` 无法跨机器复用，仓库内配置要写死盘符，放弃。

**只在 CLI 解析相对路径与文件夹名，Core 继续要求绝对。** 不改变库契约，改动更小；但数据目录解析会分裂成两层，其他 Core 消费端与 CLI 行为不一致，放弃。

**`LOCUS_HOME` 存在时视为完整数据目录，忽略 `LOCUS_FOLDER_NAME`。** 实现更简单；但用户配置中的两个变量只有一个生效，无法用配置命名数据文件夹，放弃。

**用 `node --env-file` 包装 `pnpm locus` 而不是在 CLI 内加载。** 只对包装脚本生效；直接调用 bin、全局安装与其他入口不读取 `.env`，放弃。

## 后果

收益：项目可以在工作目录 `.env` 中把数据放进仓库，去掉对用户主目录的依赖；相对路径可随仓库移动；Core 与 CLI 共用一套解析规则；既有默认位置与绝对 `dataDirectory` 语义不变。

代价：相对 `LOCUS_HOME` 使数据目录依赖进程 CWD；只读取当前工作目录的 `.env`，不向上查找；数据目录与 `.env` 都可能被版本控制忽略（本仓库 `temp/*`、`.env*` 已忽略），备份时需要同时理解两者。旧数据不会自动迁移。

## 测试

- Core 用例覆盖显式选项优先、绝对与相对 `LOCUS_HOME`、`LOCUS_FOLDER_NAME` 组合与非法值、默认 `.locus-workspace/`。
- CLI 用例覆盖工作目录 `.env` 生效、显式环境变量优先、相对数据目录按 CWD 解析；CLI 子进程在临时 CWD 中运行，不读取仓库 `.env`。
- e2e 覆盖相对数据目录落盘与空 `LOCUS_HOME` 的稳定失败。
