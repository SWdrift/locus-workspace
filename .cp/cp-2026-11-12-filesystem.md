# CP Filesystem

## Control Plane Role

本平面控制 Workspace 的第一个领域能力：本机 Filesystem 的位置登记、单层发现、有界读取、受控新建/重命名与显式确认。Filesystem 只拥有位置配置与原生观察；长期成员/关联仍由 Core 保存。UI 与 CLI 通过共享 application 用例调用它。

本平面不控制 Mount/多 Provider 的最终模型；相关方向先做最小实验，不提前冻结 schema 或接口。

## Meta Reference

- [cp-meta.md](./cp-meta.md)：控制平面结构、命名与更新规则。
- [Filesystem 模块](../plugins/filesystem/README.md)：位置、引用、观察、读取、失败语义与数据生命周期。
- [项目架构](../docs/architecture.md)：组件依赖与数据所有权。
- 方向材料：Workspace 属于 Core、具体应用驱动；Mount、Provider、Execution World 仍是待验证方向，不是已实现契约。
- 扩展/收尾使用 `create-control-plane` / `compact-control-plane`。

## Scope

- `plugins/filesystem`：位置登记、命名空间引用、范围检查、状态观察、单层发现、有界读取、新建文件/目录与同位置重命名。
- `packages/contracts` 中的 Filesystem 局部协议与命名空间常量。
- Filesystem 与 Core 的确认边界：观察结果不自动成为关系，`confirmResource` 才写入。
- 不包含：Workspace 身份/关系 schema、UI 视觉、CLI 参数树、SSH/远端文件系统。

## Core Rules

- Workspace 先于文件系统：位置属于某个 Workspace；登记只建立发现入口，不创建成员、不复制文件、不要求路径存在。
- 观察与长期事实分离：`inspect`/`discover`/`read` 每次真实读取原生状态，不持久化缓存；`fs confirm` 才通过 Core 保存不透明引用与发现来源。
- 引用是地址而非对象身份：命名空间含本机标识，异机恢复保留原引用并报告 `unavailable`，不自动绑定同名路径。
- 路径边界：相对路径不得绝对或越过登记范围；单层发现不递归、不跟随符号链接；读取只接受普通文件并有字节上限。
- 失败分类保持 `accessible`/`missing`/`denied`/`unavailable`/`error`，不回显可能含敏感内容的原生异常正文；不把拒绝读取伪装成空文件。
- 数据所有权：Filesystem 独占 `filesystem.sqlite`；未知版本/损坏不重建为空库。Core 不读写位置表。
- 不引入 Capability 选择门禁；插件加载即可用。多 Provider/Mount 的引入必须先有实验证据与独立决策。
- 写操作限于新建文件、单层新建目录与同位置重命名；不覆盖、不跨位置、不递归、不处理器链接目标。监听、复制/删除与跨设备语义未预建。

## Task Board

- [x] 多位置登记、按 Workspace 隔离、共享/父子位置独立
- [x] 单层发现、有界 UTF-8 读取、符号链接与越界防护
- [x] 显式确认写入 Core 关系；UI/CLI 共用 `confirmResource`
- [x] SQLite 版本、写锁、完整性检查与恢复测试
- [x] Filesystem v0 写入契约：新建文件、单层新建目录、同位置重命名与 `FilesystemErrorCode`
- [x] 写入路径检查、冲突/覆盖拒绝、链接防护与真实权限测试
- [x] DSH 升级到 `0.2.2-rc.1`；`locus` profile、构建、57 项测试与 13 进程 E2E 通过；`dsh-cmdline` peer 范围同步
- [x] DSH 原生表面首切片：`@locus/dsh-surface` dual-face 包、`/locus/api` 只读投影、`sidebar.files.tree` 多 Location 树、惰性展开与原生 Document Preview；真实 Chromium 验证
- [x] 独立 Locus Main Panel：`main`/`sidebar.panellist`、Session header 入口、Hash 路由恢复；Header 为 `Locus` + `DSH` 返回 chip，tabs 为概览/文件/工作区
- [x] 原生 rightbar 补丁：`ui-sidebar-right` 的 visible/onScreen 门控扩展到 `locus`；原生 guide/Files/Document Preview 在 Locus 页面可用；脚本带备份/revert/版本校验
- [x] Workspace 管理：创建/改名、位置登记/移除、DSH 工作区关联/解除；关联时自动登记 DSH 工作区文件夹为位置；真实 Chromium 验证
- [ ] 原生右键菜单、搜索与监听；文件内容写/重命名 UI
- [ ] 按方向文档做“两个本地根 + DSH `ctx.fs` 适配”最小实验，记录多根访问、失效隔离与身份稳定性
- [ ] 实验通过后再决定 Mount 模型、Provider 契约与是否引入 DSH Adapter
- [ ] 写入、监听、权限与 Execution World 在出现真实应用后再评估
