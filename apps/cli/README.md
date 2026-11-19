# @locus/cli

## 简述与职责

独立的薄 URL 客户端与可信本地 Host。五种方法入口只实现一次，已注册组件的 operation 声明决定可调用 URL、帮助和可信字段输入；CLI 不维护领域别名、业务 DTO 转换表或组件专用命令生成器。

组件仍在组合根显式加载，不扫描插件目录、不生成命令源码。新增组件 operation 不需要修改 CLI 命令实现。

## 源码导航

查看 [program.ts](src/program.ts) 的入口组合、[composition.ts](src/composition.ts) 的静态包装配与 i18n 注册、[commands](src/commands/) 的通用 URL 与特殊入口，以及 [host](src/host/) 的可信输入与授权恢复。命令描述、提示与诊断文案归 [i18n.ts](src/i18n.ts)；输出归 [output](src/output/)，行为验证在 [CLI 测试](test/cli.test.mjs)和[安全 Host 测试](test/security.test.mjs)。

## 构建与运行

先执行 pnpm install、pnpm build，再使用 pnpm locus。包声明 locus bin；仓库内入口等价于 node apps/cli/lib/index.js。

```sh
pnpm locus --help
pnpm locus help rt://
pnpm locus get locus://operations
pnpm locus locus://info
```

## URL 调用

get/post/put/patch/delete 后跟资源 URL；裸 URL 默认 GET。多个 URL 只允许 GET。help 无参数只列已注册域与路由数；接受 scheme:// 或资源 URL 时平铺显示方法、路径、认证要求、summary 和公开字段说明，不执行 handler、不触发探针或物化。

普通复杂输入使用 --data JSON 或 --file path（- 表示 stdin），二者互斥；只接受 JSON 媒体类型。路径参数在 URL 中，query 在 URL 查询字符串中；业务校验由 operation 的 schema 完成。

--field-file field=path 可重复，只向声明 tty 且 file:true 的字段交付可信 UTF-8 普通文件内容；拒绝符号链接与超过 1 MiB 的文件。--prompt field 显式选择可选可信字段。必需 TTY 字段自动隐藏输入，文件已提供的字段不重复提示；同字段多来源拒绝。秘密不进入 Body、环境变量或日志。Root 密码与确认字段不允许文件，只由本地 TTY 收集。

## 输出与确认

调用结果的 --json 使用 InvocationResult 信封，业务数据在 data；help 无参数时 JSON 是 `{scheme, routes}` 数组，给出 URI 时是描述数组，本地 Host 输入／认证异常按 code 诊断；--pretty 美化 JSON，--human 覆盖 --json。诊断写 stderr。通用写入由显式 HTTP 方法表达意图，不存在旧领域命令的 --yes，也不会从裸 URL 推断写操作。

退出码 0 表示 operation 成功，1 表示调用参数拒绝，2 表示业务／授权／持久化失败，3 表示批量 GET 部分失败。探测结果和远端 exitCode 是 data，不自动改变通用 CLI 退出码；调用者必须检查业务结果。本地 shell 子进程退出码仍透传。

## 特殊命令

只保留 version、init、security reset-root 和 shell。初始化与 Root 本机接管需要隐藏输入及明确确认；reset-root 不接受 --yes 绕过。其他安全管理、Workspace、组件、模板和远程目标操作统一使用 URL；旧 workspace/component/template/remote-targets/pg/credential/events 命令及组件 id 顶层回退已删除，不提供兼容翻译。

## 统一 Shell

locus shell <workspace> 仍接受 UUID 或唯一名称；经 Workspace GET operation 获取包含挂载的上下文，遵守该 operation 的授权覆盖。--shell 指定可执行文件，--command 执行后退出，--print-env 只输出上下文。临时 locus 启动器前置 PATH，注入 LOCUS_WORKSPACE_*、LOCUS_MOUNTS 与 LOCUS_MOUNT_*；缺失挂载报告并跳过，第一个可访问挂载作为 cwd。

环境注入不是沙箱。--print-env 包含继承环境，不是通用环境脱敏器。细节见 [Shell 参考](../../.agents/skills/locus/reference/shell.md)。

## 安全 Host 与 Profile

组合根通过 receiveHost 取得可信端口；Root 认证后只恢复 Core 捕获的原闭包，不能替换参数。--grant-scope operation|session 默认 operation；Session 随本次调用结束，不跨进程复用。--profile production|development 与数据目录解析由 [Core](../../packages/core/README.md#使用)维护，Profile 不是 OS 隔离。

CLI 只读取当前 CWD 可选的 .env，既有环境变量优先。仓库开发环境 .env.dev／.env.pro 由 shell 显式加载，规则见[开发与验证](../../docs/development.md)。CLI 不从环境读取 Root 密码。自动测试显式内存 Provider，不访问用户 Keyring。

## 项目模板

使用 template://templates 及其 instances 资源；参数与当前声明通过 locus help template:// 查阅，领域语义见 [Templates](../../packages/templates/README.md)。destination 必须由调用方给出绝对路径，不再由领域别名转换。

## 远程目标

使用 rt://targets 资源；配置、字段、凭据交付和失败语义归 [Remote Targets](../../packages/remote-targets/README.md)。资源凭据文件通过 --field-file 明确选择字段，密码可通过 --prompt password 隐藏输入；CLI 不解释目标 spec。

## 组件

使用 locus://components 资源。配置、物化、probe/deploy 的业务结果与读取边界由[组件子系统](../../docs/subsystems/core/components.md)维护，不从 CLI 名称生成组件别名。

## 事件

GET locus://events 接受 type、subject、limit 查询。记录是 best-effort，不作为完整审计或重放依据。

## 数据与生命周期

每次调用创建并释放 Core 与真实 Session。帮助和版本不创建数据目录或数据库；持久化与恢复见 [Core](../../packages/core/README.md#持久化与恢复)。

## 验证

统一入口见[测试系统](../../docs/testing.md)。测试通过真实构建产物覆盖 URL、自动帮助、新组件接入、文件／TTY 输入、授权恢复、JSON、退出码、跨进程恢复和 shell。
