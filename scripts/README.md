# 脚本

| 脚本 | 注册命令 | 功能 |
| --- | --- | --- |
| `docs.mjs` | `pnpm docs:check` | 检查维护范围内的 Markdown 与决策记录 |
| `docs.test.mjs` | `pnpm docs:test` | 验证 `docs.mjs` 的通过和失败边界 |
| `version.mjs` | `pnpm build` 前置 | 把根 `package.json` 的 `version` 生成为 Core 的 `version.generated.ts`；规则见[版本管理](../docs/versioning.md) |

命令由根 `package.json` 的 scripts 登记，从仓库根执行。测试分层与运行入口见[测试系统](../docs/testing.md#分层与入口)。
