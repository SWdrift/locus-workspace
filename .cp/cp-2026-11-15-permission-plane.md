# CP 权限控制面

## Control Plane Role

本平面控制统一权限控制面的实施：组件能力注册、默认权限声明、Root 覆盖、组件能力 API、CLI 消费与 Root 提权。密钥问题首先不是存储或交付问题，而是权限控制面问题：哪个组件的哪个命令、以什么等级、在什么资源上、由谁批准使用哪个密钥。

权限控制面主体已实施：组件命令、`CapabilityContext`、Root 覆盖、按 slot 绑定与配置引用包已落地；剩余工作是测试、行为文档与真实平台证据收尾。Keyring、KDF、CredentialRef 绑定与平台证据仍由 [Core Security CP](./cp-2026-11-15-core-security.md) 维护；Session 与 Root 批准生命周期由[生命周期管理](./cp-2026-11-15-lifecycle.md)维护。

## Meta Reference

- [cp-meta](./cp-meta.md)：控制平面结构、命名与更新规则。
- [Core Security CP](./cp-2026-11-15-core-security.md)：Keyring、Root、CredentialRef 与平台证据。
- [生命周期管理 CP](./cp-2026-11-15-lifecycle.md)：Session、操作级/Session Grant 与常驻 Host 演进。
- [权限控制面设计记录](../.agents/notes/implemented/architecture/2026-11-15-permission-control-plane.md)：命名、组件/CLI 边界、凭据字段与访问模式的完整理由。
- [Core Security 契约](../docs/subsystems/core-security.md)：当前安全事实，待实施后同步。
- [CLI](../apps/cli/README.md)：命令面与可信 Host。
- 创建或更新使用 `create-control-plane`；收束使用 `compact-control-plane`。

## Scope

- `ComponentSpec` 的能力注册参数：capability、`resourceType`、`defaultAuthLevel`、`secrets`。
- 持久化认证等级覆盖与有效认证等级计算：Root 覆盖 > 组件默认声明 > user。
- 组件能力 API 与 `CapabilityContext`：`execute`、`withCredential`、`registerCredential`。
- capability 本地 id、全局限定规则与展示/存储分层。
- CLI 命令到能力的映射、参数/展示、统一 Root 提权；不把 CLI 注册放进组件。
- 组件命令的原子登记/绑定，例如 `pg register`、`remote-targets migrate`。
- Core 统一解析 `CredentialRef`；Compose 仅消费解析后的引用，不各自复制格式。
- 不包含：Keyring 适配器、KDF、数据库/HTTP/SSH 协议、Session 生命周期、通用 Policy 引擎。

## Core Rules

