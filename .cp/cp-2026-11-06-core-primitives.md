# CP Core Primitives

## Control Plane Role

本平面控制 Workspace 产品能力与最小领域边界，沿用原首次创建日期和 scope，不维护必须兑现的旧原语表。Workspace Foundation 已交付，概念和取舍由[产品决定](../.agents/notes/implemented/feature/2026-11-08-workspace-capability-slice.md)及[组件与恢复决定](../.agents/notes/implemented/architecture/2026-11-08-workspace-capability-composition.md)负责；未交付能力由[后续提案](../.agents/notes/proposed/feature/2026-11-08-workspace-capability-evolution.md)负责。

本平面只收束后续行动，不重复模块契约、命令表或运行记录。Bootstrap 控制构建/profile，Host-DSH 控制服务装配和生命周期。

## Meta Reference

- [cp-meta.md](./cp-meta.md)、[同 scope CPM](./cpm-2026-11-06-core-primitives.md)：维护与记忆归属。
- 读取顺序：根 `AGENTS.md` → 本平面/记忆 → [架构](../docs/architecture.md)与相关 Note → 命中的相邻 CP → 模块 README/源码。
- 验证入口：[开发与验证](../docs/development.md)、[防御性模式](../docs/defensive-patterns/README.md)。
- 扩展/收尾使用 `create-control-plane` / `compact-control-plane`；文档遵循 Agent Notes 生命周期。

## Scope

- Workspace 身份、成员/关联、能力选择；Filesystem 位置/观察；最小只读 Git 与 CLI 的真实用例。
- 入口：现有 packages、实际领域 Plugin、应用 CLI、项目内 `locus` profile；新增包随真实实现建立。
- 不包含：完整 DevOps、远程接入、Web、Blueprint 执行器、多提供方仲裁、多设备同步或发布平台。

## Core Rules

- 产品链路与零目录/共享/父子反例先于命令树和原语。不得为了旧 CP、候选清单或 CLI 参数便利扭曲 Workspace 语义。
- 位置登记、长期成员、关联、临时相关性分开；发现不是确认，解除关系不是资源删除。Workspace Identity 不由路径/Project/Session 推导。
- Capability 声明、保存选择、加载、实际可用性与授权分别解释；Tag 只分类。不建第二运行时或空候选包。
- Core 不解释领域引用、不 import 领域 Plugin 或 DSH/Cordis；Plugin 拥有自身领域数据。只提取真实双端需要的局部契约，不预造 SDK 或通用 Protocol。
- 已保存数据按所属模块版本和备份/恢复约定保护。未知版本/损坏不静默重建；Plugin 缺失不删除身份与关系。改变实验格式前先验证迁移或明确备份恢复，不把实验性当成丢数据许可。
- 复用 Bootstrap 的项目内 DSH 与 `.dsh/`、Host-DSH 的薄装配；构建/测试不能替代真实 profile。
- 防御适度以根 AGENTS 为准：真实边界明确失败，内部不重复兜底，不为假想异常加回退、重试或抽象。
- 不可逆迁移、删除用户成果、改变宿主依赖边界/顶层服务名或公开兼容承诺前暂停确认；既定产品语义不反复询问。

## Task Board

当前 Foundation 无未完成必做项。原 P0–P6、G0 已由真实实现与验收承接，删除完成过程、原语评分和旧产品基线，不转存为永久 memory。

### 暂缓与后续输入

- [ ] 按[后续能力次序](../.agents/notes/proposed/feature/2026-11-08-workspace-capability-evolution.md#实施次序评估)评估下一纵向链路，默认候选 Session；先明确会话身份可恢复性、隐私和显式确认，再实现 Plugin，不排全量 DevOps。
- [ ] 出现实际重复初始配置或第二提供方时再实验 Blueprint/替换，不先造执行器、仲裁器或通用引用解析。

### 回归门槛

后续改变用例默认运行 `pnpm verify`（构建 + 快速测试 + 文档检查）；修改 Filesystem/Git 时先构建再运行 `pnpm test:all`；只有 launcher/profile/装配/插件生命周期变化或里程碑验收才运行 `pnpm verify:full`。验证门禁归[实用命令](../docs/commands.md#验证门禁)，不在 CP 重抄测试清单。新增真实依赖/平台时扩展相应场景并分别报告未运行路径。

旧“只物化方案”和“完整六域 DevOps 才算下一版本”约束已失效；旧提案保持 rejected。已交付两份 Note 转 implemented，Blueprint、多提供方、跨设备与剩余候选单独留 proposed；不能继续引用迁移前路径。
