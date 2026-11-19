# 统一资源调用

本页维护 Locus 的调用协议：资源 URL、operation、凭证交付、授权、结果信封与事件。Core 提供通用机制；具体 Scheme、路由、输入输出与 handler 归领域包。模块用法见各包 README，命令语法见[实用命令](../commands.md)，安全模型见 [Core Security](core/security.md)。

## 边界

所有业务操作都是 operation，具有稳定的 `method + scheme + authority + path`。CLI 默认入口由这些声明投影为通用 URL 调用和帮助；渲染、确认、`--profile`、`--json`、`--help`、补全与交互 attach 属于客户端，不进入 Core 或领域 handler 的业务分支。

Core 只认识 `locus://` 自有资源，不内置其他 Scheme。`rt://` 属于 remote-targets，`template://` 属于 templates，`pg://` 属于 postgres，`gitea://` 属于 gitea。组合根显式注册组件 operation；不做动态插件发现。

## URI 与路由

`parseLocusUri()` 使用 WHATWG URL 完成标准规范化，包括 dot segment；随后执行 Locus 约束：

- scheme 与 authority 小写；authority 不能为空。
- 拒绝 userinfo、fragment、控制字符与 NUL。
- 路径段只解码一次；拒绝编码后的 `/`、`\` 与 NUL，以及解码后产生空段、分隔符或控制字符的输入。
- query 保留重复值；规范 `href` 由解码后的路径段重新编码一次生成。
- 空路径与仅 `/` 归一为无路径；静态段区分大小写。

`ApiRouter` 在注册期拒绝重复 operation id，以及同 `scheme + authority + method` 下仅参数名不同的歧义路由；`auth: none` 只允许 Core namespace 的初始化 operation。静态段优先于参数段；路径匹配但方法不支持时返回 `unsupported-method`。`build(operationId, params)` 与 `resolve()` 共用同一规范表示。

示例：

```text
locus://workspaces/<id>/mounts
rt://targets/<id>/system
template://templates/<id>/instances
pg://databases/<id>/queries
gitea://repositories/<id>/requests
```

`locus://operations` 返回当前组合根实际注册的 operation 描述，包含 summary 与公开 fields；它和组件视图、CLI 帮助共用 describeOperation，不包含 schema 或 handler。

## Operation 契约

`defineOperation()` 接收 `id`、`method`、`scheme`、`authority`、`path`、`auth`、可选 `query`、`input`、`output`、可选 `fields` 与 `run`。`input`、`output` 必填，`query` 可选；summary 解释用途与普通 JSON 输入，fields 是可序列化公开字段说明。

- `run(query, input, context)`：`query` 来自 URL query，`input` 来自 JSON Body 与可信 Host 收集的字段；路径参数只在 `context.url.pathParams`，不重复进入 input。
- `input` 与 `query` 在调用前解析；`output` 只约束返回类型，并在契约测试中解析，不在副作用完成后改判业务结果。
- `fields` 是与 schema 分离的输入元数据：`secret` 用于提示与脱敏，`tty` 表示只能由可信 Host 收集；description/required 用于展示与收集，file:true 允许有界普通文件来源。外部 Body 出现 tty 字段直接拒绝；Host 收集的字段合并后交给 handler。
- `context` 提供 `namespace`、`operationId`、`requestId`、`dataDirectory`、规范 `url`、只读组件状态窄视图、`credential` 端口与 `emit()` 领域事件入口。
- operation 输出是可序列化 DTO；响应流、连接和原生客户端对象由所属适配器消费并释放。组件描述性元数据深度冻结，handler 声明只冻结外壳，不递归冻结 schema 等外部对象的内部缓存。

Schema 使用 `{ parse(value): T }` 窄接口；pnpm workspace catalog 统一登记 zod。Core 不检查 Zod 内部结构。

## 凭证

凭证定义与 operation、组件彼此独立：`defineCredential({ id, fields })` 只声明 slot 与字段结构；字段包含公开/秘密与必填/可选，秘密字段至少一个。凭据 URL：

```text
locus://credentials/<component>/<slot>/<resourceKey>
```

- `component` 是命名空间；组件只能访问自己的 namespace。
- `slot` 是 `defineCredential.id`。
- `resourceKey` 由 handler 显式提供，通常取自一个或多个 URL 参数；一个 URL 可以有多个 key。
- URL 永不返回秘密，只返回元数据与绑定。

绑定键是 `component + slot + resourceKey`。`context.credential.write(credential, key, values)` 写入公开字段与绑定，返回稳定 `CredentialRef`；`context.credential.read(credential, key, consume)` 按当前组件、slot 与 key 查找绑定，读取 Provider 秘密，合并公开字段后调用 `consume`。缺失绑定在回调前失败。

