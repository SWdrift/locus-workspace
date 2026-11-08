# 决策记录：以 DSH 插件承载首个可运行切片

Status: implemented

## 问题

仓库此前只有文档系统，没有业务源码与构建配置。需要用一个最小切片确认组件依赖方向、宿主装配和 CLI 出口，再决定是否扩展业务能力；同时要解决 `contracts` 与 CLI 在仓库中的落点。若先建独立 CLI 或完整插件平台，会在尚未验证宿主协作前引入第二套启动与装配路径。

## 决定

首个切片由三个库包和一个插件组成，全部使用 ESM 与 TypeScript：

- [contracts](../../../../packages/contracts/README.md) 只声明共享类型与服务形状，不依赖 DSH/Cordis 或 core。
- [core](../../../../packages/core/README.md) 拥有产品版本与领域生命周期，不依赖宿主。
- [host-dsh](../../../../packages/host-dsh/README.md) 是 Cordis 插件：创建 core、注册 `locus` 服务，并随 fiber 释放。
- [plugins/cli](../../../../plugins/cli/README.md) 是应用插件：消费 `locus` 与启动器提供的命令行、退出和就绪事实，不实例化 Core。

CLI 通过项目内 DSH profile 运行：`DSH_HOME=.dsh pnpm exec dsh --profile locus version` 输出 `0.0.0`。首个切片不实现 `apps/cli` 与独立 Node Host。

## 契约与装配

服务名是 `locus`，公开形状以 [host README](../../../../packages/host-dsh/README.md#服务与生命周期)和 contracts 为准，Core 对象留在薄装配层。版本只在 Core 的 `LOCUS_VERSION` 定义一次，CLI 从服务读取，不复制字面量。

profile 以 `link:` 安装实际 Plugin，插件行写入 `cordis.patch.yml`；不制作 bundle 层，也不把 Core 与 contracts 重复装进 profile。[Workspace Foundation](../feature/2026-11-08-workspace-capability-slice.md)扩展了公开用例和领域 Plugin，但保留这里确立的装配与生命周期。

## 备选方案

**独立 `apps/cli` 应用。** 能提供脱离 DSH 的可执行入口，但需要另一套启动、配置与生命周期，首个切片会重复 profile 已提供的能力。暂不采用；出现脱离宿主的真实需求时再引入。

**把 contracts 合并进 core。** 少一个包，但插件将被迫依赖 core 实现包，破坏契约与实现分离的边界。不采用。

**把 host 与 cli 合并为 bundle。** 可减少 profile patch，但增加 bundle 清单、选择与升级逻辑，首个切片还没有分发需求。不采用。

**CLI 直接实例化 core。** 少一层服务与注入，但绕开宿主注册与生命周期，无法验证本切片的核心目标。不采用。

## 后果

首个切片用一次真实 boot 同时覆盖包解析、服务注入、core 生命周期与 CLI 退出；`packages/*` 与 `plugins/*` 的依赖方向同时受构建与运行约束。

代价是 CLI 只能在项目内 DSH profile 中运行，profile 是 `.dsh/` 下的本地状态，需要手动 link 与 patch；`@locus/*` 包名与发布范围未定。这些不阻塞当前使用，但会约束后续发布与独立入口的设计。

运行方式与已观察结果见[开发与验证](../../../../docs/development.md#宿主运行)，插件加载细节由 [DSH 插件开发](../../../../docs/references/dsh-plugin-development.md) 维护。
