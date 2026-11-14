# 开发与验证

构建、运行与数据位置见本页；测试分层、夹具与编写约束见[测试系统](testing.md)。

## 前置条件与构建

Node.js 24 或更高、pnpm 11.24.0。执行 `pnpm install`，修改源码后执行 `pnpm build`。根 `tsconfig.json` 引用 `packages/core`、`packages/templates` 与 `apps/cli`，构建产物写入各自 `lib/`；包 exports 使用构建产物，不依赖运行时转译。

## 运行 CLI

构建后从仓库根执行：

```sh
pnpm locus --help
pnpm locus workspace list
```

`pnpm locus` 需先构建；命令入口、参数与成功判据见[实用命令](commands.md#工程命令)。CLI 装配与生命周期由 [CLI](../apps/cli/README.md)维护，数据目录、首次打开时机与恢复由 [Core](../packages/core/README.md#持久化与恢复)维护。调试时使用单独数据目录，不以清空数据库作为修复失败的默认动作。

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

## Skill 与脚本

Agent 入口是 [.agents/skills/locus/SKILL.md](../.agents/skills/locus/SKILL.md)，按 Workspace、Shell 与脚本分层索引。脚本的 CLI 定位与运行方式见 [Skill 脚本](../.agents/skills/locus/scripts/README.md)；脚本测试已包含在 `pnpm test`。
