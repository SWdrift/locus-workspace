# 脚本

| 脚本 | 注册命令 | 功能 |
| --- | --- | --- |
| `docs.mjs` | `pnpm docs:check` | 检查维护范围内的 Markdown 与决策记录 |
| `docs.test.mjs` | `pnpm docs:test` | 验证 `docs.mjs` 的通过和失败边界 |
| `workspace-smoke.mjs` | `pnpm smoke:workspace` | 通过真实项目内 DSH profile 验证装配、重启、插件停用和 Git 组合 |

命令由根 `package.json` 的 scripts 登记，从仓库根执行。环境与成功判据见[开发与验证](../docs/development.md#修改与验证)，实际验收见[记录](../docs/workspace-foundation-validation.md)。
