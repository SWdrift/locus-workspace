# CPM Host-DSH

[同 scope CP](./cp-2026-11-08-host-dsh.md)的记忆文件，只保存该控制面后续仍需的已核实事实与约束；不保存一次性进度、实现盘点或项目级通用经验。

## 记忆

- `dsh-cmdline` 的 `parseCmdline` 是有终态的：帮助、语法错误或普通用例完成都会请求 `appExit`。应用要连续执行，应在初始命令动作中选择 shell，再由应用自己的读线循环逐行重新解析命令树；不要复用 `parseCmdline` 处理每一行。
- `appReady` 只保证整棵树完成启动；长驻循环应在 `onReady` 之后启动。退出时调用 `appExit` 走 launcher 的关闭与 fiber 释放，不要在插件里直接 `process.exit`。
- 插件被 HMR 卸载时，读线关闭但 shell 不得调用 `appExit`，否则新实例没有机会接管。用 `disposed` 区分“用户退出”和“插件卸载”。
- 每行重新建立命令树可以避免 Commander 选项与 `selected` 状态泄漏；领域服务从当前 `ctx.get` 读取，才能使用 HMR 后的新实例。已实测 Filesystem/Git 重载时 shell 保持，Core/host 或 CLI 重载时 shell 重建但进程与 Workspace 身份保持。
- base bundle 已装载 `dsh-hmr`，默认 `root: []` 仅监听 profile 配置。模块监视的 `base` 必须使监视根相对路径不含 `..`：默认 ignore 的 `**/.*` 会把跨目录的 `..` 段当点文件路径，导致构建产物事件被丢弃。项目内用 `base: '../../..'`、`root: [packages, plugins]`。
- HMR 监视的是构建产物；`src` 变更本身不会改变运行代码，先执行 `pnpm build`。实测增量构建约 1.5–1.6 秒，构建完成后 HMR 在 debounce 100ms 级别内重载。
- Contracts 目前主要是类型与常量，纯类型变化不会形成运行时依赖；但取消/重命名运行时导出、改变 schema 或持久化兼容性时，应重启而不是把 HMR 当成迁移机制。