- 用户入口是组件命令，例如 `locus pg register`、`locus pg list`；`credential put/bind` 不再是普通用户入口。
- 组件注册能力，不注册 CLI；命令树、参数、提示、渲染与退出码归 `apps/cli`。组件包不得包含 CLI 命令文本或 `locus ...` 用法；`component.info` 只描述能力。
- 错误分层：Core 的授权/凭据错误是 `SecurityFailure`；能力显式抛出的 `CapabilityFailure` 原样穿透；CLI 只负责命令、输入、渲染与退出码。通用异常仍收为 `operation-failed`，避免秘密泄漏。
- Remote Targets 的 `add` 在 Root 批准后同时写目标配置与凭证字段；`update-credential` 只更新凭证，不改配置。
- capability 的 `id` 是组件本地名，例如 `register` / `list`；全局引用由 `${component.id}:${capability.id}` 派生，例如 `postgres:register`。
- 权限、绑定与 API 以 componentId + 本地 capability id 为键；日志、错误与 Root 管理展示使用限定名，不把前缀写回本地 id。
- 组件用一份 `defineComponent` 定义元数据、能力声明、凭据字段与 handler；返回可序列化的 `component` 给 Core、按本地 capability id 索引的 `api` 给 CLI/Web。
- 组件可以声明 `defaultAuthLevel`；Root 覆盖优先。有效认证等级固定为：Root 覆盖 > 组件默认声明 > user。
- Root 设置的是“组件的某个能力/命令”的等级；组件声明不能绕过 Root 覆盖。`write` 能力默认 root；Root 显式降为 user 时，覆盖凭据是预期行为，不额外阻止。
- CLI 只传递参数与展示结果；密钥读取、绑定、CredentialRef 不进入 CLI 业务命令。
- `secrets` 只声明能力可使用的凭据槽及访问模式（read/write），不发起输入；字段提示与收集由 CLI/可信 Host 根据组件命令输入描述完成，Core 不读取 stdin/TTY。
- `read` 槽默认要求已登记并绑定；`write` 槽不要求预先存在。凭据用 `fields` 声明，Core 按 `secret` 拆分公开/秘密；可选字段用 `required` 表达。
- 字段语义、实例解析与登录状态归组件：`username`/`password` 等字段的含义由组件 API/配置解释；`resource.id` 指向哪个 PostgreSQL 实例由组件配置解析。Core 只做精确 resource 匹配，不维护全局“当前实例”或数据库登录状态。
- 组件能力通过 `CapabilityContext` 消费密钥；Core 校验能力、资源、密钥槽与绑定，不向调用方导出秘密。
- Workspace 关系的 `ResourceReference` 继续使用 `{ namespace, id }`；Security 请求与绑定使用独立的 `SecurityResource { type, id }`，不把两个领域合并成同一字段。
- 一条组件命令对应一次 Core 操作、一次 Root 批准；内部 `withCredential`/`registerCredential` 不重复触发 Challenge。
- 同一凭据槽可被多个能力共用；登记时为组件内所有声明该槽的能力建立绑定，读取时仍按当前 capability 精确校验。
- 删除 `action` 与 `operation`：请求只含 capability/resource/parameters；Challenge/Grant 用限定 capability 展示。
- 保留 `operation` 与 `session` 两种 Grant；session 只绑定真实 Session，不跨进程。
- 授权门先于凭据门：Root 不足返回 Challenge 并由 CLI 提权；凭据缺失/未绑定返回独立错误，不触发 Root 提权。
- Core 不返回 CLI 命令名；它返回 code + component/capability/slot，CLI 将其映射为组件登记/修复命令。
- `execute` 前预检能力、资源与 read 槽的绑定/元数据；Keyring 内容在 `withCredential` 读取时判定 Missing。组件不得在首次读取密钥前产生不可逆副作用。write 槽不要求凭据预先存在。
- `register` 类命令必须原子完成“写密钥 + 绑定 + 组件配置更新”，不能留下半完成状态。
- 配置文件中的 `credential:<id>` 由 Core 的 `parseCredentialRef` 解析与校验；组件不各自实现一套引用规则。
- `CredentialMetadata` 持久化 `owner`；第一版一个 CredentialRef 只对应一个组件。非 owner 不能写或消费；解绑不转移 owner，转移需 Root 删除后重新登记。
- 不新增 daemon、跨进程 Token 或 Session 整体放权；相关边界见[生命周期管理](./cp-2026-11-15-lifecycle.md)。
- 行为变更必须有自动测试或真实运行证据；未运行不得写成已交付。
- capability 只声明 resourceType；请求与绑定使用精确 resource id。多实例共享同一能力，但每个资源必须有独立绑定；不得用通配 resource 授权。

## Task Board

### 契约冻结

