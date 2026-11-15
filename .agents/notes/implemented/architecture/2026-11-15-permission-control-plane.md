# 决策记录：权限控制面与组件能力

Status: implemented

## 问题

原实现把安全控制面的内部能力直接暴露成 `credential put/bind`，用户看到的是通用密钥管理，而不是组件命令。这带来四个问题：

- 密钥登记与业务组件脱节，组件无法自然决定“注册时输入什么、使用时如何认证”。
- 权限等级由组件声明直接生效，Root 无法按组件命令覆盖读/写风险。
- 配置中的 `credential:<id>` 没有独立归属，各组件容易各自实现一套解析。
- CLI 可能接触 Keyring、凭据绑定和凭据字段，密钥能力没有对上层隐藏。

需要把入口收敛为组件命令，把权限、凭据与 Root 提权收敛到 Core，把 CLI 限制在命令、参数、提示、展示与提权编排。

## 决定

### 一份定义，两个运行时视图

组件包只写一次 `defineComponent(...)`，返回两个视图：

```text
defineComponent(...)
  ├─ component：可序列化元数据，交给 Core
  └─ api：按本地 capability id 索引的 handler，交给 CLI/Web
```

- `component` 不含函数，负责能力目录、默认认证等级、凭据字段与组件元数据。
- `api` 不含权限与密钥，只包含能力实现。
- Core 不接收 handler；CLI/Web 不重新定义权限。组件包不包含 CLI 命令、参数、提示或退出码文本。
- `capabilities` / `credentials` 是可信代码契约，不物化为可编辑 YAML。组件 YAML 只保存描述性元数据。

```ts
// packages/postgres/src/index.ts
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
```

`run` 使用具名函数引用，不就地写箭头函数；handler 放在独立模块，便于测试与审查。

### capability id 是组件本地名

```ts
id: 'register'
```

不是：

```ts
id: 'postgres:register'
```

- 权限、绑定与 API 以 `componentId + 本地 capability id` 为键。
- 全局展示/审计使用 `${component.id}:${capability.id}`，例如 `postgres:register`。
- 全局限定名不写回本地 id，组件改名不要求逐个改 capability 前缀。
- 第一版不设 `action`；本地 capability id 就是操作身份，避免 id/action 双重真源。

### 组件命令与 CLI

组件不注册 CLI。CLI 在 `apps/cli` 定义：

```text
locus pg register -> postgres / register
locus pg list     -> postgres / list
```

该映射只存在于 CLI。CLI 负责：

- 参数、提示与展示；
- 构造授权请求；
- 统一 Root 提权；
- 把错误映射为组件登记/修复命令。

组件包负责：

- capability handler；
- 数据库/HTTP/SSH 等业务协议；
- 通过 Core 消费或登记凭据。

Core 负责：

- 认证等级与 Root 覆盖；
- 能力/资源校验；
- 凭据保管、绑定与交付；
- Challenge / Grant。

### request 是什么

`request` 是 CLI 在调用能力时临时构造的授权请求，不是组件定义，也不持久化：

```ts
const request = {
  capability: 'list',
  resource: {
    type: 'database',
    id: 'production',
  },
  parameters: {
    config: '/path/to/postgres.yaml',
  },
}
```

- `capability` 是组件本地 capability id。
- `resource.type` 对应 capability 的 `resourceType`。
- `resource.id` 是本次操作的具体实例。
- `parameters` 只包含非秘密输入。
- 凭据引用不在 `request` 中；组件 handler 从配置读取后通过 `context.withCredential` 使用。

### resourceType 与精确资源

capability 只声明资源类型：

```ts
resourceType: 'database'
```

请求与绑定携带精确资源：

```ts
resource: { type: 'database', id: 'production' }
resource: { type: 'database', id: 'staging' }
```

- 同一 capability 可以绑定多个精确资源。
- 每个资源必须有独立绑定；没有绑定就拒绝。
- 不接受 `*`、前缀或同类型通配绑定。
- Workspace 关系的 `ResourceReference` 保持 `{ namespace, id }`；Security 使用独立的 `SecurityResource { type, id }`，不全局重命名共享类型。
- `resource.id` 是稳定身份；把同一 id 指向另一台物理实例等于改变授权对象，必须重新绑定。

