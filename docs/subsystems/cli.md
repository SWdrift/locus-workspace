# 命令行（CLI）

## 范围与边界

CLI 是声明驱动的 URL 客户端和可信本地 Host，不维护领域命令树。组件在代码中声明 operation，Core 汇总路由和授权，CLI 从实际注册表产生路由发现和可信输入交互。具体协议归[统一资源调用](invocation.md)，语法归[实用命令](../commands.md)，源码入口归 [CLI](../../apps/cli/README.md#源码导航)。

## 设计原则

同一份 operation 声明拥有 URL、方法、summary 和公开字段说明；schema 拥有运行时校验。CLI 不检查 Zod 内部，不根据领域配置猜测参数，也不复制业务 DTO。自动化是声明投影，不是插件加载或源码生成。

## 命令树

默认入口是 get/post/put/patch/delete <uri...>；裸 URI 表示 GET。routes 无参数只列已注册域与路由数；给出 scheme:// 时平铺该域全部路由，给出 URL 前缀时平铺以该前缀开头的路由，给出具体资源 URL 时平铺可用声明。help 是 Commander 内置的 CLI／命令用法，`--help` 不附全量路由表。手写入口仅 version、init、security reset-root、shell。旧领域命令直接删除，没有翻译 shim，也没有 locus <component-id> 回退。

## 调用生命周期

组合根解析受限全局选项并显式加载所需定义，再创建 Core 与可信 Host。routes 只读声明；调用时解析 Body 和可信字段，经 Dispatcher 完成校验、授权、执行与信封输出。Root 只恢复原闭包，结束时释放 Session 与 Core。

## 输出与退出码

JSON 始终使用调用信封，数据位于 data；--human 优先，诊断写 stderr。0/1/2/3 分别表示调用成功、参数拒绝、业务／授权故障、批量部分失败。业务结果中的 ok 或 exitCode 不改判为通用 CLI 退出码；本地 shell 的子进程退出码除外。

失败一律在 stderr 输出一行 `Locus <类别>失败 [<code>]：<消息>`；没有无码分支，码表复用协议词汇而不另立。`--json` 时 stdout 输出机器可读对象：URL 动词为完整信封，命名命令为 `{code, message, details?}`。调用失败用[协议码](invocation.md#结果与错误)，退出码按参数类与业务类区分；用法拒绝（Commander 解析、未知命令、命令内参数检查）用 `invalid-argument`，退出 1，其文本替换 Commander 自带 `error: ` 前缀、usage 提示随后输出；本机安全与组件失败用所属领域码，退出 2；未分类异常用 `internal`，退出 2。

失败载体、跨层转换点与逐层可见性见[错误处理机制](../errors.md)。

## 名称解析与确认

资源引用由领域 operation 解释。写入由显式方法表达意图，裸 URI 不推断写动作；初始化与本机接管保留独立 TTY 交互。可信字段来源由声明约束，Root 密码不接受文件或 Body。可选可信字段由 --prompt 或已获准的 --field-file 选择，不按领域分支。

## 统一 Shell

本地 shell 经 Workspace GET 获取上下文，使用 Core 生成的 URL，遵守授权覆盖。启动、终端 attach 与环境注入属于本机客户端，语义见 [Shell 参考](../../.agents/skills/locus/reference/shell.md)。

## Agent 投影

Agent 使用 URL 与 JSON 信封，优先读取当前声明，不维护别名表。秘密只通过可信 Host；普通 User 使用不重复提权。初始化、非交互拒绝和本机接管不能靠 argv、环境密码或伪造身份绕过。

## 失败边界

输入与授权拒绝不执行原操作；副作用与清理由领域包拥有。请求失败和业务返回失败是不同层次，调用方同时检查信封和 data。事件与数据持久性归所属模块，不声称跨存储事务或完整审计。

## 演进

新增领域扩展 operation 声明，不增加 CLI 手写命令。只有本机终端、可信安全交互等不能用通用 URL 输入表达的行为才增加特殊入口。决定见[声明驱动的 URL 命令](../../.agents/notes/implemented/architecture/2026-11-18-declaration-driven-url-cli.md)。

## 验证

[CLI 测试](../../apps/cli/test/cli.test.mjs)、[可信 Host 测试](../../apps/cli/test/security.test.mjs)及[跨进程流程](../../tests/e2e/cli-workflow.mjs)覆盖声明投影与执行。测试隔离和冷却见[测试系统](../testing.md)。
