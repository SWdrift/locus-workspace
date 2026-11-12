# UI 设计基线

本页记录 Locus Workspace 浏览器界面的当前设计基线。颜色、圆角、字体与材质的唯一数值来源是摘抄的 DSH 主题样式表；本页不复制 token 值。

## 来源

UI 框架摘抄自 `deepseek-ai/deepseek-harness` 的 `packages/client/ui-theme` 与 `packages/client/ui-primitives`，目标宿主为 DSH `0.2.1-rc.5`；样式表与 atoms 取自其 master 分支（发布包未包含完整主题样式表），许可证为 MIT。文件清单与保留范围见 [`packages/ui/web/src/dsh/README.md`](../packages/ui/web/src/dsh/README.md)。

## 结构与材质

- 应用外壳采用 DSH 的 sidebar + center 两列结构；sidebar 使用 `--dsw-specific-sidebar-fill` 与 0.5px 侧边描边，center 使用 `--dsw-alias-bg-base`。
- 内容卡片使用 settings-card 材质：`--dsw-radius-xl`、0.5px `--dsw-alias-settings-card-stroke`、`--dsw-alias-settings-card-fill`，不叠加阴影。
- 控件使用 DSH atoms：`Button` 的 `md` 为 36px/R12，`sm` 为 28px/R8；`Input` 为 32px/R12；`Tag` 为胶囊并配对 `corner-shape: round`。
- 中性边框与分割线统一 0.5px；状态色边框保持 1px。
- 颜色只使用 `--dsw-alias-*` 语义 token；页面 CSS 不写十六进制或颜色函数字面量。明暗主题由 `body[data-ds-dark-theme]` 选择，启动脚本根据 `prefers-color-scheme` 设置。

## 交互

- 破坏性动作使用明确的确认文本；确认关系、登记位置与浏览是分离动作。
- 悬停样式放在 `@media (hover: hover)` 内；键盘焦点沿用 DSH `focus.css`。
- 页面不引入 Tailwind、额外组件库或第二套主题。

## 演进

新增共享控件前先检查 DSH atoms 是否已有对应实现；按需摘抄并保留来源说明。Markdown、代码高亮、终端、diff 等依赖 shiki/katex 的组件在真实页面需要时再引入，不提前整体复制。
