# 决策记录：将 Agent Notes 文档流提取为可移植 skill

Status: implemented

## 问题

Agent Notes 的路径、生命周期、类别与格式约束目前维护在 `.agents/notes/AGENTS.md`。其他项目要复用这套流程，只能手工复制多份规范，约束与模板容易漂移。需要一种把规则和起稿骨架一起分发、同时不改变本仓库文档权威来源的方式。

## 决定

在 `.agents/skills/agent-notes/` 提供可移植 skill：`SKILL.md` 承载文档流约束、使用顺序与 proposed、implemented、rejected、archived 四类起稿骨架；`scripts/check.mjs` 提供零依赖结构校验，只读 `.agents/notes`。项目存在 `.agents/notes/AGENTS.md` 或文档规范时，skill 先读并以项目规则为准；本仓库的 `.agents/notes/AGENTS.md` 仍是当前权威。

Skill 不改变本仓库现有文档规则与文档树；其他项目按 skill 内的自检脚本与清单核对。

## 备选方案

**只保留仓库内规范。** 不新增分发物，但其他项目只能手工复制约束和模板，版本漂移只能靠人工发现。未采用。

**让 `.agents/notes/AGENTS.md` 只保留指向 skill 的入口。** 消除本仓库内的重复正文，但会让文档规则依赖 `.agents/skills/`，与根 `AGENTS.md` 的“不从 `.agents/skills/` 建立文档运行依赖”冲突；同时会破坏现有文档指向具体章节的链接。未采用。

**依赖通用 Markdown 或 ADR 工具。** 通用 linter 主要检查样式，ADR 工具绑定自己的格式；都需要额外依赖，且不覆盖本 skill 的生命周期、状态与章节规则。未采用。

**在 skill 内复制约束，并声明项目规则优先。** 采用。代价是存在一份可移植副本，需要在本仓库规则变化时同步；收益是其他项目可以独立使用，且本仓库仍以自身文档为权威。

## 后果

其他项目添加 `.agents/skills/agent-notes/` 后，agent 可按同一套路径、生命周期和模板维护决策记录；本仓库的文档规则与既有链接不受影响。

两份规则可能漂移。缓解方式是 skill 内的优先级声明、脚本与模板随规则同步维护，以及在本仓库规则变化时更新 skill。skill 的自检脚本与清单不能替代实际代码、运行证据与人工审阅，核对通过也不证明决策内容正确。

## 测试

运行 `node .agents/skills/agent-notes/scripts/check.mjs` 核对仓库现有记录，通过 17 个记录；用 `SKILL.md` 内嵌的四类骨架生成夹具，脚本通过 4 个记录；删除 implemented 记录的 `## 决定` 后脚本报告缺少必选章节。仓库现有文档规则核对通过。
