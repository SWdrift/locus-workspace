# 脚本

| 脚本 | 注册命令 | 功能 |
| --- | --- | --- |
| `docs.mjs` | `pnpm docs:check` | 检查维护范围内的 Markdown 与决策记录 |
| `docs.test.mjs` | `pnpm docs:test` | 验证 `docs.mjs` 的通过和失败边界 |
| `version.mjs` | `pnpm build` 前置 | 把根 `package.json` 的 `version` 生成为 Core 的 `version.generated.ts`；规则见[版本管理](../docs/versioning.md) |
| `verify-keyring-windows.mjs` | 显式 `node scripts/verify-keyring-windows.mjs --isolated-account` | 管理员在临时独立 OS 账户中验证真实 Windows Keyring 并清理；不属于自动化测试 |

pnpm 命令由根 package.json 登记；手工平台入口需按表显式调用，均从仓库根执行。测试分层与隔离见[测试系统](../docs/testing.md#安全与平台验证)。
