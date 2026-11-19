# @locus/core


## 简述与职责


独立 TypeScript 领域内核，负责 Workspace 长期身份、成员/关联、本机目录挂载、组件机制与统一安全平面。Core 不依赖 DSH/Cordis、HTTP、CLI 或具体业务消费者；挂载只保存绝对路径与名称，不检查目录是否存在；组件定义与观察不代替主体授权。


`@locus/core` 根入口只导出运行时创建 API、Core 句柄类型与产品版本。协议、组件、安全、Workspace、事件、存储与 i18n 分别通过 `/invocation`、`/components`、`/security`、`/workspaces`、`/events`、`/storage`、`/i18n` 公开子路径消费；入口显式导出，包内直接依赖实现文件。类型跟随所属领域，不建立平行 contracts 包。Compose 的 domain operation 由各普通包（`@locus/postgres`、`@locus/gitea`、`@locus/remote-targets`）提供，Core 不依赖它们。


## 源码导航


| 修改意图 | 实现入口 | 行为验证 |
| --- | --- | --- |
| 装配与数据目录 | [create-core.ts](src/create-core.ts)、[data-directory.ts](src/data-directory.ts) | [Core](test/core.test.mjs) |
| URI、路由与执行信封 | [invocation](src/invocation/index.ts) | [调用协议](test/invocation.test.mjs) |
| Workspace、挂载与关系 | [领域服务](src/workspaces/service.ts)、[operation](src/workspaces/operations.ts)、[SQLite](src/workspaces/sqlite-store.ts) | [Core](test/core.test.mjs) |
| 组件声明与校验 | [definition](src/components/definition.ts)、[validation](src/components/validation.ts) | [组件](test/components.test.mjs) |
| 组件生命周期 | [service](src/components/service.ts)、[operation](src/components/operations.ts)、[runner](src/components/runner.ts) | [组件](test/components.test.mjs)、[执行器](test/runner.test.mjs) |
| 身份、授权与凭据 | [协调运行时](src/security/runtime.ts)、[授权](src/security/authorization.ts)、[凭据用例](src/security/credentials.ts)、[Root 认证](src/security/root-auth.ts) | [安全](test/security.test.mjs) |
| Store 与 Provider | [SQLite Store](src/security/stores/sqlite.ts)、[Keyring Provider](src/security/providers/keyring.ts) | [持久化](test/security-persistence.test.mjs)、[Keyring 隔离](test/keyring-isolation.test.mjs) |
| 事件与数据库结构 | [事件总线](src/events/bus.ts)、[事件存储](src/events/sqlite-store.ts)、[数据库](src/storage/database.ts) | [调用协议](test/invocation.test.mjs)、[持久化](test/security-persistence.test.mjs) |
| 按包文案目录与注册 | [i18n](src/i18n/index.ts)、[Core 表](src/i18n/core.ts) | [跨包注册器](../../tests/i18n.test.mjs) |


Core 自有 operation 由[组合表](src/operations.ts)汇总；路由和处理函数仍在所属领域维护。`index.ts` 只作为公开入口，不承担领域实现。


## 使用


Node.js 24 或更高、ESM；依赖 `yaml` 读写组件定义、`execa` 执行原有组件探针与部署，懒加载 `@napi-rs/keyring` 保管凭据。构建后使用 `createLocusCore({ dataDirectory, components, security })`。`dataDirectory` 为绝对路径并完整决定数据目录；省略时由 `LOCUS_HOME` 与 `LOCUS_FOLDER_NAME` 决定：`LOCUS_HOME` 是基目录（相对值按进程 CWD 解析），`LOCUS_FOLDER_NAME` 是其下文件夹；未设置 `LOCUS_HOME` 时基目录为用户主目录，`LOCUS_FOLDER_NAME` 缺省为 `.locus-workspace/`。默认目录与 CWD 分离，只有显式使用相对 `LOCUS_HOME` 才依赖 CWD；不要让多个设备把同一地址自动视为同一外部资源。


```ts
import { createLocusCore } from '@locus/core'


const core = createLocusCore()
try {
  const workspace = core.workspaces.create('研究')
  const mount = core.mounts.add(workspace.id, '/absolute/project', { name: 'project' })
  console.log(core.workspaces.get(workspace.id).mounts, mount)
} finally {
  await core.dispose()
}
```


