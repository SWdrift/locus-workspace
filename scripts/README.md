# 脚本

| 脚本 | 注册命令 | 功能 |
| --- | --- | --- |
| `docs.mjs` | `pnpm docs:check` | 检查维护范围内的 Markdown 与决策记录 |
| `docs.test.mjs` | `pnpm docs:test` | 验证 `docs.mjs` 的通过和失败边界 |
| `version.mjs` | `pnpm build` 前置 | 把根 `package.json` 的 `version` 生成为 Core 的 `version.generated.ts`；规则见[版本管理](../docs/versioning.md) |
| `bundle.mjs` | `pnpm bundle` 的构建后步骤 | 打包 CLI 并携带运行依赖与内置模板；用法见 [CLI 打包](../apps/cli/README.md#可复制打包产物) |
| `verify-keyring-windows.mjs` | 显式 `node scripts/verify-keyring-windows.mjs --isolated-account` | 管理员在临时独立 OS 账户中验证真实 Windows Keyring 并清理；不属于自动化测试 |
| `local.mjs` | `pnpm locus:register`、`pnpm locus:unregister`、`pnpm locus:purge` | 安装本机 Skill 与 `locus` 启动器；取消注册或删除本机数据 |
| `backup.mjs` | `pnpm locus:backup` | 按时间戳把 `--env` 解析出的数据目录备份到 `temp/locus-backup/` |

`local.mjs` 与 `backup.mjs` 共用 `local-environment.mjs` 解析环境文件；默认 `.env.pro`，缺失时提示创建，测试数据使用 `--env .env.dev`。命令与失败行为见[实用命令](../docs/commands.md#本机注册与备份)。

pnpm 命令由根 package.json 登记；手工平台入口需按表显式调用，均从仓库根执行。测试分层与隔离见[测试系统](../docs/testing.md#安全与平台验证)。
