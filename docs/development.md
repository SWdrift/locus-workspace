# 开发与验证

构建、宿主装配与数据位置见本页；测试分层、夹具与编写约束见[测试系统](testing.md)。

## 前置条件与构建

Node.js 24 或更高、pnpm 11.24.0；真实 Git 观察和完整 smoke 还需要原生 Git，Remote Machine 与 Connectivity 的实际观察/验证需要原生 OpenSSH（机器登记、Profile 保存与关联不依赖它）。FRP Profile 还需要用户已启动的本地 FRPP visitor；Locus 不负责启动它。Gitea 观察需要可访问的 Gitea HTTP(S) 实例，以及可经 DSH credentials 或启动环境解析的只读凭据名称；实例与 Token 不属于 Locus 数据。执行 `pnpm install`，首次运行及修改源码后执行 `pnpm build`，通过[根 tsconfig](../tsconfig.json)按实际依赖编译到各包 `lib/`。包 exports 使用构建产物，不依赖运行时转译。

## 宿主运行

Locus 作为项目内 DSH profile Plugin 运行。先将 `DSH_HOME` 设置为仓库 `.dsh/` 的绝对路径，不读写 `~/.dsh`；PowerShell 可用 `$env:DSH_HOME = "$PWD/.dsh"`。profile 由 Git 忽略，首次安装实际插件：

```sh
pnpm exec dsh plugin --profile locus add link:"$PWD/packages/host-dsh" link:"$PWD/plugins/filesystem" link:"$PWD/plugins/git" link:"$PWD/plugins/remote-machine" link:"$PWD/plugins/connectivity" link:"$PWD/plugins/gitea" link:"$PWD/plugins/session" link:"$PWD/plugins/cli" link:"$PWD/plugins/ui"
```

将以下插件行合入 `.dsh/profiles/locus/cordis.patch.yml`，已有其他配置时只合并相应 ID，不覆盖其他行；加载与覆盖语义见 [DSH 插件开发](references/dsh-plugin-development.md)。没有 `dsh.bundle` 的提示是普通链接依赖的预期行为。

```yaml
- insert:
    - id: locus-host
      name: '@locus/host-dsh'
    - id: locus-remote-machine-contract
      name: '@locus/remote-machine/contract'
    - id: locus-connectivity-contract
      name: '@locus/connectivity/contract'
    - id: locus-filesystem
      name: '@locus/filesystem'
    - id: locus-git
      name: '@locus/git'
    - id: locus-remote-machine
      name: '@locus/remote-machine'
    - id: locus-connectivity
      name: '@locus/connectivity'
    - id: locus-gitea
      name: '@locus/gitea'
    - id: locus-session
      name: '@locus/session'
    - id: locus-ui
      name: '@locus/ui'
    - id: locus-cli
      name: '@locus/cli'
```

运行 `pnpm exec dsh --profile locus version`，应输出 `0.0.0` 并退出 0。不要调用 PATH 上的全局 `dsh`。Workspace、Session 与领域调用的完整参数见[命令手册](commands.md#workspace-操作)。

需要连续操作时使用 `pnpm exec dsh --profile locus shell`。它保持同一 DSH 进程，逐行执行现有命令；不会建立第二个 Core，也不保存隐式当前 Workspace。`exit`、`quit` 或 stdin EOF 结束，退出码取最后一条命令。

领域 Plugin 可按需不装载：仅 host 与 CLI 也能管理长期 Workspace；Filesystem/Git/Remote Machine/Connectivity/Gitea/Session 命令在缺少提供方时明确失败，已保存关系、Profile 与 Gitea 实例配置保留。`locus-remote-machine-contract` 与 `locus-connectivity-contract` 独立于 Provider 行：移除 Provider 行时，`machine observe` 与 `connect verify` 仍可发现并明确失败；移除 contract 行时对应命令不存在。完整验收使用上述全部 Plugin。

## 本地 UI

Workspace UI 由 `@locus/ui` 在现有 DSH 进程内提供。先用与 CLI 相同的 `DSH_HOME` 与 `LOCUS_HOME` 启动：

```sh
DSH_HOME="$PWD/.dsh" LOCUS_HOME="$PWD/.locus-data" pnpm ui
```

PowerShell：

```powershell
$env:DSH_HOME = "$PWD/.dsh"; $env:LOCUS_HOME = "$PWD/.locus-data"; pnpm ui
```

默认访问 `http://127.0.0.1:4310/`；使用 `pnpm exec dsh --profile locus ui --port 4311` 可改端口。服务只绑定 loopback，不自动打开浏览器，按 Ctrl+C 停止。UI 读取同一 Core 与领域服务，不创建第二套数据库或领域运行时；关闭 UI 不删除任何长期关系与配置。

UI 是 React 18 + Vite + TypeScript + CSS Modules 的浏览器应用，源码在 `plugins/ui/web`，由 Vite 构建到 `plugins/ui/web/dist`；根 `pnpm build` 会先编译传输层再执行 `vite build` 与浏览器端类型检查。单独构建使用 `pnpm --filter @locus/ui build`。静态产物不提交，首次运行或修改 `web/src` 后必须重新构建再刷新浏览器；修改 `plugins/ui/src` 后同样需要构建，开发期 HMR 与 CLI 一样由 DSH 管理。组件使用 `--dsw-*` 主题变量、CSS Modules 与 `clsx`，不引入 Tailwind 或组件库。UI API 要求页面内嵌会话令牌、同源来源与自定义请求头；`machine.observe`/`connect.verify` 等标记为需要确认的操作必须显式提交确认。不要把端口转发到非 loopback 网络，也不要绕过这些检查。

## 数据与恢复

Locus 数据不存入 Session 或 profile；Session 原生日志与执行状态仍由 DSH 管理，备份 Locus 数据不会包含会话日志。`LOCUS_HOME` 必须是绝对路径，或由 Core 使用独立默认位置；配置优先级、实验格式、备份与恢复见 [Core](../packages/core/README.md#使用)和[恢复说明](../packages/core/README.md#持久化与恢复)。调试时使用单独数据目录，不能以清空数据库作为修复失败的默认动作。

## 宿主插件开发

DSH/Cordis 服务、生命周期、配置、安装、peer 依赖与失败语义见 [DSH 插件开发](references/dsh-plugin-development.md)。Core/contracts 暂不 import DSH/Cordis，功能与应用 Plugin 可以直接使用宿主服务，不复制已有运行时。

## 长驻与热更新

长驻 shell 与一次性 CLI 共用命令树和领域服务；单条失败不终止会话。开发期 HMR 使用 base bundle 自带的 `dsh-hmr`，配置见[DSH 插件开发](references/dsh-plugin-development.md#长驻入口与热更新)。

修改源码后仍需先构建，HMR 监视的是构建产物。Filesystem/Git/Remote Machine/Connectivity 重载时 shell 保持；Core/host 或 CLI 重载会重建 shell 实例，但同一进程和 Workspace 身份保持。HMR 不编译 TypeScript，也不会热替换持久化 schema。不使用自制模块加载器或第二运行时。