### defaultAuthLevel 与 access

```ts
defaultAuthLevel: 'user' | 'root'
```

- 组件声明默认认证等级；Root 覆盖优先。
- 有效认证等级：Root 覆盖 > 组件默认声明 > user。
- `defaultAuthLevel` 不决定凭据读写权限。

```ts
secrets: [
  { slot: 'database-auth', access: 'read' },
]
```

- `read`：允许 `withCredential`；预检要求凭据已登记并绑定。
- `write`：允许 `registerCredential`；不要求凭据预先存在。
- 第一版不提供 `readwrite`；出现 OAuth 刷新等真实消费再引入。
- `access` 不替代绑定；Core 仍校验 component + capability + resource + slot。
- Keyring 内容在首次 `withCredential` 读取时判定 Missing；组件不得在首次读取秘密前产生不可逆副作用。
- 凭据缺失/未绑定不触发 Root 提权；Root 不足才返回 Challenge。

### 凭据字段：fields，不是 schema

凭据用 `fields` 描述结构，不另设 `schema` 或 `format` 标识：

```ts
credentials: [
  {
    id: 'database-auth',
    fields: [
      { name: 'username', secret: false, required: true },
      { name: 'password', secret: true, required: true },
    ],
  },
]
```

- `fields` 是唯一结构声明：字段名、是否秘密、是否必填。
- Core 不理解字段业务含义；组件解释 `username`、`privateKey` 等语义。
- 公开字段进入 SQLite 元数据；秘密字段作为一个 JSON 值进入 Keyring。
- 登记时 Core 校验必填字段、未知字段与字段名；读取时合并公开/秘密字段返回。
- 字段变化显式重登记或迁移；不做静默转换。
- 不引入 JSON Schema、嵌套结构或通用校验 DSL。
- SSH 指纹、`known_hosts` 属于目标信任配置，不进入凭据字段。

### CapabilityContext 与 handler

`CapabilityHandler` 不直接接触 Host、Keyring 或 SQLite。Core 在授权后注入能力级 `CapabilityContext`：

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

- `slot` 是组件声明的凭据槽，例如 `database-auth`。
- `reference` 是组件配置中的稳定 CredentialRef。
- Core 检查 capability 是否声明该 slot、`access` 是否允许该操作、绑定是否精确、字段是否合法。
- handler 通过 context 完成密钥操作；CLI 只传参数与展示结果。
- Core 的授权/凭据错误使用 `SecurityFailure`；组件显式抛出的 `CapabilityFailure` 原样穿透；通用异常仍收为 `operation-failed`，避免秘密泄漏。

### 一次命令，一次 Root 批准

当前 Core 是进程内库，CLI 每条命令通常创建并结束一个 Session。跨命令 Session 放权不成立。

- 一条组件命令对应一次 Core 操作、一次 Root 批准。
- `register` 类命令在 Core 内完成写字段、元数据与绑定；组件配置更新由 CLI 显式编排，不能宣称跨存储 2PC。
- 内部 `withCredential` / `registerCredential` 不重复触发 Challenge。
- 同一凭据槽被多个能力共用时，登记为所有声明该槽的能力建立精确绑定。
- 不通过环境变量、文件 Token、`locus shell` 环境或伪造 Session 模拟跨进程授权。
- 常驻 Host 是未来演进方向，不是当前已交付事实。

### 配置引用与原子登记

- 配置文件只保存 `credential:<id>`。
- 独立 `@locus/config-reference` subsystem package 只负责解析与校验引用，不读取 Keyring、不读取文件、不执行迁移。
- `locus pg register` 先校验组件输入，再由 handler 调用 `registerCredential` 原子完成写密钥与绑定。
- 不提供用户侧通用 `credential put/bind`；普通 User 不接触 Keyring、CredentialRef 绑定或字段结构。

## 备选方案

**用户侧保留通用 `credential put/bind`**：否决。它把控制面内部能力暴露成入口，组件命令无法自然表达注册、认证与配置更新，密钥能力也没有对上层隐藏。

