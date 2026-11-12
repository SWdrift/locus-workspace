# 决策记录：长期 Workspace 与 Filesystem 基础切片

Status: implemented

## 问题

若把 Workspace 当作目录、Project 或 Agent Session，零目录、多层级和共享资源都会成为例外；若先贯通全部 DevOps，又会同时引入远程认证、CI、连接与 Agent，无法先验证长期身份与显式关系是否成立。

本记录替代[旧 DevOps 首版范围](../../rejected/feature/2026-11-06-devops-console-requirements.md)，并与[组件与恢复决定](../architecture/2026-11-08-workspace-capability-composition.md)承接[旧 CLI 优先方案](../../rejected/architecture/2026-11-06-cli-first-domain-modules.md)中仍有效的原生事实自治和薄交互层理由。

## 决定

### 简述与职责

已交付的产品对象是具有持久 UUID 的 Workspace，通过显式位置登记、发现及用户确认形成长期工作语境。本文维护产品语义和范围取舍；用法与参数由模块 README 和[命令手册](../../../../docs/commands.md#workspace-操作)负责，组件与持久化由[架构决定](../architecture/2026-11-08-workspace-capability-composition.md)负责。

### 最小概念与链路

- Workspace 是长期语境聚合，不是目录、项目根或 Session；可以没有目录，或者登记不相邻、父子、交叠目录。改名、退出、Plugin 缺失不改变 Identity。
- 成员与关联是不同的显式长期关系；同一目标可被多个 Workspace 引用。引用其他 Workspace 不建立强所有权、权限继承或递归级联。Core 对外部命名空间保持不透明。
- 位置登记只是 Filesystem 的发现入口；发现/观察是临时相关性，不自动成为成员。用户可以分别确认成员或仅关联，并保存来源；重复确认同种关系与目标保持幂等。
- Plugin 是实现与装配单元；当前领域能力为 Filesystem，直接提供位置与观察服务。是否可用由 profile 装载决定，Core 不保存能力选择或提供方快照。
- 领域观察与长期关系分离：Filesystem 返回本次观察，用户显式确认后才调用 Workspace 关系用例。没有通用资源注册器、能力仲裁器或第二运行时。

真实链路是创建/按身份打开 → 登记多个位置 → 单层发现或按需读取 → 选择确认成员/关联 → 退出并恢复。

CLI 是当前可执行入口，业务用例可直接调用，不经过终端参数或渲染；后续 Web 无需复制这些规则。无固定 Workspace 类型、强制 Factory 或永久 Blueprint 依赖。

### 交付边界

当前为本机 Workspace Foundation。跨设备同步、远程文件发现、完整 DevOps、自动部署、Agent、Web、Blueprint 执行器、多提供方自动选择均未交付。Workspace 的显式删除也未交付：当前只能解除关系、取消位置登记；跨 Core 与 Plugin 数据的删除/清理边界尚未设计，不能把“解除关系”当成删除 Workspace。

## 备选方案

**完整 DevOps 六域作为首版门槛。** 旧提案已有该方案，但会把身份、成员和恢复问题淹没在外部系统接入中。当前以可恢复 Workspace + Filesystem 为基础，独立验证身份与关系。

**CLI 先定六域命令，再推导领域模型。** 容易把 `workspace add <path>` 的参数便利当成身份前提。采用产品语义与零目录/共享/父子反例约束用例，CLI 只承担应用层；保留 JSON、非 TTY 和明确退出行为。

**维护旧原语表并逐项实现。** 候选 Identity/Target/Observer 等标签不是实现义务。只有身份、不透明引用、带来源的长期关系在真实使用中成立；Context 收敛为 Workspace，用例不另包装成通用 Register/Resolve/Observe 引擎。

**固定类型、强制 Factory 或长期绑定 Blueprint。** 会阻碍已有 Workspace 独立演化。当前直接组合普通配置，不用模板作为启动条件。

## 验证

测试与真实 profile 覆盖共享与跨层级目录、零目录、发现/确认分离、重启与备份、Plugin 缺失、目录消失；验证入口见[开发与验证](../../../../docs/testing.md#分层与入口)。不是因方案定稿或文档检查而迁入 implemented。

## 后果

产品具有可持续存在的身份和关系，不再依附单个项目根或进程；Filesystem 的观察与确认有实际双端调用证据，而非只有类型骨架。

代价是当前仅支持本机地址引用，不自动追踪资源移动、合并别名或解释跨设备等价。缺失 Plugin 和不可达目录允许形成部分不可解析的语境，用户意图仍保留。CLI JSON 与当前 API 属于实验接口，不能据此推导公开 SDK 兼容承诺；持久数据仍须按版本、备份和明确迁移保护。