- [x] 冻结 `ComponentSpec` 能力注册字段：本地 `id`、`defaultAuthLevel`、`secrets`、资源与凭据槽的对应关系。
- [x] 冻结全局限定规则：`${component.id}:${capability.id}` 只用于展示/审计；权限与绑定仍按 componentId + 本地 capability id 存储。
- [x] 拆分安全资源类型：Workspace 的 `ResourceReference` 保持 `{ namespace, id }`；新增 `SecurityResource { type, id }`；迁移 Core security、CLI、Compose、绑定表与测试。
- [x] 移除 capability `action`：请求只带 capability/resource/parameters；更新策略、测试与文档。
- [x] 调整组件物化：`capabilities`/`credentials` 不写入可编辑 YAML；外部组件不注册可执行能力。
- [x] 冻结凭据 `fields`：去掉独立 `schema` 标识；Core 按字段的 `secret` 拆分公开/秘密，组件解释字段语义。
- [x] 冻结 `secrets` 的 access 模式与 execute 前预检顺序；第一版不引入 slot 级 `required`。
- [x] Root 认证等级覆盖按 component + capability 持久化；不引入资源维度。
- [x] capability 只声明 resourceType；请求/绑定使用精确 resource；不使用全局当前实例。
- [x] 冻结 `CapabilityContext` 公共方法与错误分类；确认 `withCredential` 不重复授权。
- [x] 错误回执保留 code/reason，不写 CLI 字符串；CLI 负责映射组件命令。
- [x] CredentialRef 解析已归 Core；Compose 不各自维护引用正则。
- [x] 冻结单 owner：`CredentialMetadata.owner`、非 owner 拒绝、解绑不转移；schema v7。

### Core 与组件

- [x] 认证等级覆盖存储、有效等级计算与 Root 设置入口已实现；组件 `level` 直接生效路径已移除。
- [x] `CapabilityContext`、`registerCredential` 与 `withCredential` 已实现，内部复用单次 Grant。
- [x] 凭据 owner 持久化与单 owner 读写校验已实现；旧开发库按最新 schema 重建/一次性迁移。
- [x] PostgreSQL 组件提供 `register` / `list` 能力 API。
- [x] Gitea 组件提供 `register` / `request` 能力 API；第一版不暴露 CLI 命令。
- [x] Remote Targets 提供独立登记/访问能力；`migrate` 经组件 API 登记并保留配置更新边界。

### CLI

- [x] `apps/cli` 增加 `pg register/list` 与统一 `executeComponent`；组件包不引入 Commander。
- [x] CLI 根据组件命令输入描述生成字段提示；Core 不发起交互输入。
- [x] 统一 Root 提权包装已实现，支持显式 `--grant-scope operation|session`。
- [x] 收回用户侧 `credential put/bind`；CLI 提供显式 `--grant-scope operation|session`。
- [x] 增加 `security capability list/set/reset`。

### 配置引用

- [x] CredentialRef 由 Core 统一解析，PostgreSQL/Gitea/Remote Targets 共用。
- [x] 配置读取只保存 `credential:<id>`；缺失、非法与未绑定分别可判。
- [x] 明文密钥迁移到引用保留显式确认，不自动删除源文件。

### 验证

- [x] 组件默认 user/root、Root 覆盖、重置回默认的测试。
- [x] 一条命令只触发一次 Challenge；内部密钥读取不重复提权。
- [x] User/Agent 正常使用不触发 Root；Root 级命令必须认证。
- [x] 凭据缺失、字段不符、未绑定、Provider 不可用与权限拒绝分开。
- [x] PostgreSQL、Gitea、SSH 真实消费与配置引用迁移证据；PostgreSQL/SSH/Keyring 手工验证通过。
- [x] 更新 Core/CLI/命令文档、组件 README 与 Agent Notes；平台矩阵保留未验证项。

## 验证记录

- `pnpm verify`：构建通过，186/186 测试通过，文档检查 59 个 Markdown 通过。
- `pnpm e2e`：最近一次 36 次真实 CLI 调用通过；最终 add/错误分层改动后入口处于 2 小时冷却，未使用 `--force` 重跑。
- Core 测试覆盖字段拆分、共享 slot 绑定、Root 覆盖、单次 Challenge/Grant、跨进程锁定与 schema v7。
- PostgreSQL：临时 PG16、scram、Core 字段、真实 `pg.Pool` 查询通过。
- SSH：真实 OpenSSH sshd、精确绑定、临时私钥清理、错误密钥拒绝通过。
- Keyring：独立 Windows 临时账户、2560/2561 边界、Missing、跨进程与清理通过。

## 定义方式（冻结草案）

一份定义，两个运行时视图：

