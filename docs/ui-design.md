# UI 设计基线

本页是 Locus Workspace 浏览器界面的总体规范，只维护定位、原则、权威来源与变更方式。具体 token 值、圆角尺度、组件 props 和交互实现不在本页复制。

## 定位

UI 是 Workspace/Filesystem 业务能力的交互投影，不是第二套业务实现。页面通过 `@locus/application` 使用与 CLI 相同的用例；新增业务语义进入 application 或领域服务，而不是页面组件。

布局与视觉跟随 DSH 的 Web 客户端：sidebar + center 的工作区结构、语义主题 token、统一圆角与发丝线。组件与主题的当前摘抄范围见 [DSH UI 摘抄说明](../packages/ui/web/src/dsh/README.md)，模块用法与 API 见 [UI 模块](../packages/ui/README.md)。

## 权威来源

- [DSH 统一圆角规范](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/ui-radius.zh.md)：圆角档位、嵌套几何与例外。
- [DSH Web UI 样式参考](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/web-styling.zh.md)：token 使用、样式职责、hover/focus 与高层级表面规则。
- [DSH ui-primitives 组件目录](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-primitives/README.zh.md)：共享控件、反馈组件与可访问行为。
- [DSH ui-theme](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-theme/README.zh.md)：主题、字体与 `--dsw-*` token 的所有权。

本项目摘抄的主题与组件来源、版本和未摘抄范围由 [DSH UI 摘抄说明](../packages/ui/web/src/dsh/README.md) 维护；不在本页重复。

## 设计原则

- **对齐而不是另立系统。** 只使用 DSH 语义 token 与共享控件；页面 CSS 不写颜色字面量，不引入 Tailwind、组件库或第二套主题。
- **反馈按持续时间分级。** 进行中、瞬时成功、持久错误与敏感确认各有对应组件；优先复用 DSH 已有的 Loading、Tooltip、Toast、确认框实现，不为单个页面自绘。
- **状态与事实分离。** 悬停提示、瞬时消息与长期错误不混用；失败保留可定位信息，不以 Toast 代替持久错误。
- **表单校验内联。** 字段保留真实的 helper 行；提交时无效输入的错误替换 helper，输入后即时复检，并聚焦第一个无效字段。不使用浏览器原生气泡，也不为撑高度插入默认提示。Tooltip 只补充说明，不承载校验信息。
- **可访问与输入方式。** 键盘焦点、hover 能力查询与正圆/胶囊曲线遵循 DSH 规则；交互不依赖单一指针。
- **渐进摘抄。** 先复用已有 atoms；确实缺少时才按同一来源摘抄，并记录来源与边界。

## 变更与验证

调整视觉或交互时，先确认权威所有者：主题值改 DSH 主题，组件行为改摘抄的 atom，页面布局改本模块。修改后执行 `pnpm build` 与 `pnpm verify`，并在真实浏览器检查明暗主题、窄屏与键盘焦点；验证入口见[开发与验证](development.md)与[测试系统](testing.md)。