未显式传入 `dataDirectory` 时，`security.profile: 'development'` 在生产解析目录下追加 `profiles/development/`；显式绝对路径完整决定位置，不追加 Profile 子目录。这一规则由 Core 统一实现，CLI 不另行计算。


`info.version` 与 `LOCUS_VERSION` 来自构建时生成的 `src/version.generated.ts`，内容取自根 `package.json` 的 `version`，因此等于打包时的版本；仓库级规则见[版本管理](../../docs/versioning.md)。读取版本、数据目录或服务不创建数据库；首次 Workspace 操作才打开数据。释放后捕获的服务句柄也不可再调用，包括事件总线与事件存储。


## 统一调用


[Invocation](src/invocation/index.ts) 提供 URI 解析、`ApiRouter`、`defineOperation()`、`defineCredential()`、Dispatcher 与结果信封；[Events](src/events/index.ts) 提供事件总线。`createLocusCore()` 把各领域自有的 `locus://` operation 与组合根注入的组件 operation 一起装配，`locus://operations` 返回当前运行期的路由、summary 与公开字段描述；CLI 帮助直接投影同一声明。URI 规则、operation 契约、授权、凭证与错误码的完整协议见[统一资源调用](../../docs/subsystems/invocation.md)，本 README 只记录模块用法。



```ts
import { defineOperation } from '@locus/core/invocation'


const ping = defineOperation({
  id: 'demo.ping.get',
  method: 'GET',
  scheme: 'demo',
  authority: 'ping',
  path: '',
  auth: 'user',
  input: { parse: () => undefined },
  output: { parse: (value) => value as { ok: boolean } },
  run: () => ({ ok: true }),
})
```


构建后执行 `pnpm test:file packages/core/test/invocation.test.mjs` 检查 URI 规范化、路由冲突、方法判定与类型契约。


## 文案目录


`@locus/core/i18n` 导出 `defineI18n(namespace, resources)` 与 `createI18nRegistry(catalogs)`，以及 Core 自己的 `i18n`。每个包在自己的 `src/i18n.ts` 定义一张表，包内用 `i18n.t('literal.key', params)` 取值；占位符是 `{{name}}`，key 与参数由表推导并在编译期校验。注册器只校验 namespace 唯一、key 合法与模板完整，不提供翻译入口，也不持有其他包文案。CLI 组合根从已加载模块聚合注册器，新增组件不需要修改 Core。


取舍与被否决方案见[按包 i18n 文案目录](../../.agents/notes/implemented/architecture/2026-11-19-i18n-catalogs.md)。


## 组件


`defineComponent()` 是可信包定义的唯一入口：接收对象，返回 `{ component, operations }`，不写文件、不注册全局状态。可编辑 YAML 由 `parseComponent()` 解析，只接受描述性元数据；`operations`/`credentials` 不进入 YAML。包在代码中定义组件；没有包的软件通过 POST locus://components 登记 YAML。



```ts
import { createLocusCore } from '@locus/core'
import { defineComponent } from '@locus/core/components'


const demo = defineComponent({
  id: 'demo',
  version: '1',
  name: 'Demo',
  summary: '示例组件',
  kind: 'locus',
  info: { text: '示例组件。' },
})
const core = createLocusCore({ dataDirectory: '/absolute/data', components: [demo] })
try {
  const { components, problems } = core.components.list()
  console.log(components.map((item) => item.id), problems)
} finally {
  await core.dispose()
}
```


`createLocusCore({ components })` 接收包代码的 `{ component, operations }` 视图；首次访问 `core.components` 时把 `component` 物化到 `<dataDirectory>/components/<id>.yaml`。文件已存在时不改写：版本一致直接使用，不一致标记 `needsUpgrade`，由 `upgrade()` 重写定义字段并保留 `config`。动态组件通过 `addFromText()`、`addFromPath()` 登记，只能删除动态组件。


`probe()` 支持 `argv`、`tcp` 与 `http` 三种探针；`argv` 与 `deploy()` 调用注入的 `ComponentRunner`，默认实现使用 `execa`，不经过 shell，带超时；Windows 的 `.cmd`/`.bat` 由 `execa` 解析。`list()` 返回 `{ components, problems }`，单个损坏定义不阻断其他组件；CLI 的列表投影省略 `info`，完整说明用 `show()`。读取状态不创建数据库；`show()`、`list()` 只使用最近一次观察。字段、探针类型与 A/B/C 状态由[组件子系统](../../docs/subsystems/core/components.md)维护。


