# DSH 插件开发

## 范围

本文概括 DSH（DeepSeek Harness）插件的形态、生命周期、常用扩展点，以及本地调试、打包安装的路径，并汇总官方文档入口。内容按 dsh 0.2.1-rc.5 与官方 develop 文档核对；Cordis 完整 API、具体服务的契约和版本差异以官方页面为准。Locus 的组件划分与宿主适配边界见[项目架构](../architecture.md)，本文不定义 Locus 自身的服务契约。

## 术语

| 概念 | 说明 |
|---|---|
| 插件 | 导出 `apply(ctx)` 的 TypeScript/JavaScript 模块；Cordis 加载时调用它注册能力。 |
| 服务 | 挂在 `ctx` 上的命名能力，例如 `tools`、`llm`、`agents`；插件通过 `inject` 声明依赖。 |
| Bundle | 可安装的 npm 包；`package.json` 的 `dsh.bundle` 指向补丁文件，声明该包向配置树插入哪些行。 |
| Profile | `$DSH_HOME/profiles/<name>` 下的运行组合；`dsh.profile.bundles` 按顺序列出 bundle。 |
| 补丁 | YAML 行列表，支持 `insert` 与按 `id` 覆盖；后应用的层按行覆盖前层。 |

`$DSH_HOME` 未设置时默认为 `~/.dsh`。有效配置从空树开始依次叠加：`dsh.profile.bundles` 中的补丁 → profile 的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → 命令行 `--patch` 文件。后层按 `id` 覆盖整行，`config` 整体替换而不是逐键合并。

## 插件形态

函数形态覆盖多数场景：导出 `name` 与 `apply`，可选导出 `inject` 和 `Config`。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'
export const inject = ['tools']

export function apply(ctx: Context) {
  // inject 声明的服务已就绪；在此注册工具、服务、事件或资源。
}
```

对象形态导出 `{ name, inject, apply }`；类形态继承 `Service`，用于向其他插件提供服务。`inject` 中的每个必需服务就绪前，插件停留在 `PENDING`，不执行 `apply`。

## 生命周期与清理

`PENDING → LOADING → ACTIVE` 是正常加载路径，`apply` 抛错进入 `FAILED`；卸载经过 `UNLOADING → DISPOSED`。必需服务消失时，依赖它的插件自动卸载，并在服务恢复后重新加载。

通过 `ctx` 注册的内容在插件卸载时自动撤销，包括 `ctx.on`、`ctx.tools.register`、`ctx.llm.registerAdapter` 和 `ctx.effect` 返回的清理函数。非托管资源用 `ctx.effect(() => disposer)` 交给框架清理；多个异步 disposer 并发执行，顺序相关的清理应放在同一个 `ctx.effect` 中串行完成。

`ctx.plugin(plugin)` 返回可等待的 Fiber，而不是插件 Context；可直接 `await ctx.plugin(plugin)` 等待加载，以返回值的 `dispose()` 释放该实例。`ctx.fiber` 指当前 Context 的所属实例，不要把两者混用。

启用 `@deepseek-ai/dsh-hmr` 时，配置或源文件改动会卸载旧实例再加载新代码；未启用时重启进程生效。

## 常用扩展点

### 工具

工具插件注入 `tools` 服务，用 `defineTool` 声明参数、规范输出与模型可见内容。

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'greet-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet someone by name.',
    parameters: {
      name: { type: 'string', required: true, description: 'The name to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `Hello, ${args.name}!`
    },
  }))
}
```

`defineTool` 在模型调用前校验参数；`execute` 返回 `output.schema` 声明的规范值，`render` 把该值转成模型可见内容。嵌套 schema、后台任务、策略钩子、PTC 与 UI 卡片见[工具编写手册](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-tool)。

### 服务

服务是一个插件暴露给其他插件的命名能力。类形态继承 `Service` 并在构造函数中声明名称，配合 TypeScript 声明合并为 `ctx` 补充类型。

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    metrics: MetricsService
  }
}

export default class MetricsService extends Service {
  static inject = ['llm']

  constructor(ctx: Context) {
    super(ctx, 'metrics')
  }

  record(event: string, value: number) {
    // ...
  }
}
```

消费方把服务名写进 `inject`，或在调用点用 `ctx.get('metrics')` 做可选查询。需要隔离实例时，在 `cordis.yml` 的插件组上声明 `isolate`。

### 事件

`ctx.on(name, handler)` 注册监听器，`ctx.emit(name, ...args)` 广播事件；监听器随插件卸载自动移除。事件类型与 waterfall 短路语义见[事件系统](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/events)。

### 配置

导出同名 `Config` 接口与 Schemastery schema，schema 默认值即配置默认值。

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export interface Config {
  greeting: string
  timeoutMs: number
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  timeoutMs: Schema.number().default(30000),
})

export function apply(ctx: Context, config: Config) {
  // config 已校验并填充默认值。
}
```

导出普通对象不会被当作 schema 校验。非法配置在加载期报错；两个部署可能需要不同的值都应作为配置字段，而不是硬编码。

### 命令行与退出

启动器向所有 profile 提供 `ctx.cmdlineArgs`（本次调用的只读参数快照）与 `ctx.appExit(code)`（整棵树关闭后的退出请求）；应用型插件据此读取参数、打印结果并结束进程。`@deepseek-ai/dsh-cmdline` 的 `parseCmdline` 把 commander 的解析、帮助、版本与错误路径接到这两个值上。`--version` 与 `-V` 属于启动器，应用自己的版本命令应使用位置参数或独立 flag，否则会被启动器截获。

