# CP Host-DSH

## Control Plane Role

本平面控制项目内 DSH/Cordis 的薄装配、实际服务面与生命周期回归。当前 Core/Filesystem/Git/CLI 已在 profile 贯通，host 不承担领域能力集中注册、可替换宿主或通用适配。

产品边界见 [Core Primitives CP](./cp-2026-11-06-core-primitives.md)，运行时与构建见 [Bootstrap CP](./cp-2026-11-06-bootstrap.md)；组件取舍以[已实施决定](../.agents/notes/implemented/architecture/2026-11-08-workspace-capability-composition.md)为准。

## Meta Reference

- [cp-meta.md](./cp-meta.md)、[Bootstrap CPM](./cpm-2026-11-06-bootstrap.md)：控制面与运行时记忆。
- [DSH 参考](../docs/references/dsh-plugin-development.md)：服务、生命周期、安装与失败语义的唯一参考所有者。
- 改服务、host、profile 或 Plugin 的 DSH 依赖时：根 AGENTS → 本平面/相邻 CP → 架构与模块 README/源码 → 实跑。
- 扩展/收尾使用 `create-control-plane` / `compact-control-plane`。

## Scope

- host 的 `locus` 公开面、Core/contracts 依赖边界、实际领域服务与 CLI 的注入/就绪/释放、项目内 profile。
- 不包含领域模型、命令树、存储规则、全局能力命名树、Bundle/发布或多实例产品能力。

## Core Rules

- 仅项目内 DSH/Cordis；不建第二 Host、专用适配、独立启动器、HTTP 服务、中央插件总线或运行时。
- host 只创建/持有 Core、提供公开用例、随 fiber 释放。不做领域 I/O、状态协调、持久化规则、界面或服务转发；只有实际装配参数才有 schema。
- Core/contracts 暂不依赖 DSH/Cordis；领域与应用 Plugin 可以直接使用需要的宿主服务。
- `locus` 仅 host 提供，其他 Plugin 不实例化 Core、不持有其内部对象。领域服务由所属 Plugin 直接提供；重复提供不静默覆盖。
- 当前无多实例产品支持；确有隔离需求才验证 `isolate`，不因框架支持就提前加入组配置。
- 实际 DSH 运行时 import 按参考声明 peer/dev 依赖并在包/profile 验证解析，不依赖根偶然提升。应用直接使用 cmdline/appExit/appReady，不包装镜像接口。
- 保持 `version` 为产品位置参数，`--version`/`-V` 归启动器。异步业务在启动就绪后执行，完成后请求退出；领域 Plugin 为可选入口，不阻断基本 Workspace。
- 服务/生命周期变化至少运行构建、真实 profile、独立 Context 的加载/重复提供/卸载恢复。升级 DSH 或变更顶层服务、宿主边界、Bundle/公开兼容前先明确决策。

## Task Board

H1–H3 的实际服务面、依赖与生命周期验证已完成，删除历史 checkbox；证据归[验收记录](../docs/workspace-foundation-validation.md)及 [host README](../packages/host-dsh/README.md)。当前无独立残留任务。

### 暂缓

全局命名树、多实例 isolate、Bundle/分发和第二宿主等待真实需求；CLI 解析器已随产品命令使用 DSH 方案，不再排无调用方的迁移任务。
