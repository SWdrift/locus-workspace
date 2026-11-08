# CP Host-DSH

## Control Plane Role

本平面控制项目内 DSH/Cordis 的薄装配、实际服务面、长驻入口与生命周期回归。当前 Core/Filesystem/Git/Session/CLI 已在 profile 贯通；CLI 提供复用同一命令树与服务的交互 shell，开发期 HMR 由 base bundle 的 `dsh-hmr` 开启模块监视。host 不承担领域能力集中注册、可替换宿主或通用适配。

产品边界见 [Workspace Capabilities CP](./cp-2026-11-09-workspace-capabilities.md)，Core 长期事实见 [Core Primitives CP](./cp-2026-11-06-core-primitives.md)，运行时与构建见 [Bootstrap CP](./cp-2026-11-06-bootstrap.md)；组件取舍以[已实施决定](../.agents/notes/implemented/architecture/2026-11-08-workspace-capability-composition.md)为准。

## Meta Reference

- [cp-meta.md](./cp-meta.md)、[Host-DSH CPM](./cpm-2026-11-08-host-dsh.md)：控制面与运行时记忆。
- [Bootstrap CPM](./cpm-2026-11-06-bootstrap.md)：构建与 profile 运行时选择。
- [DSH 参考](../docs/references/dsh-plugin-development.md)：服务、生命周期、安装与失败语义的唯一参考所有者。
- 改服务、host、profile 或 Plugin 的 DSH 依赖时：根 AGENTS → 本平面/相邻 CP → 架构与模块 README/源码 → 实跑。
- 扩展/收尾使用 `create-control-plane` / `compact-control-plane`。

## Scope

- host 的 `locus` 公开面、Core/contracts 依赖边界、实际领域服务（含 `locusSession`）与 CLI 的注入/就绪/释放、项目内 profile。
- 不包含领域模型、命令树、存储规则、全局能力命名树、Bundle/发布或多实例产品能力。

## Core Rules

- 仅项目内 DSH/Cordis；不建第二 Host、专用适配、独立启动器、HTTP 服务、中央插件总线或运行时。
- host 只创建/持有 Core、提供公开用例、随 fiber 释放。不做领域 I/O、状态协调、持久化规则、界面或服务转发；只有实际装配参数才有 schema。
- Core/contracts 暂不依赖 DSH/Cordis；领域与应用 Plugin 可以直接使用需要的宿主服务。
- `locus` 仅 host 提供，其他 Plugin 不实例化 Core、不持有其内部对象。领域服务由所属 Plugin 直接提供；重复提供不静默覆盖。
- Session Plugin 直接消费 DSH `ctx.sessionQuery`；查询是可选服务，Plugin 仍提供 `locusSession` 并在查询缺失时明确失败，不复制 Session 服务、不建第二 Session 存储。
- 当前无多实例产品支持；确有隔离需求才验证 `isolate`，不因框架支持就提前加入组配置。
- 实际 DSH 运行时 import 按参考声明 peer/dev 依赖并在包/profile 验证解析，不依赖根偶然提升。应用直接使用 cmdline/appExit/appReady，不包装镜像接口。
- 保持 `version` 为产品位置参数，`--version`/`-V` 归启动器。异步业务在启动就绪后执行，完成后请求退出；领域 Plugin 为可选入口，不阻断基本 Workspace。
- 服务/生命周期变化至少运行构建、真实 profile、独立 Context 的加载/重复提供/卸载恢复。升级 DSH 或变更顶层服务、宿主边界、Bundle/公开兼容前先明确决策。
- 长驻 shell 必须复用现有命令树和当前 Context 的领域服务，不另建 Host、Core、RPC 或插件生命周期管理器。每行独立解析，不保存隐式当前 Workspace；单条失败继续，`exit`/`quit`/stdin EOF 才请求 `appExit`。插件卸载时关闭读线但不得请求进程退出，交给 HMR 后的新实例接管。
- HMR 用 DSH/Cordis 自带能力，不自制模块加载器。base bundle 的 `dsh-hmr` 默认 `root: []`，模块监视需在 profile patch 覆盖 `base`/`root`；`base` 应指向仓库根，root 用 `packages`/`plugins`，避免以 `..` 相对路径触发默认 `**/.*` 忽略。TypeScript 修改仍先 `pnpm build`，HMR 监视构建产物；Contracts 纯类型变化无运行时模块，schema/兼容变化按需重启。
- 验证长驻入口至少覆盖：同一进程连续命令、单条失败继续、最后一条退出码、退出释放、插件卸载不误退、含空格参数；验证 HMR 至少覆盖 Filesystem/Git 局部重载、Core/host 重载后 CLI 重建与数据恢复、CLI 自身重载。验证入口归[开发与验证](../docs/development.md#修改与验证)。
- 普通代码改动默认 `pnpm verify`；Filesystem/Git/Session 原生查询变化先构建再运行 `pnpm test:all`；host/profile/assembly/lifecycle 变化才运行 `pnpm verify:full`，不把 profile e2e 塞回每次编辑循环。

## Task Board

H1–H3 的实际服务面、依赖与生命周期验证已完成，删除历史 checkbox；证据归测试、smoke 与 [host README](../packages/host-dsh/README.md)。长驻入口与 HMR 的配置、边界见[开发与验证](../docs/development.md#长驻与热更新)。当前无独立残留任务。

### 暂缓

全局命名树、多实例 isolate、Bundle/分发和第二宿主等待真实需求；CLI 解析器已随产品命令使用 DSH 方案，不再排无调用方的迁移任务。