`parseCmdline` 使用同步解析；异步业务可由 action 先选择待执行用例，在 `appReady` 就绪后执行并于完成时请求退出。这样不会让命令解析或可选服务的加载顺序决定业务可见性；本项目实际入口见 [CLI](../../plugins/cli/README.md#能力与生命周期)。

## 本地开发与调试

创建插件文件与补丁文件，后者用 `insert` 增加一行，`name` 指向插件模块：

```yaml
- insert:
    - id: hello
      name: './hello.js'
```

```sh
dsh web --patch ./plugin/cordis.yml --no-open
```

启动后终端输出插件的加载日志。官方教程为 `--patch` 使用绝对路径；0.2.1-rc.5 实测补丁内的相对路径按补丁文件所在目录解析为 `file://` 地址。`dsh --profile <name> --dump-config` 可在不启动应用的情况下查看组合结果。

没有 `dsh.bundle` 的普通包也可先作为 profile 依赖接入：`dsh plugin --profile <name> add link:<包目录>` 后，在 `cordis.patch.yml` 用 `insert` 行把 `name` 写成包名，即可从 profile 的 `node_modules` 解析并启动。该包不会进入 `dsh.profile.bundles`，只贡献插件行，不贡献配置层；0.2.1-rc.5 实测安装时会提示「declares no dsh.bundle」，不影响加载。

补丁加载的裸文件按 Node 模块解析规则查找依赖。直接 `import '@deepseek-ai/dsh-tools'` 而文件不在含依赖的包内时，启动报 `ERR_MODULE_NOT_FOUND`，该行显示为未激活；需要共享 dsh 包的插件应作为 bundle 安装进 profile，或放在已有 `node_modules` 的包内。dsh 自身的启动参数与 profile 行为见 [CLI 行为参考](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)。

## 打包与安装

Bundle 是带配置层的 npm 包，最小结构包含 `package.json`、补丁文件和入口模块：

```json
{
  "name": "dsh-hello-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "engines": { "dsh": ">=0.2.0 <0.3.0" },
  "peerDependencies": { "@deepseek-ai/dsh-tools": "*" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

补丁中的插件行改用包名，让 Node 从安装位置解析代码：

```yaml
- insert:
    - id: hello
      name: dsh-hello-plugin
```

安装与验证：

```sh
dsh plugin --profile demo add ./hello-plugin
dsh --profile demo --dump-config
dsh --profile demo
```

`dsh plugin` 转发给 profile 目录中的 pnpm，首次使用会初始化 profile 并把声明了 `dsh.bundle` 的包追加到 `dsh.profile.bundles`。`--dump-config` 输出中出现 `# == dsh-hello-plugin` 层即表示组合成功。移除用 `dsh plugin --profile demo remove dsh-hello-plugin`。

`engines.dsh` 不满足时安装和启动会被拒绝；未声明时改查 `@deepseek-ai/dsh*` peer 依赖范围。需要与宿主共享实例的 dsh 包同时写入 `peerDependencies` 和 `devDependencies`，独立第三方依赖放在 `dependencies`。从 GitHub 安装获取的是源码而非构建产物：作者要提供自包含的 `prepare` 脚本，用户要在 profile 的 `pnpm-workspace.yaml` 中通过 `allowBuilds` 授权执行；发布到 npm 或分发 `pnpm pack` 的 tarball 不需要该授权。

## 失败与限制

| 现象 | 原因与处理 |
|---|---|
| 插件行存在但从不激活 | `inject` 的必需服务未就绪；用 `--dump-config` 核对服务是否在同一组合中提供。 |
| 启动报 `ERR_MODULE_NOT_FOUND`，行未激活 | 插件文件无法解析所导入的包；改为 bundle 安装，或把文件放入有依赖的包。 |
| 安装成功但没有配置层 | 包未声明 `dsh.bundle`，只作为普通依赖安装；补上清单声明。 |
| 非法配置导致加载失败 | 配置在加载期按 schema 校验；修正配置或 schema，不能靠运行时兜底。 |
| 用户覆盖后部分字段丢失 | 补丁按行整体替换 `config`，覆盖时需重写该行需要的全部键。 |
| 安装或启动被拒绝 | `engines.dsh` 或 DSH peer 范围与当前运行时不符。 |

profile 的 `package.json` 由 `dsh plugin` 或 `--from-default-profile` 维护，不手写；`desktop` 名称由 Electron 所有，CLI 拒绝启动和配置转储。

## 相关链接

- 官方开发教程
  - [第一个插件](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/)
  - [构建工具](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool)
  - [插件配置](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/config)
  - [打包与安装插件](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)
- 框架机制
  - [插件与生命周期](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/)
  - [服务与依赖](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/service)
  - [事件系统](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/events)
  - [Cordis 教程](https://deepseek-harness.github.io/deepseek-harness/en/develop/cordis-tutorial/)
  - [Cordis 速查](https://deepseek-harness.github.io/deepseek-harness/en/reference/cordis-primer)
- API 与参考
  - [工具编写手册](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-tool)
  - [核心子系统服务](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/core)
  - [能力分层](https://deepseek-harness.github.io/deepseek-harness/en/develop/practice/)
  - [CLI 行为参考](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)
- 源码与依赖
  - [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
  - [Cordis](https://github.com/shigma/cordis)、[Cordis 文档](https://cordis.js.org/)
  - [Schemastery](https://github.com/shigma/schemastery)
