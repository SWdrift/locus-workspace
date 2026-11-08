# @locus/host-dsh

## 简述与职责

Cordis 薄装配插件：创建并持有 Core，把实际公开用例注册为 `locus`，随 fiber 释放。没有领域 I/O、终端渲染、Plugin 注册总线或可替换宿主抽象。

## 装配

使用项目内 DSH `0.2.1-rc.5`，先 `pnpm build`，再按[开发与验证](../../docs/development.md#宿主运行)以 `link:` 安装并合入插件行。包本身没有 `dsh.bundle` 或配置 schema。

## 服务与生命周期

`locus` 公开产品版本、数据目录位置和 Workspace 用例；不暴露 Core 句柄或 `dispose()`。数据目录由 [Core 配置](../core/README.md#使用)确定，不归 DSH Session 或 profile 所有。

同 scope 重复提供 `locus` 会失败，不静默替换。提供方卸载后服务被 Cordis 撤销，Core 关闭数据库，捕获的用例也拒绝继续调用；卸载只释放资源，不删除持久数据。

领域 Plugin 直接提供 `locusFilesystem`、`locusGit` 等实际服务，可以使用所需 DSH/Cordis 能力，不经过 host 转发。Core/contracts 暂保持无 DSH/Cordis 依赖；变更边界需另立决策。

## 验证

`pnpm test:all` 的真实 Cordis 生命周期场景验证 Plugin 卸载、重载后的身份/关系与位置恢复，以及重复提供失败。`pnpm verify:full` 使用真实 profile 验证版本、应用退出和能力缺失时仍可打开 Workspace；验证入口见[开发与验证](../../docs/development.md#修改与验证)。
