# 脚本

| 脚本 | 注册命令 | 功能 |
| --- | --- | --- |
| `docs.mjs` | `pnpm docs:check` | 检查维护范围内的 Markdown 与决策记录 |
| `docs.test.mjs` | `pnpm docs:test` | 验证 `docs.mjs` 的通过和失败边界 |

命令由根 `package.json` 的 scripts 登记，从仓库根执行。测试分层、选择规则与运行成本见[测试系统](../docs/testing.md#分层与入口)。
