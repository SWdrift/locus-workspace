# 脚本

| 脚本 | 注册命令 | 功能 |
| --- | --- | --- |
| `docs.mjs` | `pnpm docs:check` | 检查维护范围内的 Markdown 与决策记录 |
| `docs.test.mjs` | `pnpm docs:test` | 验证 `docs.mjs` 的通过和失败边界 |

命令由根 `package.json` 的 scripts 登记，从仓库根执行。环境、成功判据与实际运行方式见[开发与验证](../docs/development.md#修改与验证)。

日常使用 `pnpm verify`（快速门禁）；修改 Filesystem/Git 时先构建再运行 `pnpm test:all`；只有完整验收才运行 `pnpm verify:full`，它会额外执行高耗费的 profile e2e。

端到端 profile 冒烟位于 `tests/e2e/workspace-smoke.mjs`，由 `pnpm verify:full` 运行；它不匹配 `tests/*.test.mjs`，不会被快速测试误收集。
