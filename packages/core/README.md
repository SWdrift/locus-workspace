# @locus/core

## 简述与职责

独立 TypeScript 领域内核，负责 Workspace 长期身份、成员/关联、本机目录挂载、组件机制与统一安全平面。Core 不依赖 DSH/Cordis、HTTP、CLI 或具体业务消费者；挂载只保存绝对路径与名称，不检查目录是否存在；组件定义与观察不代替主体授权。

公开面由 `src/index.ts` 导出，包括 `createLocusCore()`、组件与 Workspace 服务、安全类型、`SecurityFailure`、可注入 Store／Provider 工厂。类型跟随所属领域，不建立平行 contracts 包。Compose 的领域交付函数由各普通包（`@locus/postgres`、`@locus/gitea`、`@locus/remote-targets`）提供，Core 不依赖它们。

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

`info.version` 与 `LOCUS_VERSION` 来自构建时生成的 `src/version.generated.ts`，内容取自根 `package.json` 的 `version`，因此等于打包时的版本；仓库级规则见[版本管理](../../docs/versioning.md)。读取版本、数据目录或服务不创建数据库；首次 Workspace 操作才打开数据。释放后捕获的服务句柄也不可再调用。

## 组件

`defineComponent()` 是可信包定义的唯一入口：接收对象，返回 `{ component, api }`，不写文件、不注册全局状态。可编辑 YAML 由 `parseComponent()` 解析，只接受描述性元数据；`capabilities`/`credentials` 不进入 YAML。包在代码中定义组件；没有包的软件通过 `component add` 登记 YAML。

```ts
import { createLocusCore, defineComponent } from '@locus/core'

const demo = defineComponent({
  id: 'demo',
  version: '1',
  name: 'Demo',
  summary: '示例组件',
  kind: 'locus',
  info: { text: '示例组件。' },
})
const core = createLocusCore({ dataDirectory: '/absolute/data', components: [demo.component] })
try {
  const { components, problems } = core.components.list()
  console.log(components.map((item) => item.id), problems)
} finally {
  await core.dispose()
}
```

`createLocusCore({ components })` 接收包代码的 `component` 视图；首次访问 `core.components` 时把它们物化到 `<dataDirectory>/components/<id>.yaml`。文件已存在时不改写：版本一致直接使用，不一致标记 `needsUpgrade`，由 `upgrade()` 重写定义字段并保留 `config`。动态组件通过 `addFromText()`、`addFromPath()` 登记，只能删除动态组件。

`probe()` 支持 `argv`、`tcp` 与 `http` 三种探针；`argv` 与 `deploy()` 调用注入的 `ComponentRunner`，默认实现使用 `execa`，不经过 shell，带超时；Windows 的 `.cmd`/`.bat` 由 `execa` 解析。`list()` 返回 `{ components, problems }`，单个损坏定义不阻断其他组件；CLI 的列表投影省略 `info`，完整说明用 `show()`。读取状态不创建数据库；`show()`、`list()` 只使用最近一次观察。字段、探针类型与 A/B/C 状态由[组件子系统](../../docs/subsystems/components.md)维护。

## 安全服务

`createLocusCore({ components, security })` 同步装配；`core.security` 仅公开异步 `status()` 与 `providerStatus()`，不暴露认证、身份选择或任意秘密读取。组合根通过 `security.receiveHost` 接收可信 Host，Host 创建 Session 并把精确绑定的组件端口注入消费者；组件不能从普通 Core 句柄取得 Host。默认 Store 为惰性 SQLite，默认 Provider 为惰性 OS Keyring；空目录 status、help 与 version 不建库，Provider 状态不读取条目。

`defineComponent()` 返回 `component` 与 `api`：`component.capabilities` 声明本地 id、`resourceType`、`defaultAuthLevel` 与 `secrets`；`component.credentials` 用 `fields` 声明公开/秘密字段。声明本身不授予权限。Root 通过组件能力调用 `CapabilityContext.registerCredential(slot, reference, values)` 登记字段并建立 `component + capability + resource + slot` 绑定；同一 slot 被多个能力共用时一次登记建立多条绑定。`withCredential(slot, reference, consume)` 只使用与当前组件、能力、精确资源和 slot 一致的引用，否则 `credential-binding-mismatch`。凭据缺失、字段不匹配和 Provider 不可用分别失败，不会触发 Root 认证。

Core 与 CLI 的默认安全 Profile 都为 production；同一安装中，默认 API 消费者可以使用 CLI 管理入口录入的引用，不会意外进入另一个 default 命名空间。需要隔离时显式选择 Profile，并按 Host 的数据目录约定装配。

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

Host 的 `bindComponent(session, definition)` 要求装配时同一可信 `ComponentSpec` 对象；可编辑 YAML、同名复制对象与 external 组件不会因此取得身份。组件只使用 `execute()` 与注入的 `CapabilityContext`；Core 按可信能力声明、`resourceType`、精确资源和 Root 覆盖判定等级，声明不等于授权。普通 User 凭据使用不触发 Root。不存在 Host 注入资源声明或通用资源扩展入口。

