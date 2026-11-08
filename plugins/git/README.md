# @locus/git

## 简述与职责

第二个实际 Capability，用于验证领域 Plugin 直接互操作：Git 从 `locusFilesystem` 获取当前本机路径与观察，通过原生 Git 查询工作树仓库，不复制位置登记或 Workspace 成员管理。Git 自有观察不持久化，原生仓库仍是事实权威。

## 装配与前提

项目内 DSH profile 装配本包与 Filesystem，见[宿主运行](../../docs/development.md#宿主运行)。Plugin 注入 `locus`、`locusFilesystem`，提供 `locusGit`；Capability 为 `locus.git`，提供方 `@locus/git`，Tag `development` 仅分类。

Workspace 需分别选择 Git 与 Filesystem，且使用已登记的 Filesystem 位置。`availability()` 实际运行 `git --version`，区别服务已加载与原生 Git 可用；具体仓库观察仍可能失败。非 CLI 调用使用 `createGitService(locus, filesystem)`。

## 观察语义

支持本地工作树仓库的目录或普通文件线索，Git 可识别其所属仓库根。结果包含 Filesystem 原始观察、仓库根、分支、提交、dirty、脱敏 Remote 和本次观察时间；不持久化这些状态，不将 Remote 自动确认为成员。

- 普通非仓库返回 `not-repository`，不是工作空间损坏；缺失或不可达位置保留 Filesystem 来源并返回 `unavailable`。
- 未安装 Git 返回 `unavailable`；格式错误、权限或 dubious ownership 等故障为 `error`，不把所有退出码 128 统称非仓库。
- unborn 仓库的提交为 `null`，detached HEAD 的分支为 `null`。特殊文件、符号链接/junction 不用作 Git 路径。
- 未选择匹配提供方或无效位置直接拒绝用例，不合成缓存观察或空结果。裸仓库没有工作树，不属于当前支持的状态查询面。

`git inspect` 只观察；用户显式执行 `git confirm` 后，应用才把仓库引用交给 Core 建立关联。引用是主机限定的本地地址，不是跨设备仓库身份。具体 CLI 语法见[命令手册](../../docs/commands.md#workspace-操作)。

## 原生调用与秘密

调用无 shell，单次上限 10 秒与 1MiB 输出；设置 `GIT_OPTIONAL_LOCKS=0`、`GIT_TERMINAL_PROMPT=0`，关闭 fsmonitor。只执行版本、rev-parse、status 和 config 读取，不 fetch/commit/push，不写 index 或修改 Remote。

Remote 观察移除 URL userinfo 并隐藏全部 query/hash；SCP 风格非秘密登录名保持原样。诊断不回显可能携带凭据的原生 stderr。输出不是可直接用于重新认证的原生配置副本；原始值仍归 Git 配置所有。

## 生命周期与验证

卸载拒绝新操作并等待已接收的有界查询完成，不释放 Filesystem/Core、不删除 Workspace 或持久关联。没有 Git 配置数据库或第二套 Plugin 运行时。

`pnpm test:all` 使用真实 Git 仓库验证提交、dirty、unborn/detached、非仓库、缺失 Git、错误分类、凭据脱敏、index/config 不变与生命周期；`pnpm verify:full` 验证真实 DSH 下的组合与显式关联。未验证范围见本文，验证入口见[开发与验证](../../docs/development.md#修改与验证)。
