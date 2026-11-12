# DSH UI 框架摘抄

来源：`deepseek-ai/deepseek-harness` 的 `packages/client/ui-theme` 与 `packages/client/ui-primitives`，目标宿主为 DSH `0.2.1-rc.5`；发布包未包含完整主题样式表，样式表与 atoms 取自 master。许可证为 MIT。

| 路径 | 内容 |
| --- | --- |
| `theme/` | `ui-theme/src/styles/` 的八张 token 与全局样式表，原样保留 |
| `primitives/` | 当前页面实际使用的 `Button`、`Input`、`Tag`、`StateDot`、`Toast`、`Tooltip`、`Modal`、`Checkbox`、`RiskConfirmation` 与图标 sprite |

主题 token、圆角尺度、发丝线、elevation、菜单材质与滚动条规则以这些样式表为准；本目录不重新定义 `--dsw-*` 值。页面通过 `--dsw-alias-*` 语义 token 使用，不写死颜色。

未摘抄 `ui-primitives` 中依赖 shiki、katex、simple-icons 的 Markdown、代码高亮、终端与文件类型组件；在真实页面需要时再按同一来源引入。`TextShimmer` 未进入当前页面，暂不保留。布局结构参考 `ui-layout` 的 `AppFrame`（sidebar + center），但不引入其 Cordis client plugin 运行时。
