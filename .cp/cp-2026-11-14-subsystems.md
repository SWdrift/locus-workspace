# CP Subsystems

## Control Plane Role

本平面控制“子系统建设主线”：用户陆续给出的一组待建子系统的排队顺序、每个子系统的边界冻结、模块拆分、验收状态与跨子系统共享契约的取舍。子系统是跨模块能力（已有实例见[项目模板](../docs/subsystems/project-templates.md)），其职责、数据模型、流程、不变量与失败边界由 `docs/subsystems/<name>.md` 维护，模块用法由模块旁 README 维护；本平面只保留行动判断、边界与未决状态，不复制这些正文。

单独成平面的原因：这条主线跨多个子系统与多个新 package，且子系统间的顺序与共享契约必须在同一处决策；并入 Workspace Core 会污染其既有任务板与范围。Workspace 身份、关系、挂载与统一 shell 仍由 [Workspace Core 平面](./cp-2026-11-14-workspace-core.md)维护，项目模板仍由 [Templates 平面](./cp-2026-11-14-templates.md)维护；本平面只在子系统改动触及它们时协调，不改写其规则。

子系统清单正在陆续到达：密钥管理已展开为 [Core Security 平面](./cp-2026-11-15-core-security.md)，kanban（看板）等待冻结，远程目标接入已拆出[独立平面](./cp-2026-11-14-remote-targets.md)，其余待补充。清单每项到达后先冻结子系统名、依赖顺序与各自验收口径，再按子系统拆模块与任务项；在此之前不猜测其余子系统名称、模块组成或 API。

## Meta Reference

- [cp-meta.md](./cp-meta.md)：控制平面结构、命名与更新规则。
- [项目架构](../docs/architecture.md)：组件职责、依赖方向与“新增能力建立普通 package、在组合根显式接入”的边界。
- [子系统设计](../docs/subsystems/README.md)：子系统设计的归属、入口与既有实例。
- [开发与验证](../docs/development.md)、[测试系统](../docs/testing.md)：验证入口与分层。
- 扩展使用 `create-control-plane`；收尾与压缩使用 `compact-control-plane`。

## Scope

- 按清单新建或扩展的子系统，及其 `docs/subsystems/<name>.md` 设计文档。
- 子系统在 `packages/` 下的模块拆分，及在 `apps/cli`、`.agents/skills/locus` 的投影。
- 子系统之间的依赖顺序、共享契约的抽取时机、组合根接入点与跨子系统验收。
- 不包含：
  - Workspace 身份、成员/关联、挂载与统一 shell（[Workspace Core 平面](./cp-2026-11-14-workspace-core.md)）。
  - 项目模板复制、digest 与实例记录（[Templates 平面](./cp-2026-11-14-templates.md)）。
  - 单个模块的用法与参数（模块旁 README）；系统内正文以 `docs/subsystems/` 为唯一所有者。

## Core Rules

- 清单未到不建子系统：不在任务板上预写猜测的子系统名、模块组成或 API；不把用户愿望当成代码事实。
- 每个子系统开工前冻结四件事：子系统边界（负责与不负责）、入口点、直接调用方、本次要暴露的最小公共 API；冻结结果写入该子系统的任务章节。
- 先定子系统设计与模块拆分，再写实现；模块默认是一个普通 package，在 Core 或 app 组合根显式接入，不预建插件加载、动态注册、Provider 仲裁或通用能力抽象。
- 第二个真实消费端出现前不抽 contracts/application 层；子系统间只在出现真实依赖时排序与共享，不为“将来可能复用”提前抽包。
- 领域规则留在子系统模块与 Core；CLI 只拥有参数、确认、渲染、shell 与退出码，Skill 只经 CLI JSON 契约读取事实。
- 行为变更先取得真实运行证据再更新文档；子系统完成以 `pnpm verify` 通过与实际运行路径的可观察证据为准，需要 e2e 时遵循 2 小时冷却，不加 `--force`。
- 同一事实只在一处维护：长期结论写 `docs/subsystems/`、模块 README 或 Agent Notes；本 CP 后续仍需的规则、决策与坑点写入同 scope CPM。

## Task Board

- [ ] 为 kanban 冻结边界、模块拆分与设计文档骨架
- [ ] 接收其余子系统清单，确认名称、依赖顺序与验收口径

## 子系统清单

| 子系统 | 状态 | 模块拆分 | 设计文档 | 验收 | 备注 |
| --- | --- | --- | --- | --- | --- |
| Core Security（原密钥管理） | 已拆出独立平面 | — | — | — | 身份、授权、Grant 与 Credential 统一进入 Core；首个消费方案例为 `packages/remote-targets`；[cp-2026-11-15-core-security.md](./cp-2026-11-15-core-security.md) |
| kanban（看板） | 清单已到，边界待冻结 | — | — | — | 首批清单第二项；范围与依赖顺序待用户确认 |
| 远程目标接入 | 已拆出独立平面 | — | — | — | [cp-2026-11-14-remote-targets.md](./cp-2026-11-14-remote-targets.md) |
| 待补充 | — | — | — | — | 用户稍后提供 |
