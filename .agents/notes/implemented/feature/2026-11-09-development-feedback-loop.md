# 决策记录：开发反馈回路

Status: implemented

## 问题

Workspace Foundation 的一次性 CLI 每个操作都启动完整 DSH profile。实测冷启动中位约 4.98 秒，连续 10 次 `workspace show` 合计 47.62 秒，而业务执行只有毫秒级。开发、调试和 Agent 连续操作被启动成本主导。

DSH base bundle 已装配 `dsh-hmr`，但默认 `config.root: []`，只监听 profile 配置，不监视本地 link 插件构建产物。修改源码后没有实际可用的热更新路径。

本轮只解决反馈回路，不新增 Session、Gitea 或其他业务能力。

## 决定

CLI 增加 `shell` 命令：`dsh --profile locus shell`。它在现有 DSH 进程内逐行读取 stdin，每行重新建立现有命令树，领域服务从当前 Context 获取。不创建第二 Core、Host、RPC 或插件生命周期管理器。

- 单条命令失败写 stderr 后继续；`exit`、`quit` 或 stdin EOF 才请求 `appExit`。
- 进程退出码取最后一条命令；不改变一次性 CLI 的退出码语义。
- 不保存隐式当前 Workspace，也不把上一行选项带入下一行。
- 含空格参数支持单/双引号与常见反斜杠转义。
- 插件卸载时关闭读线但不请求退出，以便 HMR 后的新实例接管。
- 一次性 CLI 原路径不变，`parseCmdline` 只负责初始的 `shell` 选择。

HMR 复用 `@deepseek-ai/dsh-hmr`。开发 profile 覆盖 `hmr` 行，把 `base` 指向仓库根并监视 `packages`、`plugins`；不改 DSH 加载器，不把源码转译塞进运行时。TypeScript 仍先 `pnpm build`，HMR 监视构建产物。配置见 [DSH 插件开发](../../../../docs/references/dsh-plugin-development.md#长驻入口与热更新)。

## 实测

同一 shell 进程内连续 10 次操作约 6.4 秒，单发同机约 50 秒；Filesystem、Git、Core/host、CLI 四类修改均由 HMR 生效，整棵 DSH 重启 0 次。环境与验证入口见[开发与验证](../../../../docs/development.md#修改与验证)。

## 备选方案

**独立 daemon / RPC 服务**：可让任意客户端连续调用，但会引入第二运行时、生命周期、权限和协议，违背本轮“不建设第二套运行时”的约束。未采用。

**每行调用 `parseCmdline`**：该适配器在帮助、语法错误或动作完成后请求 `appExit`，不能用于长驻循环。改为初始只解析 `shell`，之后应用层逐行解析。

**直接复用 DSH 的 `exitOnStdinEnd`**：它把 stdin EOF 绑定到 launcher 退出，适合一次性 stdio 应用，不提供逐行命令分发；shell 需要自己的 readline 循环。未采用。

**自制 TS 模块加载器或 `tsx` 运行时热替换**：可跳过构建，但绕过 DSH/Cordis 的模块与 fiber 生命周期，也偏离“优先 DSH 自带 HMR”。未采用。

**HMR 监视整个仓库或直接用 `..` 作为 root**：跨目录 `..` 会被默认 `**/.*` 忽略规则命中，实测收不到构建产物事件；改为 `base` 指向仓库根、root 使用 `packages`/`plugins`。

## 后果

- 连续操作不再为每条命令支付 4–5 秒启动；本轮同机约 8 倍提速。一次性 CLI 仍保留，适合脚本和单命令。
- Shell 不提供隐式当前 Workspace，长命令仍需显式传 ID；这是有意的，避免隐藏状态。
- Core/host 或 CLI 重载会重建 shell 实例，命令历史与未完成输入丢失；同一进程与持久数据保持。Filesystem/Git 重载不影响 shell。
- HMR 依赖构建产物，源码到行为仍有约 1.5–2 秒构建窗口；不把它当成 TypeScript 编译器或迁移机制。持久化 schema、Node 加载器或 `dsh` 本体变化仍应重启。
- HMR 只监听 profile patch、home patch 与 manifest，不监听命令行 `--patch` overlay；开发配置应合入 profile patch。
- 仍未提供 Agent 无交互批处理入口；shell 是交互式 stdin 循环，不作为常驻服务协议。
- 本轮只在 Windows 10.0.26200 x64、Node v26.13.0、DSH 0.2.1-rc.5 上实测；Linux/macOS、其他 Node 版本未验证。
