# 开发与验证

## 前置条件与构建

Node.js 24 或更高、pnpm 11.24.0；真实 Git 观察和完整 smoke 还需要原生 Git。执行 `pnpm install`，首次运行及修改源码后执行 `pnpm build`，通过[根 tsconfig](../tsconfig.json)按实际依赖编译到各包 `lib/`。包 exports 使用构建产物，不依赖运行时转译。

## 宿主运行

Locus 作为项目内 DSH profile Plugin 运行。先将 `DSH_HOME` 设置为仓库 `.dsh/` 的绝对路径，不读写 `~/.dsh`；PowerShell 可用 `$env:DSH_HOME = "$PWD/.dsh"`。profile 由 Git 忽略，首次安装实际插件：

```sh
pnpm exec dsh plugin --profile locus add link:"$PWD/packages/host-dsh" link:"$PWD/plugins/filesystem" link:"$PWD/plugins/git" link:"$PWD/plugins/cli"
```

将以下插件行合入 `.dsh/profiles/locus/cordis.patch.yml`，已有其他配置时只合并相应 ID，不覆盖其他行；加载与覆盖语义见 [DSH 插件开发](references/dsh-plugin-development.md)。没有 `dsh.bundle` 的提示是普通链接依赖的预期行为。

```yaml
- insert:
    - id: locus-host
      name: '@locus/host-dsh'
    - id: locus-filesystem
      name: '@locus/filesystem'
    - id: locus-git
      name: '@locus/git'
    - id: locus-cli
      name: '@locus/cli'
```

运行 `pnpm exec dsh --profile locus version`，应输出 `0.0.0` 并退出 0。不要调用 PATH 上的全局 `dsh`。Workspace 与领域调用的完整参数见[命令手册](commands.md#workspace-操作)。

需要连续操作时使用 `pnpm exec dsh --profile locus shell`。它保持同一 DSH 进程，逐行执行现有命令；不会建立第二个 Core，也不保存隐式当前 Workspace。`exit`、`quit` 或 stdin EOF 结束，退出码取最后一条命令。

领域 Plugin 可按需不装载：仅 host 与 CLI 也能管理长期 Workspace；Filesystem/Git 命令在缺少提供方时明确失败。完整验收使用上述全部 Plugin。

## 数据与恢复

产品数据不存入 Session 或 profile。`LOCUS_HOME` 必须是绝对路径，或由 Core 使用独立默认位置；配置优先级、实验格式、备份与恢复见 [Core](../packages/core/README.md#使用)和[恢复说明](../packages/core/README.md#持久化与恢复)。调试时使用单独数据目录，不能以清空数据库作为修复失败的默认动作。

## 修改与验证

验证入口、快速/完整门禁与成本见[实用命令](commands.md#验证门禁)。快速层覆盖领域与进程内 CLI/shell；真实 profile 冒烟只在装配、launcher、生命周期变化或里程碑验收时运行。验证以实际输出为准，文档检查不替代业务验证。新增行为先跑真实用例，再更新所属模块 README 与 Agent Note。

包内测试位于各包 `test/`，根 `tests/` 只放跨包 CLI/Host 与 e2e；对应包可直接运行 `pnpm --dir <包> test`。

## 宿主插件开发

DSH/Cordis 服务、生命周期、配置、安装、peer 依赖与失败语义见 [DSH 插件开发](references/dsh-plugin-development.md)。Core/contracts 暂不 import DSH/Cordis，功能与应用 Plugin 可以直接使用宿主服务，不复制已有运行时。

## 长驻与热更新

长驻 shell 与一次性 CLI 共用命令树和领域服务；单条失败不终止会话。开发期 HMR 使用 base bundle 自带的 `dsh-hmr`，配置见[DSH 插件开发](references/dsh-plugin-development.md#长驻入口与热更新)。

修改源码后仍需先构建，HMR 监视的是构建产物。Filesystem/Git 重载时 shell 保持；Core/host 或 CLI 重载会重建 shell 实例，但同一进程和 Workspace 身份保持。HMR 不编译 TypeScript，也不会热替换持久化 schema。不使用自制模块加载器或第二运行时。