- 作者只写一次 `defineComponent(...)`：元数据、能力声明、凭据字段、handler。
- 返回 `component`：可序列化注册数据，不含函数，交给 Core。
- 返回 `api`：按本地 capability id 索引的 handler，交给 CLI/Web。
- Core 不接收 handler；CLI/Web 不重新定义权限。

```ts
// packages/postgres/src/handlers.ts
import type { CapabilityHandler } from '@locus/core'

export const register: CapabilityHandler = async (context, input) => {
  await context.registerCredential('database-auth', input.credential, {
    username: input.username,
    password: input.password,
  })
  return { registered: true }
}

export const list: CapabilityHandler = async (context, input) => {
  return context.withCredential('database-auth', input.credential, async (credential) => {
    // 连接 PostgreSQL 并查询
  })
}
```

```ts
// packages/postgres/src/index.ts
import { list, register } from './handlers.ts'

export const postgres = defineComponent({
  id: 'postgres',
  version: '1',
  name: 'PostgreSQL',
  summary: 'PostgreSQL 连接与查询',
  kind: 'locus',

  capabilities: [
    {
      id: 'register',
      resourceType: 'database',
      defaultAuthLevel: 'root',
      secrets: [
        { slot: 'database-auth', access: 'write' },
      ],
      run: register,
    },
    {
      id: 'list',
      resourceType: 'database',
      defaultAuthLevel: 'user',
      secrets: [
        { slot: 'database-auth', access: 'read' },
      ],
      run: list,
    },
  ],

  credentials: [
    {
      id: 'database-auth',
      fields: [
        { name: 'username', secret: false, required: true },
        { name: 'password', secret: true, required: true },
      ],
    },
  ],
})

postgres.component // 交给 Core：能力目录、权限默认值、凭据字段
postgres.api       // 交给 CLI/Web：本地 capability id -> handler
```

`defineComponent` 必须校验：

- 每个 `locus` 能力都有且只有一个 `run`；
- `api` 的键与 `component.capabilities[].id` 一一对应；
- `component` 中的能力描述不包含 `run`；
- `secrets` 引用已声明的凭据槽；
- 外部 `kind: external` 组件不注册可执行能力。

`component` 与 `api` 是同一个定义的两个视图，不是两份手工维护的清单：

```text
defineComponent(...)
  ├─ component：可序列化，Core 消费
  └─ api：函数表，CLI/Web 消费
```

### resource 语义

`resource` 是请求与绑定的精确逻辑对象引用：

```ts
resource: { type: 'database', id: 'production' }
```

但 capability 声明不需要静态枚举每个实例。两层分开：

```text
capability.resourceType = 'database'
request.resource        = { type: 'database', id: 'production' }
binding.resource        = { type: 'database', id: 'production' }
```

- capability 只声明它作用的资源类型（resourceType）。
- 请求和绑定携带精确 resource id。
- 同一 capability 可以绑定多个资源，例如 `database/production` 与 `database/staging`。
- 每个资源必须有独立绑定；没有绑定就拒绝，不能用一个凭据覆盖同类型的所有实例。
- Core 把 type/id 当作不透明精确值，不解释 host、路径或业务含义。
- 组件负责把 id 解析为连接配置、实例地址或目标。
- 不支持 `*`、`?`、前缀或同类型通配绑定。
- Root 认证等级覆盖当前按 component + capability 设置；是否需要 resource 维度仍是待冻结项。
- resource id 是稳定身份；把同一 id 指向另一台物理实例等于改变授权对象，必须重新绑定，组件/Host 不得静默改写。

### 安全资源类型

安全资源与 Workspace 关系目标不是同一种东西，不共用字段名：

```ts
// Workspace 长期关系继续使用
interface ResourceReference {
  namespace: string
  id: string
}

// Security 请求与绑定使用
interface SecurityResource {
  type: string
  id: string
}
```

