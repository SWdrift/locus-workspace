# CP Templates

## Control Plane Role

本平面控制新建的 `components/templates`：模板源解析、字节复制、内容 digest 与实例来源记录，以及它在 CLI 和 Skill 中的投影。模板是只接收绝对目标路径的文件系统能力，不进入 Workspace 数据；范围、不变量与失败边界由[项目模板子系统](../docs/subsystems/project-templates.md)维护，本平面只保留行动判断与未决状态。

Workspace 身份、关系与挂载由 [Workspace Core 平面](./cp-2026-11-14-workspace-core.md)维护；本平面只约束模板复制的边界与契约。设计取舍见[项目模板决定](../.agents/notes/implemented/feature/2026-11-13-project-templates.md)。

## Meta Reference

- [cp-meta.md](./cp-meta.md)：控制平面结构、命名与更新规则。
- [项目模板子系统](../docs/subsystems/project-templates.md)：范围、复制流程、数据模型与不变量。
- [Templates](../components/templates/README.md)：模板源、实例记录、API 与失败码。
- [实用命令](../docs/commands.md#模板操作)：`template list/create` 语法与成功判据。
- [Skill 模板参考](../.agents/skills/locus/reference/templates.md)：Agent 调用方式。
- 扩展/收尾使用 `create-control-plane` / `compact-control-plane`。

## Scope

- `components/templates/src`：源解析、复制引擎、digest 与实例记录类型。
- `components/templates/templates/`：内置模板（当前只有 `minimal`）。
- `components/templates/test`：复制、排除、失败与 provenance 测试。
- `apps/cli/src/commands.ts` 中的 `template` 子命令与相对目标路径解析；`tests/template.test.mjs`。
- `.agents/skills/locus/reference/templates.md` 与 `docs/subsystems/project-templates.md`。
- 不包含：变量渲染与模板引擎、模板升级/三方合并、远程模板源、hook 与 `git init`、Workspace 数据库写入。

## Core Rules

- 只复制字节：不渲染、不执行 hook、不自动 `git init`、不访问网络；排除清单、复制流程与失败码以 [Templates README](../components/templates/README.md) 为准。
- 实例记录只做 provenance：不写源绝对路径、不承诺自动升级；源/实例分离与 digest 见 [实例记录](../components/templates/README.md#实例记录)。
- 包不 import `@locus/core`；CLI 负责相对路径解析与投影，退出码语义见 [实用命令](../docs/commands.md#输出与退出码)。
- 行为变更先取得真实运行证据再更新文档；验证入口 `pnpm verify`，需要 e2e 时遵循 2 小时冷却。

## Task Board

- [x] 模板源解析：内置 ID 与本地目录，本地路径优先
- [x] 复制、排除、链接拒绝与临时目录 rename
- [x] digest 与 `.template.json` 实例记录
- [x] `template list/create`、相对目标、`--dry-run` 与失败分类
- [x] 内置 `minimal` 与 Skill `reference/templates.md`
- [x] 包测试 5 项 + CLI 测试 2 项 + e2e 创建场景；`pnpm verify` 通过
