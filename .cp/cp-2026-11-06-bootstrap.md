# CP Bootstrap

## Control Plane Role

本平面维护已交付的 `contracts` → `core` → `host-dsh` → `plugins/cli` 在项目内 DSH 上的构建、服务注入与退出链路，不承担 Workspace 产品模型或下一版本需求。

下一产品切片与领域任务由 [Core Primitives CP](./cp-2026-11-06-core-primitives.md)控制；薄装配、宿主依赖与服务面由 [Host-DSH CP](./cp-2026-11-08-host-dsh.md)控制。本平面只在构建、profile 与既有 CLI 链路需要修正时更新。

## Meta Reference

- [cp-meta.md](./cp-meta.md)：结构、命名、调用与更新规则。
- [同 scope CPM](./cpm-2026-11-06-bootstrap.md)：已核实的项目内运行时、构建与 profile 选择。
- [DSH 插件开发](../docs/references/dsh-plugin-development.md)：插件形态、生命周期、扩展点、本地调试与安装；通用事实与坑点唯一维护于此。
- 读取顺序：根 `AGENTS.md` → 本平面与 CPM → 命中的相邻 CP → 模块 README 与源码 → 实际运行。
- 扩展/收尾分别使用 `create-control-plane` / `compact-control-plane`。

## Scope

- 现有 packages/实际 Plugin 的构建接线、根工具链与 `.dsh/` profile；领域用例归对应 CP。
- 产品行为未在本平面实现；新增领域 Plugin 按 Core Primitives 的真实用例推进，不按候选清单建包。
- 不解决：领域模型、持久化选择、Web、发布版本策略和插件市场。

## Core Rules

### 运行时与构建

- 只使用根 devDependency 中的项目内 `@deepseek-ai/dsh@0.2.1-rc.5`，命令一律 `pnpm exec dsh`，不用 PATH 上的全局 `dsh`。
- `DSH_HOME` 指向仓库内 `.dsh/`，不读写 `~/.dsh`；`.dsh/` 与各包 `lib/` 均被 Git 忽略。
- `locus` profile 以 `link:` 装入实际 Plugin，插件行写入 `cordis.patch.yml`，示例以开发文档为准；Core/contracts 通过 workspace 链接解析，不重复安装，不无故切换 Bundle 装配。
- 验证前 `pnpm build`；exports 指向构建产物，不依赖运行时转译。`tsc -b tsconfig.json` 与现有 strict 配置保持，新增包加入根 references 和消费者的 `workspace:*`。

### 既有骨架边界

- 依赖方向以架构页为准：contracts 类型 ← Core ← host；应用/领域 Plugin 可直接依赖实际 DSH 服务，CLI 使用 DSH cmdline 与 commander，不要求宿主无关。
- host 创建并释放 Core，提供 `LocusService`，不泄漏内部 Core 对象；CLI 注入 `locus`、`cmdlineArgs`、`appExit`、`appReady`，不直接实例化 Core。
- 版本只由 Core 的 `LOCUS_VERSION` 定义；现有 `version` 从服务读取，不复制字面量。
- 本平面不新增服务名、命令树、领域接口或宿主抽象；确有产品调用时进入对应 CP。
- 插件通用语义和失败坑点补入 DSH 参考；一次性运行过程不转存为 CPM 规则。

### 验证

- 既有链路变更实跑 `DSH_HOME=.dsh pnpm exec dsh --profile locus version`：stdout `0.0.0`，退出 0；无参数与未知命令为用法错误，退出 1。不得以构建或代码阅读代替。
- host 生命周期或服务变化同时运行 Host-DSH 指定的独立 Context 冒烟；产品新增命令运行 Core Primitives 指定的场景。
- 文档变更执行 `pnpm docs:check`；检查器变化才加 `pnpm docs:test`。DSH 行为不符先核对安装版本与源码，不改文档迁就失败。

## Task Board

当前无独立修正任务；构建/profile 回归随下一产品切片运行，不重排已交付工作。

### 暂缓

- [ ] 出现实际新环境搭建需求时，评估 profile 初始化脚本；现阶段沿用[开发与验证](../docs/development.md#宿主运行)的 link 与 patch 步骤。
- 包名、对外发布与 Bundle 分发范围另行决策，不阻塞本地下一版本切片。

既有切片的事实由[已实施 Note](../.agents/notes/implemented/architecture/2026-11-06-bootstrap-host-plugin.md)与模块 README 负责；扩展后的实际运行证据见[验收记录](../docs/workspace-foundation-validation.md)。不在此保存重复已完成表或旧产品假说。