- Workspace 关系目标描述领域解释的外部引用，保留 `namespace`。
- Security 资源描述权限与凭据绑定的精确对象，使用 `type`。
- capability 的 `resourceType` 与 `SecurityResource.type` 对应。
- 绑定表字段 `resource_namespace` 迁移为 `resource_type`，但 Workspace 关系表不改。
- 不直接全局重命名 `ResourceReference.namespace`，避免污染 Workspace 领域。

### credentials.fields

`credentials` 用 `fields` 直接描述凭据结构，不另设 `schema` 或 `format` 标识：

```ts
{
  id: 'database-auth',
  fields: [
    { name: 'username', secret: false, required: true },
    { name: 'password', secret: true, required: true },
  ],
}
```

- `fields` 是唯一结构声明：字段名、是否秘密、是否必填。
- Core 不理解字段业务含义；组件解释 `username`、`privateKey` 等语义。
- 公开字段写入 SQLite 元数据；秘密字段作为一个 JSON 值与凭据元数据一起写入 Keyring。
- 登记时 Core 校验必填字段、未知字段与字段名；读取时合并公开/秘密字段返回。
- 字段变化应显式重登记或迁移；不做静默字段转换；秘密字段合并后超过 Keyring 单条容量即失败。
- 第一版不引入 JSON Schema、嵌套结构、类型表达式或通用校验 DSL；出现真实需求再扩展。

### capabilities 是否物化为 YAML

不物化为可编辑真源。`capabilities`、`credentials`、`defaultAuthLevel`、`secrets` 是可信代码契约；写入组件 YAML 会形成第二份可编辑真源，并允许通过改 YAML 伪造能力或权限默认值。

组件 YAML 只保存描述性/可编辑元数据，例如：

```yaml
id: postgres
version: "1"
name: PostgreSQL
summary: PostgreSQL 连接与查询
kind: locus
requires: []
config: postgres/
```

`component show` 从运行中的 `component` 读取能力与凭据字段的只读投影，并展示 `${component.id}:${capability.id}` 限定名；YAML 不参与授权、不参与能力注册。外部组件只有数据，不注册可执行能力。

### CapabilityContext

组件能力的唯一凭据入口：

```ts
interface CapabilityContext {
  registerCredential(
    slot: string,
    reference: CredentialRef,
    values: Readonly<Record<string, string>>,
  ): Promise<void>

  withCredential<T>(
    slot: string,
    reference: CredentialRef,
    consume: (values: Readonly<Record<string, string>>) => Promise<T>,
  ): Promise<T>
}
```

### `secrets.access` 的作用

`access` 限制该能力对凭据槽允许的操作，不授予凭据本身：

| access | 允许 | execute 前预检 |
| --- | --- | --- |
| `read` | `withCredential` | 槽已登记、元数据存在、绑定匹配；Keyring 内容在首次读取时判定 |
| `write` | `registerCredential` | 不要求凭据预先存在；允许创建或覆盖 |

- `read` 能力不能调用 `registerCredential`，避免只读能力改写秘密。
- `write` 能力不能调用 `withCredential`，避免写入能力读取旧秘密。
- `access` 不决定 user/root；认证等级由 `defaultAuthLevel` 与 Root 覆盖决定。
- `access` 不替代绑定；Core 仍要求 component + capability + resource + slot 的精确绑定。
- 删除凭据不通过组件能力暴露；仍由 Root 管理。
- 多凭据替代方案不在 `access` 上表达；第一版不隐式推断。
- 第一版只提供 `read` / `write`；`readwrite`（如 OAuth 刷新）待真实消费方出现再引入。

### 凭据字段与存储

- `secret: false` 字段进入凭据元数据（SQLite），例如 PostgreSQL 用户名。
- `secret: true` 字段进入 Keyring，作为一个带字段名的 JSON 值；不按字段分片。
- 交付时 Core 合并公开字段与秘密字段，返回字段值；组件按自己的字段语义解释。
- Keyring 仍受单条容量上限约束；秘密字段合并后超限明确失败，不回退明文文件。
- 主机指纹、`known_hosts` 等信任锚属于连接/信任配置，不进入凭据秘密。

SSH 的凭据只包含私钥与可选口令：

