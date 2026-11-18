# 决策记录：错误载体与兜底分类

Status: implemented

## 问题

现行实现把分类拆在两个位置：能力包在自己的 handler 里写 `try/catch`，把领域码映射为协议码；Core 的 Dispatcher 再用 `instanceof` 链处理核心自有类型。分类完备性靠人工——未包装的领域失败一律降级 `internal`，`TemplateFailure` 不在任何分派中，两处分派（`toFailure` 与 CLI）覆盖的类集合还不一致。失败信封与失败事件都缺少 `operation`，在不保留栈的前提下无法回答"哪个 handler 失败"。

载体也没有统一契约：四个基类各自声明 `code`，`DomainFailure.code` 仍是 `string`，跨包只能靠 import Core 的基类来保证形状。调试信息没有受控出口：不携带原始异常是刻意的规则，但开发者也没有可开关的取栈通道。

现行对外行为与可见性见[错误处理机制](../../../../docs/errors.md)。

## 决定

### 统一载体契约

- 导出结构类型 `Failure { kind, code, message, details?, cause?, reason?, challenge? }` 与守卫 `isFailure`；判定只看结构，不依赖 `instanceof`，组件不必 import Core 基类。
- `FailureKind = 'protocol' | 'security' | 'component' | 'workspace' | 'domain'` 由 Core 拥有；每个失败类携带字面量 `kind`，`DomainFailure` 子类默认继承 `'domain'`，`WorkspaceFailure` 覆盖为 `'workspace'`。

### 分派表

`HANDLERS: Record<FailureKind, (failure, debug) => FailurePayload>`，用 `satisfies` 保证每个 kind 都有处理器；模块内私有，不进入包导出面。

Core 自有的三个 kind 必须校验码属于各自封闭表，未知码回落 `domain` 兜底，禁止产生 `undefined` 协议码。`domain` 兜底把协议码固定为 `internal`，只在 `details.domain` 保留领域码，不复制其余 `details` 与 `message`。

### 组件侧

- 不强制包装：未包装的领域失败由 Dispatcher 兜底，得到 `internal` 与 `details.domain`。
- 需要精确协议码时，在 operation 边界构造 `InvocationFailure(协议码, message, { details, cause })`。
- `InvocationFailure` 第三参由 `details` 改为 options `{ details?, cause? }`，消除位置歧义；`cause` 只存在于内存，任何序列化路径都不读取它。

### 兜底与调试

- Dispatcher 的 `failed()` 是唯一兜底；内层 handler catch 与外层协议 catch 都走它。
- 失败信封补 `meta: { method, operation }`，失败事件 `data` 补 `operation` 与 `domain`，与成功路径对齐。
- `LOCUS_DEBUG === 'true'` 时向 `details.stack` 写入帧数组：剥掉 `name: message` 首行，沿 `cause` 链拼接，上限 40 帧，不改变协议码。开关关闭时任何路径都不出现 `details.stack`。
- 人读模式把帧追加到 stderr；`--json` 模式帧位于 `details.stack`。不引入诊断文件、脱敏过滤器，也不序列化 `cause`。

## 备选方案

**类构造器作为 Map key。** `WorkspaceFailure` 与 `RemoteTargetsFailure` 继承 `DomainFailure`，精确键查不中父类条目；要正确就得沿原型链走，等于重写 `instanceof`，同时丢失 TypeScript 收窄。

**保留现有 `instanceof` 链。** 无法保证完备：新增失败类不会编译失败，只会静默降级；`toFailure` 与 CLI 的两套分派还会继续分叉。

**新增 builder `wrapFailure()`。** 与构造器功能重复，形成两个入口；"必须传 cause"是软约束，builder 给不了编译期保证。

**栈 + 白名单脱敏。** 第三方错误通常在内部已收敛，我们又不序列化原始异常，没有需要过滤的内容；额外维护白名单与过滤规则是白费力气。

**独立诊断文件。** 数据目录按"停写后复制整个目录"备份，诊断文件会把绝对路径带进备份，还要额外处理权限与轮转；开发者场景下 stderr 已被调用方捕获，文件没有净收益。

## 验证

- `pnpm verify`：构建、lint、格式、全部 192 个测试与文档检查通过。
- Core 调用测试覆盖：未包装领域失败的兜底与 `details.domain`、裸异常（无 `kind`）的固定消息与 debug 帧、失败信封 `meta.operation`、失败事件 `operation`/`domain`、debug 关闭时无 `details.stack`、debug 开启时帧来自源错误且不含消息。
- CLI 测试覆盖：失败信封含 `meta.operation`、`LOCUS_DEBUG=true` 时 JSON 帧数组与人读模式 stderr 帧。
- 手工运行确认 `rt://targets/nope` 在 debug 关闭/开启下的输出与事件记录。

## 后果

- 收益：分类只有一个入口；未包装的领域失败不再丢失领域码；失败信封与事件都能指出 `operation`；debug 可取到组件内部真实抛出点。
- 代价：结构判定削弱封闭性，只能靠码表成员校验兜住；未包装即丢失组件自己的 `details`，需要保留就必须包装。
- 构造器签名改动触及 62 处调用点，其中传 `details` 的 7 处逐个调整。
- debug 帧包含绝对路径，可能被粘贴到外部；开关仅限开发用途。
- `kind` 词表扩容仍需改 Core；这是分类轴归属 Core 的代价，不是遗漏。
- 未传 `cause` 的包装只保留转换点帧；这是"不强求包装"的已知代价，文档已写明。
