# 开发与验证

构建、运行与数据位置见本页；测试分层、夹具与编写约束见[测试系统](testing.md)。

## 前置条件与构建

Node.js 24 或更高、pnpm 11.24.0。执行 `pnpm install`，修改源码后执行 `pnpm build`。根 `tsconfig.json` 只引用 `packages/core` 与 `apps/cli`，构建产物写入各自 `lib/`；包 exports 使用构建产物，不依赖运行时转译。

## 运行 CLI

构建后从仓库根执行：

```sh
pnpm locus --help
pnpm locus workspace list
```

`pnpm locus` 等价于 `node apps/cli/lib/index.js`，参数原样转发。`apps/cli/package.json` 声明了 `locus` bin，供发布或外部安装后直接调用；当前仓库内统一使用 `pnpm locus`。CLI 不经过 DSH、profile 或 Cordis；每次调用创建自己的 Core，命令完成后释放。

数据目录由绝对路径 `LOCUS_HOME` 或 `createLocusCore({ dataDirectory })` 决定；未配置时使用用户主目录下的 `.locus-workspace/`。`version` 与 `--help` 不创建数据目录，首次 Workspace 写入才打开 SQLite。调试时使用单独数据目录，不以清空数据库作为修复失败的默认动作；备份与版本规则见 [Core](../packages/core/README.md#持久化与恢复)。

## 修改与验证

- 类型与构建：`pnpm build`。
- 行为测试：`pnpm test`，包含 Core 的真实 SQLite 用例与真实 CLI 子进程用例；运行前需要构建。
- 全量进程内：`pnpm test:all`，经 `tests/run.mjs` 收集包测试与跨包测试并写入记录。
- 单文件：`pnpm test:file <文件>`。
- CLI 端到端：`pnpm e2e`，运行真实构建产物与 `pnpm locus` 包装；受 2 小时冷却限制，未解除时退出 3。`pnpm e2e --force` 可跳过冷却并记录强制运行。
- 门禁：`pnpm verify`，依次执行构建、测试与文档检查。
- 完整门禁：`pnpm verify:full`，依次执行构建、全量测试、文档检查与 e2e。
- 文档：修改 Markdown 后执行 `pnpm docs:check`；修改检查器时再执行 `pnpm docs:test`。

Web 当前只有占位，不参与构建与测试。新增 app 时再补构建与验证入口，不为占位建立空服务。