## 安全服务


`createLocusCore({ components, security })` 同步装配；`core.security` 仅公开异步 `status()` 与 `providerStatus()`，不暴露认证、身份选择或任意秘密读取。组合根通过 `security.receiveHost` 接收可信 Host，Host 创建 Session；Dispatcher 把 `OperationContext.credential` 交给 operation handler。组件不能从普通 Core 句柄取得 Host。默认 Store 为惰性 SQLite，默认 Provider 为惰性 OS Keyring；空目录 status、help 与 version 不建库，Provider 状态不读取条目。


`defineComponent()` 返回 `component` 与 `operations`：`component` 是可序列化元数据，`operations` 声明 operation id、路由、`auth`、query/input/output 与 handler；`component.credentials` 用 `fields` 声明公开/秘密字段。声明本身不授予权限。Root 通过 operation handler 调用 `context.credential.write(credential, resourceKey, values)` 写入字段并建立 `component + slot + resourceKey` 绑定；`context.credential.read(credential, resourceKey, consume)` 按当前组件、slot 与 key 查找绑定，在回调前读取 Provider 秘密并合并公开字段。绑定缺失、字段不匹配和 Provider 不可用分别失败，不会触发 Root 认证；写入只在实际获准 Root 时可用。`CredentialMetadata` 持久化 `owner` 组件 id；第一版一个引用只对应一个 owner。其他组件已绑定的引用不能被覆盖，也不提供跨组件共享的 Root bind 入口。


Core 与 CLI 的默认安全 Profile 都为 production；同一安装中，默认 API 消费者可以使用 CLI 管理入口录入的引用，不会意外进入另一个 default 命名空间。需要隔离时显式选择 Profile，并按 Host 的数据目录约定装配。


```ts
interface OperationContext {
  credential: {
    read<T>(
      credential: CredentialDefinition,
      resourceKey: string,
      consume: (values: CredentialValues) => T | Promise<T>,
    ): Promise<T>


    write(
      credential: CredentialDefinition,
      resourceKey: string,
      values: CredentialValues,
    ): Promise<CredentialRef>
  }
}
```


Host 的 `bindComponent(session, componentId)` 只接受装配时注册的 `kind: locus` 组件 id；可编辑 YAML、同名复制对象与 external 组件不会因此取得身份。组件只使用注入的 `OperationContext.credential` 与 `emit()`；Core 按可信 operation 声明与 Root 覆盖判定等级，声明不等于授权。普通 User 凭据使用不触发 Root。不存在 Host 注入资源声明或通用资源扩展入口。


Root 级 operation 抛出带不透明 Challenge 的 `SecurityFailure`；只有 Host 可验证密码，并通过 `resume(grant)` 恢复 Core 捕获的原 operation 与参数。`authenticate(challenge, password, scope)` 支持 `operation` 与 `session`：operation 默认 60 秒内首次恢复后消费；session 绑定真实进程内 Session，同一 operation 与精确参数可复用，Session 结束、Root 重置、Host 关闭与 dispose 都撤销，不跨进程。Host 的 `initializeRoot()`／`resetRoot()` 由可信 UI 编排，`forSession()` 提供凭据删除、绑定列举、状态检查、孤立条目清理、operation 等级覆盖与密码变更。`cleanupCredentialOrphans(apply)` 只针对当前 Profile 推导出的精确 Keyring service，比较 Provider 账户与 `security_credentials` 元数据；默认只报告，`apply=true` 才删除孤立账户，不触碰已知凭据、元数据、绑定或其他 service。`dispose()` 即使存储清理失败也会本地撤销并释放 Store／Provider。


测试必须显式注入 `createMemoryCredentialProvider()`；元数据需要真实持久化时保留默认 SQLite，需要纯内存路径时另注入 `createMemorySecurityStore()`。自动化上下文的默认原生 Provider 在加载前拒绝实际访问；单设 LOCUS_HOME 不够。Provider 的 get/set/delete 是可信装配边界，不是组件的授权接口。完整模型、备份后果、平台证据与消费者交付见[安全子系统](../../docs/subsystems/core/security.md)。


