# 错误处理机制

## 范围与归属

本页统一跨 Core、能力包与 CLI 的失败认知：失败载体、转换点、逐层携带的数据与最终可见性。码的完整枚举与语义不在本页：协议码与失败信封归[统一资源调用](subsystems/invocation.md#结果与错误)，安全码与认证语义归 [Core Security](subsystems/core/security.md#持久化错误与备份)，组件失败码归[组件](subsystems/core/components.md#失败边界)，各领域码表归所属模块 README。

## 失败载体

失败由带 `kind`、`code`、`message` 与可选 `details` 的对象表达。`Failure` 是结构类型，`isFailure()` 只按结构识别，组件无需继承 Core 的类；`kind` 词表由 Core 拥有：`protocol`、`security`、`component`、`workspace`、`domain`。

具体类型、继承关系与附加字段由所属包定义，本页不复述。领域失败没有统一基类：能力包可以定义自身类型并声明 `kind: 'domain'`，也可以直接抛 `InvocationFailure`；分类依据 `kind` 与码表，不依据类型名或消息文本。

## 转换点

失败只在这三处改变形态，其余位置保持原对象与码。

1. **能力包 operation 边界。** [withService](../packages/remote-targets/src/operations/context.ts) 与 [atOperationBoundary](../packages/templates/src/operations.ts) 捕获本包领域失败，按包内 `ERROR_CODES` 映射为 `InvocationFailure`，把领域码写入 `details.domain`，并以 `cause` 挂上原错误。其余领域 `details` 展开保留；未识别的异常原样上抛给 Dispatcher。
2. **Dispatcher。** [toFailure](../packages/core/src/invocation/errors.ts) 用 `kind` 查分派表，把失败规范为协议码与固定消息，再由 `errorResult()` 冻结失败信封并发布请求事件。

| kind | 协议码 | details |
|---|---|---|
| `protocol` | 原码；不在协议码表内则回落兜底 | 原 `details` |
| `security` | `SECURITY_ERROR_CODES` 映射 | `security`、可选 `reason` 与 `challenge` |
| `component` | `COMPONENT_ERROR_CODES` 映射 | `component` |
| `workspace` | 同名码，`disposed` 映射 `unavailable` | `workspace` |
| `domain` | `internal` | `domain`（原领域码） |
| 非失败对象 | `internal` | 仅 debug 的 `stack`；消息固定为“内部操作失败” |

Core 自有的三个 kind 命中表外码时与 `domain` 同路回落，不会产生未定义的协议码。

3. **CLI。** [reportError](../apps/cli/src/output/errors.ts) 把已知类型渲染为一行诊断、可选 JSON 与退出码；[URL 动词](../apps/cli/src/commands/invocation.ts)直接渲染信封，命名命令经 `unwrap()` 转为 `CliFailure`；Commander 解析失败经 `usageErrorText()` 使用同一行格式。CLI 不解释领域码，只透传。

## 逐层数据

以 `GET rt://targets/nope` 的 `target-not-found` 为例：

| 层 | 对象 | 携带 | 丢弃 |
|---|---|---|---|
| 领域 | `RemoteTargetsFailure` | `code`、`message`、可选 `details` | — |
| operation 边界 | `InvocationFailure` | 协议码、`message`、`details.domain`、`cause`（仅内存） | 领域类型身份 |
| Dispatcher | 失败信封 | `uri`、`requestId`、`meta.operation`、冻结的 `error` | 原始异常对象（debug 仅保留帧） |
| 请求事件 | `locus.request.failed` | `subject`（即 `uri`）、`data.method`、`data.requestId`、`data.code`、`data.operation`、`data.domain` | `message`、其他 `details` |
| CLI 人读 | 一行 stderr | 类别、码、消息；debug 时追加帧 | `uri`、`requestId`、`details` |
| CLI JSON | 信封或错误对象 | 见下节 | 视形态而定 |

`LOCUS_DEBUG=true` 时 `details.stack` 追加帧数组：剥掉每条栈的 `name: message` 首行，沿 `cause` 链拼接，上限 40 帧；人读模式把帧追加到 stderr。开关关闭时任何路径都不含 `details.stack`，帧不改变协议码、消息与退出码。

## 结果与呈现

失败信封为 `{"ok":false,"uri":"…","requestId":"…","meta":{"method":"…","operation":"…"},"error":{"code":"…","message":"…","details":{…}}}`；`meta` 在请求已解析到 operation 时出现，`requestId` 与同次请求事件一致，`code` 恒为协议码。

CLI 诊断固定为一行 `Locus <类别>失败 [<code>]：<消息>`，类别区分调用、用法、安全操作、组件 operation、组件操作与未分类；没有无码分支。`--json` 时 stdout 给出机器可读对象。行格式、JSON 形态与退出码的完整契约见 [CLI 输出与退出码](subsystems/cli.md#输出与退出码)。

## 不变量

- 未知异常只输出固定文案，不透传原始消息、栈、cause 或 Provider 异常；安全失败的消息由码固定。
- 分类只来自 `kind` 与映射表，不从消息文本推断。
- `cause` 只存在于内存，信封、事件与 CLI JSON 都不序列化它；debug 只取帧。
- 一个请求产出一个信封；批量 GET 逐项封套，单项失败不丢弃其他结果。
- `details` 只承载可序列化数据；秘密、请求 Body 与临时路径不得进入信封或事件。
- 事件记录是 best-effort：缺失记录不能证明操作未发生。

## 当前可见性

- 失败信封与失败事件都含 `operation`，事件另含 `domain`；人读行不含这两项，关联请求事件只能依赖 `--json` 输出。
- 人读行默认不含 `uri`、`requestId` 与 `details`；`LOCUS_DEBUG=true` 时追加帧。
- 命名命令的 `--json` 输出为 `{code, message, details?}`，不含信封的 `uri` 与 `requestId`。
- 请求事件不含消息与其他 `details`。
- 环境装载等解析前失败无法判定输出选项，只能给出人读行。

## 验证

失败分类、兜底与 debug 帧由 [Core 调用测试](../packages/core/test/invocation.test.mjs)覆盖；呈现由 [CLI 测试](../apps/cli/test/cli.test.mjs)与[可信 Host 测试](../apps/cli/test/security.test.mjs)覆盖。运行入口见[测试系统](testing.md#分层与入口)。
