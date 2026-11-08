# CP Core Primitives

## Control Plane Role

本平面控制 Core 自身的长期事实、不透明引用与持久化边界，沿用原首次创建日期和 scope，不维护必须兑现的旧原语表。Workspace Foundation 已交付，概念和取舍由[产品决定](../.agents/notes/implemented/feature/2026-11-08-workspace-capability-slice.md)及[组件与恢复决定](../.agents/notes/implemented/architecture/2026-11-08-workspace-capability-composition.md)负责。

Workspace 产品定义、Capability 组合与候选功能演进归 [Workspace Capabilities CP](./cp-2026-11-09-workspace-capabilities.md)；本平面不再控制具体能力任务。Bootstrap 控制构建/profile，Host-DSH 控制服务装配和生命周期。

## Meta Reference

- [cp-meta.md](./cp-meta.md)、[同 scope CPM](./cpm-2026-11-06-core-primitives.md)：维护与记忆归属。
- 读取顺序：根 `AGENTS.md` → 本平面/记忆 → [架构](../docs/architecture.md)与相关 Note → 命中的相邻 CP → 模块 README/源码。
- 验证入口：[开发与验证](../docs/development.md)、[防御性模式](../docs/defensive-patterns/README.md)。
- 扩展/收尾使用 `create-control-plane` / `compact-control-plane`；文档遵循 Agent Notes 生命周期。

## Scope

- Core 的 Workspace 身份、成员/关联、必要来源和能力选择快照；不透明引用的保存边界。
- Core 自有 SQLite 的版本、备份/恢复、写锁和面向 Plugin 的公开用例。
- 不包含：具体 Capability 的产品范围与排序、领域 Plugin 实现、命令语法、宿主装配或测试系统。

## Core Rules

- 零目录/共享/父子反例先于命令树和原语。不得为了旧 CP、候选清单或 CLI 参数便利扭曲 Core 语义。
- 长期成员、关联、临时相关性分开；发现不是确认，解除关系不是资源删除。Workspace Identity 不由路径/Project/Session 推导。
- Capability 选择是 Core 保存的长期意图快照；声明、加载、可用与授权由能力和宿主解释，Core 不建注册器。
- Core 不解释领域引用、不 import 领域 Plugin 或 DSH/Cordis；Plugin 拥有自身领域数据。只提取真实双端需要的局部契约，不预造 SDK 或通用 Protocol。
- 已保存数据按所属模块版本和备份/恢复约定保护。未知版本/损坏不静默重建；Plugin 缺失不删除身份与关系。改变实验格式前先验证迁移或明确备份恢复，不把实验性当成丢数据许可。
- 复用 Bootstrap 的项目内 DSH 与 `.dsh/`、Host-DSH 的薄装配；构建/测试不能替代真实 profile。
- 防御适度以根 AGENTS 为准：真实边界明确失败，内部不重复兜底，不为假想异常加回退、重试或抽象。
- 不可逆迁移、删除用户成果、改变宿主依赖边界/顶层服务名或公开兼容承诺前暂停确认；既定产品语义不反复询问。

## Task Board

当前 Core 无未完成必做项。原 P0–P6、G0 已由真实实现与验收承接，删除完成过程、原语评分和旧产品基线，不转存为永久 memory。具体 Capability 的后续任务归 [Workspace Capabilities CP](./cp-2026-11-09-workspace-capabilities.md)。

### 后续输入

- [ ] 仅在 Core schema、关系模型、持久化或公开用例出现真实缺口时扩展；Capability 排序不在本平面执行。

### 回归门槛

后续改变 Core 用例默认运行 `pnpm verify`；修改持久化结构、关系语义或公开用例时同时运行 `pnpm test:all`；只有 launcher/profile/装配/插件生命周期变化或里程碑验收才运行 `pnpm verify:full`。验证门禁归[实用命令](../docs/commands.md#验证门禁)，不在 CP 重抄测试清单。

旧“只物化方案”和“完整六域 DevOps 才算下一版本”约束已失效；旧提案保持 rejected。Workspace 与 Session 的已交付决定转 implemented，Blueprint、多提供方、跨设备与剩余候选单独留 proposed；不能继续引用迁移前路径。