## Workspace 与关系


创建产生 UUID，与目录、名称和会话无关。Workspace 名称唯一（trim 后精确匹配），可选 `description`；列出、按 Identity 打开、更新名称或描述均不依赖外部能力。打开只是读取长期对象，不建立隐藏的“当前项目根目录”。


挂载是本机绝对路径的工作区引用，同一 Workspace 内名称与路径都唯一。名称必须以字母或数字开头，只包含字母、数字、下划线和短横线，最长 64 字符；省略名称时取目录名并安全化。每个 Workspace 最多一个 `primary` 挂载，作为 shell 默认 cwd；缺失时回退到第一个可访问挂载。Core 不检查路径当前是否存在；目录内容、权限与生命周期仍归原生系统。


长期关系分 `member` 与 `association`；目标是由领域提供方解释的 `namespace` / `id`，并保存确认来源及时间。同 Workspace、同关系种类和同目标重复确认保留首次关系与来源；成员和关联可以并存。解除一处关系不删除目标、其他 Workspace 的归属或外部资源。`workspaces.remove()` 删除 Workspace 及其挂载、自有关系，以及其他 Workspace 指向该 Workspace 的 `locus.workspace` 关系，不删除外部目录。


`locus.workspace` 引用可表达 Workspace 间的嵌套或关联，目标必须存在；不递归展开，不传播成员、权限或删除。其他命名空间保持不透明，不检查外部对象当前是否存在。


直接服务以 `WorkspaceFailure.code` 区分 `invalid-argument`、`not-found`、`conflict` 与 `disposed`；数据库故障不归为输入错误。operation 不根据错误文案猜测分类。


## 持久化与恢复


Core 唯一拥有 `dataDirectory/core.sqlite`，格式版本为 SQLite `user_version=9`，包含 Workspace 名称/描述/挂载 primary、关系、组件状态，以及安装、Root 验证、Profile、凭据公开字段与 owner、operation 等级覆盖、`component + slot + resourceKey` 绑定与事件记录。资源秘密不进入数据库；Root 派生验证材料仍敏感。数据库使用 DELETE journal、FULL synchronous、外键与事务；写入成功返回前提交，读用例采用一致快照。多个连接重新读取已提交数据，不用进程内旧对象覆盖；写锁等待 1000ms 后明确失败，调用者不能把失败当成确认成功。


建库 DDL 按主题分片在 `src/storage/schema/`（Workspace、组件、安全、事件）并以字符串常量导出；只在初始化新空库时执行，已有库不读 DDL。


未知版本、已有表结构但无版本或损坏库明确失败，不覆盖为空库。0 字节库视为初始化中断留下的空库，可安全建立当前结构；已有任何表结构则拒绝接管。结构变更保留当前版本的一份一跳迁移，更早脚本可删除，脚本与升级步骤由[开发与验证](../../docs/development.md#数据迁移)维护；版本与当前 `user_version=9` 不一致时 Core 明确拒绝，不自动迁移，版本与表结构冲突时拒绝，已有数据保留。升级前仍需备份，没有自动备份实现。清除实验数据只能由用户在备份后、停止所有写者时移走选定数据目录，不自动清理或删除用户成果。


备份需停止全部 Locus 写者后复制**整个数据目录**。将副本放到干净目录并通过 `dataDirectory` 或 `LOCUS_HOME` 打开即可保持身份和关系。副本含 Root 离线验证材料与安装 UUID，但不包含原生文件、仓库或 OS Keyring 秘密；恢复凭据引用不等于恢复秘密。跨设备同步与自动合并不受支持。


## 验证与入口


`pnpm test` 覆盖 Workspace／组件、URI 与路由、当前 schema、安全身份／授权、Root operation 等级覆盖、字段公开／秘密拆分、`component + slot + resourceKey` 绑定、单次 Grant、跨进程认证限制、世代重置、事件持久化、秘密错误隔离与释放。CLI 子进程与安全测试在 apps/cli/test，平台验证范围归[安全矩阵](../../docs/subsystems/core/security.md#平台证据与安全边界)；验证入口见[测试系统](../../docs/testing.md#分层与入口)。
