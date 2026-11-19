# 决策记录：统一资源调用与 operation 授权

Status: implemented

> CLI 别名策略由[声明驱动的 URL 命令入口](2026-11-18-declaration-driven-url-cli.md)取代；本文继续维护统一 URL、授权和凭据调用模型的取舍。

## 问题

原先 Core 以组件 `capabilities` 为授权键，CLI 通过 `executeComponent` 逐项调用 handler；资源没有统一 URL，调用者需要理解命令树、能力 id、资源对象与 CredentialRef。凭证预检、绑定键和 Root 覆盖都围绕能力展开，导致同一业务动作在 CLI、组件与 Core 之间出现多套描述。

需要把业务入口收敛为“资源 URL + operation”，同时保留权限、凭据与远端失败的既有边界；不能因此引入 HTTP Server、插件加载或第二套策略引擎。

## 决定

**所有业务操作都是 operation**，具有 `method + scheme + authority + path`。CLI 命令只是别名；渲染、确认、`--profile`、`--json`、补全与 attach 属于客户端。Core 提供 `ApiRouter`、`Dispatcher`、结果信封与事件总线；领域包拥有 Scheme、operation 表与 handler。

**URI 使用 WHATWG 规范化**，接受标准 dot segment，再集中执行 Locus 约束：拒绝 userinfo、fragment、控制字符、编码分隔符与解码后改变分段的路径；分段只解码一次；路由、建链与授权共用规范表示。没有引入额外 URL 库。

**能力模型被删除**：`defineComponent()` 返回 `{ component, operations }`；`component` 只含可序列化 operation 元数据与凭据声明，不含 handler；`defineOperation()` 单独定义路由、`auth`、query／input／output、输入元数据与 `run`。`defineCredential()` 只声明 slot 与字段。组件不再声明 capability secrets；handler 在需要时显式调用 `context.credential.read/write`。

**授权键改为 operation**，Root 覆盖键为 `component:operation`。Challenge、Grant 与参数哈希绑定 operation 与参数；参数包含 method、规范 URI、query 与 input 哈希，调用方不能替换参数。User 级 operation 可在 Root 未初始化时运行；Root 级 operation 才要求初始化与认证。取消执行前凭证预检，读取在回调前失败，写入只在实际获准 Root 时可用。

**凭据绑定键改为 `component + slot + resourceKey`**。`locus://credentials/<component>/<slot>/<key>` 只读元数据；秘密只经 `context.credential` 交付。资源 key 由 handler 显式提供，一个 URL 可以有多个 key。注册秘密由可信 Host 通过 TTY 或文件收集，校验后作为 handler input，不进入 URL、外部 Body、日志或事件。

**事件是 CloudEvents 1.0 子集**：请求成功／失败事件加领域事件；同步监听、逐项隔离异常；SQLite `events` 表 best-effort 持久化。事件用于观察与排障，不承诺完整审计、重放或跨进程订阅。

**Scheme 归属固定**：`locus://` 归 Core，`rt://` 归 remote-targets，`template://` 归 templates，`pg://` 归 postgres，`gitea://` 归 gitea。组合根显式注册，无动态插件加载。`packages/postgres` 仍是临时验证消费者。

开发库直接采用 schema v8：凭据绑定改为 resource key，operation 等级替换 capability 等级，新增事件表；此后的结构变更按[本机部署的一跳数据迁移](2026-11-19-single-hop-data-migrations.md)保留相邻版本迁移。

## 备选方案

**保留 capabilities 并叠加 URL 外观**：否决。命令树与能力表仍是两套真源，授权键无法自然覆盖同一 URL 的不同方法。

**引入 HTTP Server 或通用 Gateway**：不采用。当前消费者是本地 CLI 与可信 Host；HTTP 会引入认证、路由与进程生命周期，超出已验证需求。

**先禁止 dot segment、自建严格 URI 解析器**：否决。WHATWG 已提供标准规范化；额外解析器会分叉规范表示并增加编码错误。Locus 约束集中在一个校验函数即可。

**运行时 parse output 并据此改判业务结果**：否决。副作用完成后 schema 失败不能撤销操作；output 只约束类型并在契约测试中解析。

**异步事件投递与重放平台**：不采用。需要后台队列、持久订阅与生命周期管理；当前只需要同步观察与排障。

**保留 CredentialRef 作为 handler 输入**：否决。引用可由 URL 推导，继续传递会让调用者参与凭据寻址；绑定键直接表达组件、slot 与资源。

## 后果

CLI、组件与测试统一经 Dispatcher；旧 `api`、`executeComponent`、capability 等级表和预检路径被删除。代价是组件 handler 需要显式取凭据，领域包要维护自己的 operation 表与路由；错误必须映射到稳定协议码，不能直接透传内部异常。

Root 认证仍由可信 Host 完成，Dispatcher 只接受真实 Session；Resume 执行 Core 保存的原闭包。Root 重置会撤销所有待处理 Challenge 与 Grant。事件持久化失败不阻断业务，但缺失记录不能证明操作未发生。

运行证据包括：Core 单元测试覆盖解析、路由冲突、方法、tty Body 拒绝、批量部分失败、Root 写／User 读、operation 覆盖、Session Grant 与重置撤销；SQLite 测试覆盖 schema v8、绑定键、Profile 隔离与事件持久化；CLI 测试覆盖 init、pg 登记、operation 覆盖、Root 变更／重置、URL 动词与退出码；包测试覆盖 `pg://`、`gitea://`、`template://`、`rt://` 的 handler 与失败边界。平台与未覆盖项仍由[统一资源调用](../../../../docs/subsystems/invocation.md#限制)与[安全子系统](../../../../docs/subsystems/core/security.md)维护。
