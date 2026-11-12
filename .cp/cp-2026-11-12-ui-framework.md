# CP UI Framework

## Control Plane Role

本平面控制 Locus 的 Web 交互框架：`packages/ui` 的 React 页面、loopback 传输、DSH 主题与控件的摘抄边界，以及它与 `@locus/application` 的调用关系。目标是让 UI 与 CLI 共享业务用例，同时让视觉与交互和 DSH 保持一致，而不是自行维护第二套设计系统。

领域语义（位置、观察、确认）由文件系统 CP 控制；构建与宿主装配由 Bootstrap/架构文档控制，本平面只约束 UI 框架与交互投影。

## Meta Reference

- [cp-meta.md](./cp-meta.md)：控制平面结构、命名与更新规则。
- [UI 设计基线](../docs/ui-design.md)：总体设计原则与权威来源入口。
- [DSH UI 摘抄说明](../packages/ui/web/src/dsh/README.md)：来源、版本、保留范围与未摘抄组件。
- [UI 模块](../packages/ui/README.md)：启动方式、API、安全边界。
- 扩展/收尾使用 `create-control-plane` / `compact-control-plane`。

## Scope

- `packages/ui` 的浏览器页面、CSS Modules、DSH `theme/` 与 `primitives/` 摘抄、loopback HTTP/JSON API。
- UI 对 `@locus/application` 用例的调用方式与页面状态组织。
- 不包含：领域语义、CLI 命令语法、Core 持久化、DSH 上游升级或 Tauri/Desktop 形态。

## Core Rules

- UI 只调用 `@locus/application` 或领域公开服务；不得在组件内复制确认、注册、发现等业务组合。
- DSH 对齐以 `packages/ui/web/src/dsh/` 为准：`--dsw-alias-*` 语义 token、`--dsw-radius-*`、0.5px 发丝线、settings-card 材质；页面 CSS 不写颜色字面量或第二套主题。
- 摘抄新组件前先确认 DSH `ui-primitives` 是否已有实现；按需摘抄并保留来源说明，不整体复制依赖 shiki/katex/simple-icons 的 Markdown/终端/diff 组件。
- 卡片使用 R20；标准控件 R12，紧凑控件 R8；正圆/胶囊配对 `corner-shape: round`。悬停样式放在 `@media (hover: hover)`。
- 反馈使用 DSH 组件：Loading 用 `StateDot ongoing`，瞬态成功用 `Toast`，截断文本用 `Tooltip(onlyWhenClipped)`，敏感操作确认用 `RiskConfirmation`；持久错误保留内联面板。
- 表单关闭浏览器原生校验气泡，使用 `noValidate`、`aria-invalid` 与字段下方错误文本；Tooltip 只补充说明，不承载校验。
- UI 传输只绑定 loopback，页面内嵌会话令牌，API 要求 `x-locus-ui-token` 并做同源检查；不提供跨域、写入或执行能力。
- 浏览器端构建产物在 `web/dist`，运行前执行 `pnpm build`；UI 测试读取构建产物。修改主题/atoms 时同步 `docs/ui-design.md` 与来源说明。
- UI 与 CLI 的差异只属于交互投影；新增业务语义进入 application 或领域服务，不在页面手写。

## Task Board

- [x] sidebar + center 外壳、Workspace 列表/详情/关系/位置/浏览/读取/确认
- [x] DSH 八张主题样式表与 `Button`/`Input`/`Tag` atoms 摘抄
- [x] loopback 令牌、同源检查与 UI 冒烟
- [x] StateDot/Toast/Tooltip/RiskConfirmation 反馈组件与图标 sprite
- [ ] 在真实浏览器分别检查明暗主题、窄屏布局与键盘焦点，记录未覆盖项
- [ ] 出现真实需求时按需摘抄 `SegmentedTabs`、`Menu`、`Modal` 等 atoms
- [ ] DSH 提供稳定 Web Client/Client Plugin 宿主后，评估由 loopback 传输迁移
