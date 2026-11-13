# 决策记录：Workspace/Filesystem 第一版共用用例与 React UI

Status: implemented
Archived: 2026-11-13

## 问题

精简后的第一版只有 CLI。文件系统要在真实交互中被浏览、读取和确认，UI 与 CLI 必须同时存在；如果 UI 直接复制 CLI 命令处理里的“观察后确认”组合，两套入口会逐渐出现语义漂移。上一轮移除 UI 时保留了 DSH 主题与 React 外壳，而当前 DSH 宿主没有可直接复用的 Domain Web 页面，需要决定第一版的共享层与 UI 形态。

## 决定

### 共用用例层

新增 `@locus/application`，由 `createWorkspaceApplication` 组合 `LocusService` 与可选 `FilesystemService`，暴露 Workspace 创建/读取/改名/关系、位置登记/取消、发现/读取与 `confirmResource`。CLI 与 UI 只调用这一层，不各自实现“先 inspect 再 link”的业务组合。

用例层不缓存服务实例：CLI 每次 shell 行、UI 每次 HTTP 请求重新创建，宿主热重载后自然读取新实例。缺少 Filesystem 时 Workspace 用例仍可用，位置用例明确失败。

### 交互面

- CLI 保留 `version`、`shell`、`workspace`、`fs`，新增 `ui [--port]`；命令树只做参数、确认与文本/JSON 渲染。
- `@locus/ui` 在现有 DSH 进程内提供 loopback HTTP、静态资源与 JSON API；只在显式 `ui` 命令下监听，默认 `127.0.0.1:4310`。页面每次启动生成会话令牌并注入 HTML，API 要求 `x-locus-ui-token`，存在 `Origin` 时只接受本机同源。
- CLI 与 UI 作为 Core 交互包放在 `packages/cli`、`packages/ui`，不再作为领域插件目录；两者仍是 DSH/Cordis 的装配入口，但归属核心交互层。
- 浏览器端采用 React 18 + Vite + TypeScript + CSS Modules + clsx；`web/src/dsh/theme` 的八张样式表与 `Button`/`Input`/`Tag`/`StateDot`/`Toast`/`Tooltip`/`RiskConfirmation` 等 atoms 摘抄自 DSH master、摘抄时为 `0.2.1-rc.5`（当前宿主 `0.2.2-rc.1` 未逐项重校），沿用 `--dsw-*` token、圆角、发丝线与反馈规则；根 `pnpm build` 同时编译传输层与浏览器端。
- 页面提供 Workspace 列表/创建/改名、关系查看与解除、位置登记/取消、单层浏览、文件读取与显式确认；所有动作调用共享用例。

### 暂不引入

Mount、多 Provider、逻辑路径、执行环境与 DSH `ctx.fs` Adapter 仍处于方向验证阶段，未进入第一版。当前 Filesystem 仍以“Workspace + 位置登记 + 本机观察”为语义，不提前实现通用虚拟文件系统。

## 备选方案

**UI 直接调用 CLI 或解析 CLI 输出。** 会让业务语义依赖终端格式，且 UI 需要维护第二套命令语法认知。不采用。

**UI 与 CLI 各自组合领域服务。** 第一版只有一条确认链路，看起来可行；但确认、注册与错误提示会在两个入口分别演化，违背“交互面共享业务实现”。改为共享 application 层。

**纯静态 HTML/JS，不引入 React。** 第一版可行且无构建步骤，但与既有 DSH UI 结构、主题 primitives 和后续页面演进不一致；用户明确要求 React。已实现的原生页面被替换。

**直接接入 DSH Web Client / Client Plugins。** 理论上最贴近宿主，但当前 DSH 客户端扩展面与页面托管方式仍在预览阶段，Locus 也不需要第二个 Web Server；先用 loopback 传输层，保持业务层可替换。若 DSH 提供稳定页面宿主，再评估迁移。

**立即实现 Mount 与 DSH `ctx.fs` Adapter。** 方向文档要求先做两目录小实验，当前第一版的需求是 Workspace + Filesystem 闭环，不需要提前冻结 Mount 模型。未采用。

## 后果

CLI 与 UI 的 Workspace/Filesystem 语义只存在一份，新增交互面可直接复用应用用例。代价是新增两个工作区包与一次 Vite 构建，UI 测试依赖 `web/dist`；页面目前只读浏览加显式确认，不提供写入、监听、订阅或跨设备资源。

`--dsw-*` 主题变量是 DSH 对齐边界：DSH 主题变化会影响页面观感，但业务与 API 不依赖 DSH 类型。UI 与 CLI 的能力差异只属于投影，新增业务语义仍应进入 application 或领域服务。

## 验证

`pnpm build` 编译 7 个工作区包并构建 `web/dist`；`pnpm test` / `pnpm test:all` 53 个用例通过，覆盖共享用例、UI 令牌与 API 流程、CLI/shell、Core/Filesystem/Host；真实 profile 手动冒烟与 e2e 覆盖 `ui` 启动、静态页面、令牌校验和健康接口。浏览器端用本地 Chromium 实际打开并完成 Workspace 选择、位置浏览、文件读取与确认。