```ts
credentials: [
  {
    id: 'ssh-auth',
    fields: [
      { name: 'privateKey', secret: true, required: true },
      { name: 'passphrase', secret: true, required: false },
    ],
  },
]
```

### 定义不变量

- `component` 必须可序列化；函数、CLI 命令名、Keyring 访问不进入 `component`。
- `api` 由 `defineComponent` 从能力声明派生；作者不单独维护第二份列表。
- `run` 使用具名函数引用，不在 `defineComponent` 中就地写箭头函数或匿名函数；handler 放在独立模块，便于测试、复用和审查。
- capability 本地 id 稳定且就是组件内操作身份；全局限定名只在展示/审计时派生；第一版不另设 `action`。
- CLI 命令名可以独立调整，不进入 Core 契约。
- `defaultAuthLevel` 只是默认值；Root 覆盖优先。
- `secrets` 必须引用已声明的凭据槽；未声明的槽不能注册或读取。`secrets` 是能力可用槽的声明，不是输入请求。
- `read` 槽默认需要已登记并绑定；`write` 槽不要求预先存在；可选字段用 `fields[].required: false`，不在 `secrets` 上重复。
- 多凭据替代方案（例如 token 或 username-password 二选一）第一版不隐式推断；出现真实消费方时再引入显式 `anyOf`/认证策略。
- 凭据字段的提示、收集与重试归 CLI/可信 Host；Core 只校验字段、存储和交付，不读取 TTY/stdin。
- 凭据结构由组件声明的 `fields` 决定；Core 只区分公开/秘密字段，不理解 PostgreSQL、SSH 或 Gitea 的业务语义。
- 主机指纹、`known_hosts` 等信任锚属于连接/信任配置，不进入凭据秘密。
- 能力、资源和凭据槽的绑定仍由 Core 精确校验；组件 API 不能自行选择其他组件的密钥。
- 配置中的 `credential:<id>` 由 Core 的 `parseCredentialRef` 解析；组件 API 只消费解析后的引用。
- CLI 的 Root 提权只包裹一次 `api` 调用；`withCredential`/`registerCredential` 不重复触发 Challenge。

## 实施前差距（已闭合）

下表保留实施前的对照，用来说明迁移范围；当前代码以本文“Core Rules”和验证记录为准。

| 实施前 | 目标 |
| --- | --- |
| `credential put/bind` 是用户入口 | 组件命令是入口；控制面端口仅供组件消费 |
| `ComponentSpec.capabilities[].level` 直接生效 | 组件注册 `defaultAuthLevel`，Root 覆盖优先 |
| Workspace 与 Security 共用 `ResourceReference.namespace` | Workspace 保持 `namespace`；Security 拆出 `SecurityResource.type` |
| PostgreSQL/Gitea 只有低层 helper | 提供能力 API 与组件命令 |
| CLI 接触 CredentialRef/绑定 | CLI 只传参数、处理提权、渲染 |
| 配置文件各自解析引用 | Core 统一解析 `CredentialRef` |
| `pg register` 与绑定分离 | 一次 Core 操作完成登记与绑定 |
| `capabilities`/`credentials` 物化为可编辑 YAML | 代码契约只读；YAML 只保留描述性元数据 |
| 单一 `kind` + 字符串秘密 | 已改为 `fields` 字段表；公开字段元数据、秘密字段 Keyring，合并交付 |
| 指纹/known_hosts 与密钥混在一起 | 信任锚归连接配置，凭据只保存认证材料 |
| 组件字段/实例语义由 Core 猜测 | 组件 API/配置解释；Core 只按 resource 精确匹配 |
| capability 静态枚举每个 resource | capability 声明 resourceType；请求/绑定使用精确 resource id |
| capability id 自带组件前缀 | 本地 id；全局限定名按需派生 |
| 权限不足与凭据缺失混在一起 | 先授权门，后凭据门；Missing 不提权 |
| Session Grant 与 `--grant-scope` | `operation` 与 `session` 两种 scope；session 绑定真实 Session |