`write` 只在本次 operation 实际获准 Root 时可用，与声明等级无关：声明为 Root 但被覆盖为 user 时拒绝；声明为 user 被覆盖为 Root 并获批准后可写。handler 必须先取得凭据，再执行不可逆操作。

秘密只经 `ctx.credential` 交付。注册秘密由可信 Host 通过 TTY 或文件收集，校验后作为 handler input 传入，不进入 URL、外部 JSON Body、日志或事件。

## 授权

授权键是 operation；Root 覆盖键为 `component:operation`。`auth` 取 `user`、`root` 或 `none`；`none` 只允许 `locus.security.initialize`，且仅在未初始化时成功。

User 级 operation 在没有 Root 元数据时也可执行；Root 级 operation 在未初始化时失败。Root 级调用首次返回认证挑战；可信 Host 用 Root 密码认证后取得 Grant，并恢复 Core 保存的原闭包。参数哈希覆盖 method、规范 URI、query 与实际 input 的哈希；调用方不能替换动作或参数。

Grant 沿用原操作捕获、参数不可替换、单次或并发单次消费、真实 Session 与 Root 重置撤销。`--grant-scope session` 只允许同一 Session 内相同 operation 与参数复用；Session 结束即失效。

实际等级 = Root 覆盖 > operation 声明。没有执行前凭据预检；读取与写入分别在 `ctx.credential.read/write` 调用时判定。

## 结果与错误

成功信封：

```json
{"ok":true,"uri":"locus://info","requestId":"...","data":{"version":"0.0.0"},"links":{"self":"locus://info"},"meta":{"method":"GET"}}
```

失败信封：

```json
{"ok":false,"uri":"...","requestId":"...","error":{"code":"forbidden","message":"...","details":{"reason":"..."}}}
```

稳定错误码：`invalid-argument`、`invalid-body`、`invalid-uri`、`unsupported-scheme`、`unsupported-method`、`unsupported-media-type`、`not-found`、`unauthorized`、`forbidden`、`conflict`、`timeout`、`unavailable`、`unknown-result`、`internal`。

Dispatcher 只输出规范化 URI 与 requestId；不输出输入 Body、秘密或 Provider 原始异常。批量 GET 按输入顺序返回逐项结果，单项业务失败不丢弃其他结果；非 GET 批量在 CLI 层拒绝，Dispatcher 对非 GET 项返回 `unsupported-method`。

能力包在自己的 operation 边界将领域失败转换为 `InvocationFailure`，可在 `details.domain` 保留领域 code；Core 不维护消费者专属码表，也不从错误文案猜测分类。未知 handler 异常只返回固定内部故障信息。结果信封与执行事件在被捕获的执行闭包内产生，Grant 恢复后的失败也遵守相同契约。

各类失败载体的定义、跨层转换点与逐层数据见[错误处理机制](../errors.md)。

## 事件

事件是 CloudEvents 1.0 子集：`specversion: "1.0"` 与 `id/type/source/subject/time/data`。请求事件为 `locus.request.succeeded` 与 `locus.request.failed`；领域事件由 handler 通过 `context.emit()` 发出，现有远程目标事件包括目标登记、移除、凭据更新、迁移、job 完成与服务重启完成。

监听是进程内同步投递，不支持 async 监听器；逐项隔离监听器异常。持久化写入 `events` 表，查询通过 `locus://events`；记录是 best-effort，缺失记录不能证明操作未发生，不作为完整审计，不提供重放或跨进程订阅。

释放是终态：捕获的总线或 Store 句柄在 dispose 后明确拒绝调用，不重新打开数据库；总线释放订阅与内存，持久化连接由其所属组合根单独释放。

## CLI 调用面

`locus get|post|put|patch|delete <uri...>` 直接调用 operation。多 URI 只允许 GET；`--data` 与 `--file`（含 `-`）互斥，Body 只接受 `application/json` 与 `+json`；`--json` 输出信封，`--pretty` 只影响 JSON，未指定时输出人类可读结果。退出码：`0` 成功；`1` 参数、URI、方法或媒体类型错误；`2` 业务、授权或远端失败；`3` 批量部分失败。

裸 URL 默认 GET。help 无参数只列已注册域与路由数；给出 scheme:// 或资源 URL 时从已注册声明平铺读取方法和字段；两者都不执行 handler。纯转发领域命令与组件 id 顶层回退已删除，特殊手写入口仅 version、init、security reset-root 和本地 shell。普通 Body 使用 JSON；可选可信字段通过 --prompt 选择，字段文件必须在声明中显式获准，Root 密码不允许文件。语法见[实用命令](../commands.md)。

## 限制

不包含 HTTP Server/Gateway、Web UI、OMP/MCP 适配器、多用户与 RBAC、事件重放、二进制或 `fs` 资源、持久 job 队列与远程交互会话。开发库按 schema v8 重建，不维护旧结构迁移；`packages/postgres` 仍是临时真实消费者，验证完成后移除。
