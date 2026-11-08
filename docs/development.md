# 开发与验证

## 前置条件与构建

Node.js 24 或更高、pnpm 11.24.0；真实 Git 观察和完整 smoke 还需要原生 Git。执行 `pnpm install`，首次运行及修改源码后执行 `pnpm build`，通过[根 tsconfig](../tsconfig.json)按实际依赖编译到各包 `lib/`。包 exports 使用构建产物，不依赖运行时转译。

## 宿主运行

Locus 作为项目内 DSH profile Plugin 运行。先将 `DSH_HOME` 设置为仓库 `.dsh/` 的绝对路径，不读写 `~/.dsh`；PowerShell 可用 `$env:DSH_HOME = "$PWD/.dsh"`。profile 由 Git 忽略，首次安装实际插件：

```sh
pnpm exec dsh plugin --profile locus add link:"$PWD/packages/host-dsh" link:"$PWD/plugins/filesystem" link:"$PWD/plugins/git" link:"$PWD/plugins/cli"
```

将[配置示例](../examples/locus.profile.yml)中的插件行合入 `.dsh/profiles/locus/cordis.patch.yml`，已有其他配置时只合并相应 ID，不覆盖其他行。也可通过 DSH 的 `--patch` 选择示例；加载与覆盖语义见 [DSH 插件开发](references/dsh-plugin-development.md)。没有 `dsh.bundle` 的提示是普通链接依赖的预期行为。

运行 `pnpm exec dsh --profile locus version`，应输出 `0.0.0` 并退出 0。不要调用 PATH 上的全局 `dsh`。Workspace 与领域调用的完整参数见[命令手册](commands.md#workspace-操作)。

领域 Plugin 可按需不装载：仅 host 与 CLI 也能管理长期 Workspace；Filesystem/Git 命令在缺少提供方时明确失败。完整验收使用上述全部 Plugin。

## 数据与恢复

产品数据不存入 Session 或 profile。`LOCUS_HOME` 必须是绝对路径，或由 Core 使用独立默认位置；配置优先级、实验格式、备份与恢复见 [Core](../packages/core/README.md#使用)和[恢复说明](../packages/core/README.md#持久化与恢复)。调试时使用单独数据目录，不能以清空数据库作为修复失败的默认动作。

## 修改与验证

- `pnpm build`：编译所有真实消费者。
- `pnpm test`：内置 Node 测试，使用隔离临时资源，覆盖持久化、范围、能力、生命周期及进程内 CLI 命令矩阵。CLI 测试直接复用应用命令树与真实领域服务，不复制另一套业务规则。
- `pnpm smoke:workspace`：真实 profile 的装配、退出码、跨进程恢复、插件停用与 Git 组合检查；自动使用临时绝对数据目录和文件/Git 资源，最终清理自身夹具。每个剩余命令仍启动新 DSH，以验证 launcher 与退出语义；完整个案矩阵不在此重复，也不创建独立 Host 或操作用户项目目录。
- `pnpm docs:check`：文档结构、链接与生命周期。只有修改 `scripts/docs.mjs` 才同时运行 `pnpm docs:test`。

验收操作、结果与未验证平台见[Workspace Foundation 验收](workspace-foundation-validation.md)。业务验证不能由文档检查替代；新增行为先跑真实用例再更新所属模块 README 和 Agent Note。

## 宿主插件开发

DSH/Cordis 服务、生命周期、配置、安装、peer 依赖与失败语义见 [DSH 插件开发](references/dsh-plugin-development.md)。Core/contracts 暂不 import DSH/Cordis，功能与应用 Plugin 可以直接使用宿主服务，不复制已有运行时。