**组件注册 CLI 命令**：否决。组件包会依赖 Commander、参数解析、TTY 与退出码；CLI/Web 无法共享同一能力 API，组合根失去显式装配边界。

**capabilities/credentials 物化为可编辑 YAML**：否决。会形成第二份可编辑真源，允许通过改 YAML 伪造能力、默认等级或字段结构；代码契约应只读。

**capability id 自带组件前缀**：否决。组件定义内重复写 `postgres:`；权限与绑定已按 componentId + 本地 id 限定，全局名只在展示/审计时派生。

**保留 `schema`/`format` 标识**：否决。字段表已经描述结构；额外 schema id 需要版本、迁移与匹配规则，却没有独立消费者。字段变化显式重登记即可。

**单一 `kind` + 隐藏字符串载荷**：否决。复合认证需要字段拆分；公开字段（如用户名）应可进入元数据，秘密字段进入 Keyring，组件不应把结构完全藏进不透明字符串。

**全局重命名 `ResourceReference.namespace` 为 `type`**：否决。Workspace 关系目标与 Security 资源语义不同；应拆出 `SecurityResource { type, id }`，保留 Workspace 的 `namespace`。

**slot 级 `required` / `readwrite` / `anyOf`**：第一版不采用。`read` 默认要求存在，`write` 不要求；`readwrite` 与多凭据替代方案等真实消费方出现再引入。

**Session 整体放权**：否决。Core 不是常驻 Host，跨命令 Session 无法成立；不引入持久 Token 或 daemon。未来常驻 Host 再单独评估。

## 后果

已交付：

- `defineComponent` 返回 `component` 与 `api`；capability id 为本地名，展示使用 `component:capability`。
- `SecurityResource { type, id }` 从 Workspace `ResourceReference` 拆出；请求不再携带 `action` / `operation`。
- 有效等级为 Root 覆盖 > `defaultAuthLevel` > `user`；`security capability list/set/reset` 可管理。`write` 能力默认 root；Root 显式降为 user 时，普通用户覆盖凭据是预期行为，Core 不额外阻止。
- 凭据用 `fields` 声明，公开字段进 SQLite，秘密字段 JSON 进 Keyring；删除 `CredentialKind`、`schema` 与 `format`。
- 绑定键为 component + capability + resource + slot；共享 slot 一次登记建立多条绑定。
- `CapabilityContext` 在授权后注入，`withCredential` / `registerCredential` 不重复 Challenge。
- CLI 新增 `pg register/list`、`remote-targets register` 与统一 `executeComponent`；收回 `credential put/bind`、`--grant-scope` 与 Session Grant。
- `@locus/config-reference` 建立，PostgreSQL/Gitea/Remote Targets 共用。

验证证据：

- `pnpm verify`：构建通过，184/184 测试通过，61 个 Markdown 检查通过。
- `pnpm e2e`：36 次真实 CLI 调用通过。
- PostgreSQL：临时 PostgreSQL 16、scram-sha-256 拒绝无密码登录，Core 交付字段后真实 `pg.Pool` 查询通过。
- SSH：真实 OpenSSH 本地 sshd、精确目标绑定、临时私钥交付与清理、错误密钥拒绝通过。
- Keyring：独立 Windows 临时账户，UTF-8/Unicode/私钥、2560/2561 边界、Missing、跨进程与清理通过。

代价与限制：

- 一条命令一次 Root 批准；未来跨多个 capability 的复合命令必须单独设计复合授权，不能拆成多次提权。
- 同一 `resource.id` 指向另一台物理实例会复用旧绑定；组件必须显式重新登记，不能静默改写。
- `fields` 让 Core 感知公开/秘密字段；若未来证明 opaque 载荷足够，应整体收敛，不能保留两套。
- Keyring 单条容量作用于合并后的秘密 JSON；大私钥或证书链超限必须失败，不分片、不回退明文。
- Root 级命令需要本地 TTY；这是有意边界，不是缺陷。
- 常驻 Host、Session 整体放权、多资源复合请求与 `readwrite` 未实现。
- 配置引用包若继续吸收迁移、展示或 Provider 逻辑，可能演变成第二套安全平台；必须保持只解析/校验。
