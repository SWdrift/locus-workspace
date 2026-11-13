# 决策记录：系统性测试统一入口与自动冷却

Status: implemented

## 问题

`temp/e2e-runs.log` 的冷却规则只写在 `docs/testing.md`，日志由人手工追加，没有执行点能阻止重复运行。实测记录里存在开始时间与结束时间跨度不一致的条目，说明人工维护不可靠；`pnpm verify:full` 一旦启动必然执行 e2e，agent 只能靠阅读文档自我约束。需要把规则放到真实入口上，同时保留 `--force` 供明确需要重跑时使用。

## 决定

新增 `tests/run.mjs` 作为系统性测试统一入口，根 `package.json` 的 `test:all`、`e2e` 与 `verify:full` 经它执行；普通单文件、单包测试与快速层保持直接运行。

入口按测试类型维护冷却窗口：`all` 为 0 秒，仅记录；`e2e` 为 2 小时。运行前读取 `temp/test-runs.log`，取同类最近一次 `start` 记录；窗口未结束时以退出码 3 拒绝，并打印上次开始时间与剩余时间。`--force` 跳过检查，可附带 `--reason`。

每次实际运行前后自动追加 UTC 单行记录，格式为 `<UTC> suite=<all|e2e> start` 与 `<UTC> suite=<all|e2e> passed|failed duration=<秒>`；强制运行带 `forced=true`。失败、中断与强制运行都从 `start` 时刻起占用窗口。历史 `temp/e2e-runs.log` 的 `start` 记录继续计入 e2e 冷却，避免升级后立即解锁。

`all` 的文件收集替代原来的 shell glob：`packages/*/test/*.test.mjs`、`apps/*/test/*.test.mjs`、`tests/*.test.mjs`，排序后交给 `node --test`。e2e 运行 `tests/e2e/*.mjs`，当前为 `cli-workflow.mjs`：使用真实构建产物、独立进程与 `pnpm locus` 包装验证完整命令链。e2e 仍要求 pnpm 注入的 `npm_execpath`，因此 `pnpm e2e` 是有效入口，直接 `node tests/run.mjs e2e` 返回 2。

## 备选方案

**保持人工约定。** 不新增执行点，只继续维护文档与手工日志；但无法阻止 agent 连续重跑，日志一致性也没有保证。未采用。

**把冷却检查写进 `tests/e2e/cli-workflow.mjs`。** 只覆盖 e2e，无法统一记录 `test:all`，并且把流程策略混入测试用例本身；测试文件被单独执行时仍会触发检查，边界更模糊。未采用。

**在 pnpm 包装脚本或外部钩子中检查。** 需要额外的 shell 包装或 CI/hook 依赖，Windows 与 POSIX 行为不一致，且运行记录仍要另写一份。未采用。

**按类型拆分多个日志文件。** 读取简单，但“同类”判断与历史兼容分散在多个路径，新增类型时要同时改文档和读取逻辑。采用单一日志加 `suite` 字段。

## 后果

重复执行 e2e 现在会被确定性拒绝，agent 不再依赖记忆；`--force` 保留人工绕过能力，代价是强制运行没有审批或原因强制，只能靠日志追溯。

冷却只对当前工作副本的 `temp/` 生效，不同克隆、不同机器之间互不影响；日志被 Git 忽略，不能作为跨环境证据。入口不处理并发运行同一类型，两个进程同时通过检查时仍可能重叠，这是有意保留的简单性，因为系统性测试默认串行执行。

`all` 只记录不锁定，因为实测约 2 秒；如果后续新增分钟级系统性测试，需要在 `SUITES` 中配置窗口并同步本文与测试文档。

## 测试

- `pnpm test:all`：20 个用例通过；入口写入 `suite=all start` 与 `passed duration=2.0`。
- `pnpm test:all --force --reason "verify force logging"`：20 个用例通过；记录带 `forced=true reason=verify force logging`。
- `pnpm e2e`：20 次真实 CLI 调用、3.3 秒通过；入口写入 `suite=e2e start` 与 `passed duration=3.3`。
- 紧接着再次执行 `pnpm e2e`：以退出码 3 拒绝，打印上次开始时间与剩余时间，未启动 e2e。
- `pnpm verify:full`：构建、20 个用例、37 个 Markdown 文档检查与 e2e 全部通过，总计约 9 秒。
- `pnpm docs:check`：37 个 Markdown 文件通过。