Root 操作抛出带不透明 Challenge 的 `SecurityFailure`；只有 Host 可验证密码，并通过 `resume(grant)` 恢复 Core 捕获的原操作。`authenticate(challenge, password)` 只签发单次操作 Grant，60 秒内首次恢复后消费；没有 Session Grant 或 scope 参数。Session 结束、Root 重置、Host 关闭与 dispose 都撤销未消费 Grant。Host 的 `initializeRoot()`／`resetRoot()` 由可信 UI 编排，`forSession()` 提供凭据删除、绑定列举、状态检查、孤立条目清理、能力等级覆盖与密码变更。`cleanupCredentialOrphans(apply)` 只针对当前 Profile 推导出的精确 Keyring service，比较 Provider 账户与 `security_credentials` 元数据；默认只报告，`apply=true` 才删除孤立账户，不触碰已知凭据、元数据、绑定或其他 service。`dispose()` 即使存储清理失败也会本地撤销并释放 Store／Provider。

测试必须显式注入 `createMemoryCredentialProvider()`；元数据需要真实持久化时保留默认 SQLite，需要纯内存路径时另注入 `createMemorySecurityStore()`。自动化上下文的默认原生 Provider 在加载前拒绝实际访问；单设 LOCUS_HOME 不够。Provider 的 get/set/delete 是可信装配边界，不是组件的授权接口。完整模型、备份后果、平台证据与消费者交付见[安全子系统](../../docs/subsystems/core-security.md)。

## Workspace 与关系

创建产生 UUID，与目录、名称和会话无关。Workspace 可以没有目录；列出、按 Identity 打开、改名均不依赖外部能力。打开只是读取长期对象，不建立隐藏的“当前项目根目录”。

挂载是本机绝对路径的工作区引用，同一 Workspace 内名称与路径都唯一。名称必须以字母或数字开头，只包含字母、数字、下划线和短横线，最长 64 字符；省略名称时取目录名并安全化。Core 不检查路径当前是否存在；目录内容、权限与生命周期仍归原生系统。

长期关系分 `member` 与 `association`；目标是由领域提供方解释的 `namespace` / `id`，并保存确认来源及时间。同 Workspace、同关系种类和同目标重复确认保留首次关系与来源；成员和关联可以并存。解除一处关系不删除目标、其他 Workspace 的归属或外部资源。`workspaces.remove()` 删除 Workspace 及其挂载、自有关系，以及其他 Workspace 指向该 Workspace 的 `locus.workspace` 关系，不删除外部目录。

`locus.workspace` 引用可表达 Workspace 间的嵌套或关联，目标必须存在；不递归展开，不传播成员、权限或删除。其他命名空间保持不透明，不检查外部对象当前是否存在。

## 持久化与恢复

Core 唯一拥有 `dataDirectory/core.sqlite`，格式版本为 SQLite `user_version=6`，包含 Workspace、关系、挂载、组件状态，以及安装、Root 验证、Profile、凭据公开字段、能力等级覆盖和组件／能力／资源／slot 绑定。资源秘密不进入数据库；Root 派生验证材料仍敏感。数据库使用 DELETE journal、FULL synchronous、外键与事务；写入成功返回前提交，读用例采用一致快照。多个连接重新读取已提交数据，不用进程内旧对象覆盖；写锁等待 1000ms 后明确失败，调用者不能把失败当成确认成功。

建库 DDL 按主题分片在 `src/schema/*.ts`（Workspace、组件、安全）并以字符串常量导出；只在初始化新空库时执行，已有库不读 DDL。

未知版本、已有表结构但无版本或损坏库明确失败，不覆盖为空库。0 字节库视为初始化中断留下的空库，可安全建立当前结构；已有任何表结构则拒绝接管。开发阶段不维护旧 schema 逐版本迁移：版本与当前 `user_version=6` 不一致时要求备份后重建数据目录，版本与表结构冲突时拒绝，已有数据保留。仍应升级前备份，没有自动备份实现。清除实验数据只能由用户在备份后、停止所有写者时移走选定数据目录，不自动清理或删除用户成果。

备份需停止全部 Locus 写者后复制**整个数据目录**。将副本放到干净目录并通过 `dataDirectory` 或 `LOCUS_HOME` 打开即可保持身份和关系。副本含 Root 离线验证材料与安装 UUID，但不包含原生文件、仓库或 OS Keyring 秘密；恢复 CredentialRef 不等于恢复秘密。跨设备同步与自动合并不受支持。

## 验证与入口

`pnpm test` 覆盖 Workspace／组件、当前 schema、安全身份／授权、Root 等级覆盖、字段公开／秘密拆分、按 slot 绑定、单次 Grant、跨进程认证限制、世代重置、秘密错误隔离与释放。CLI 子进程与安全测试在 apps/cli/test，平台验证范围归[安全矩阵](../../docs/subsystems/core-security.md#平台证据与安全边界)；验证入口见[测试系统](../../docs/testing.md#分层与入口)。
