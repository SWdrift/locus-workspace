# 配置示例

## DSH 装配

[locus.profile.yml](locus.profile.yml) 是真实 profile 插件行示例，装配 host、Filesystem、Git 和 CLI。它不是 Workspace 数据文件，也不是 Bundle 清单；本地包先按[宿主运行](../docs/development.md#宿主运行)链接进 profile，命令行 `--patch` 可以选择此文件。

## 可选的初始配置配方

一个“研究工作语境”的配方只是以下已支持动作的组合，不是 Workspace 类型或强制 Factory：

1. `workspace create Research`，保存返回的 Identity。
2. `capability configure <id> filesystem`，选择 Filesystem 提供方。
3. 对明确选定的目录分别调用 `fs register <id> <path>`；需要时再用 `fs confirm` 确认成员，而不是自动纳入全部后代。
4. 如确有本地仓库，单独选择 `git` 并调用只读观察；无仓库的 Workspace 无需此步。

每个动作前加 `pnpm exec dsh --profile locus`；参数、JSON 与错误约定见[命令手册](../docs/commands.md#workspace-操作)。这些动作保存普通 Workspace 与各 Plugin 配置，不保存对配方文件的永久依赖。用户可以随后改名、增减位置、取消能力选择；修改或移走本页不改变已经保存的身份与关系。

[真实验收入口](../scripts/workspace-smoke.mjs)使用同一配方创建 A/B/C，并通过独立 DSH 进程和数据目录恢复验证持续存在。不提供 Blueprint 解析器或模板引擎；更广的 Blueprint 与多提供方演进仍按 Agent Notes 提案维护。
