# @locus/core

## 简述与职责

独立 TypeScript 领域内核，负责 Workspace 长期身份、成员/关联与本机目录挂载。Core 不依赖 DSH/Cordis、HTTP 或 CLI；挂载只保存绝对路径与名称，不检查目录是否存在，也不解释外部领域结构。

公开面由 `src/index.ts` 导出：`createLocusCore()`、`LOCUS_VERSION`，以及 `LocusCore`、`LocusInfo`、`Workspace`、`WorkspaceRelation`、`Mount`、`ResourceReference`、`RelationSource`、`WorkspaceService` 与 `MountService`。类型定义在 `src/types.ts`，等出现第二个真实消费端时再抽取同构契约包。

## 使用

Node.js 24 或更高、ESM；构建后使用 `createLocusCore({ dataDirectory })`。`dataDirectory` 为绝对路径，可省略并采用绝对 `LOCUS_HOME`，否则使用用户主目录下 `.locus-workspace/`。目录与进程 CWD 分离；不要让多个设备把同一地址自动视为同一外部资源。

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

`info.version` 从唯一版本常量 `LOCUS_VERSION` 读取，当前为 `0.0.0`。读取版本、数据目录或服务不创建数据库；首次 Workspace 操作才打开数据。释放后捕获的服务句柄也不可再调用。

## Workspace 与关系

创建产生 UUID，与目录、名称和会话无关。Workspace 可以没有目录；列出、按 Identity 打开、改名均不依赖外部能力。打开只是读取长期对象，不建立隐藏的“当前项目根目录”。

挂载是本机绝对路径的工作区引用，同一 Workspace 内名称与路径都唯一。名称必须以字母或数字开头，只包含字母、数字、下划线和短横线，最长 64 字符；省略名称时取目录名并安全化。Core 不检查路径当前是否存在；目录内容、权限与生命周期仍归原生系统。

长期关系分 `member` 与 `association`；目标是由领域提供方解释的 `namespace` / `id`，并保存确认来源及时间。同 Workspace、同关系种类和同目标重复确认保留首次关系与来源；成员和关联可以并存。解除一处关系不删除目标、其他 Workspace 的归属或外部资源。`workspaces.remove()` 删除 Workspace 及其挂载、自有关系，以及其他 Workspace 指向该 Workspace 的 `locus.workspace` 关系，不删除外部目录。

`locus.workspace` 引用可表达 Workspace 间的嵌套或关联，目标必须存在；不递归展开，不传播成员、权限或删除。其他命名空间保持不透明，不检查外部对象当前是否存在。

## 持久化与恢复

Core 唯一拥有 `dataDirectory/core.sqlite`，实验格式版本为 SQLite `user_version=2`。数据库使用 DELETE journal、FULL synchronous、外键与事务；写入成功返回前提交，读用例采用一致快照。多个连接重新读取已提交数据，不用进程内旧对象覆盖；写锁等待 1000ms 后明确失败，调用者不能把失败当成确认成功。

未知版本、已有表结构但无版本或损坏库明确失败，不覆盖为空库。0 字节库视为初始化中断留下的空库，可安全建立当前结构；已有任何表结构则拒绝接管。`user_version=1` 的 Workspace/关系库在打开时自动迁移到 2，新增 `mounts` 表；若版本与表结构不一致则拒绝迁移。仍应升级前备份，未来格式迁移必须显式实现。清除实验数据只能由用户在备份后、停止所有写者时移走选定数据目录，不自动清理或删除用户成果。

备份需停止全部 Locus 写者后复制**整个数据目录**。将副本放到干净目录并通过 `dataDirectory` 或 `LOCUS_HOME` 打开即可保持身份和关系。备份不包含原生文件、仓库或凭据。跨设备同步与自动合并不受支持。

## 验证与入口

`pnpm test` 覆盖身份/关系/挂载重开、共享与嵌套、幂等确认、v1 迁移、删除级联、备份恢复、锁定、未知版本/损坏和释放边界；真实 CLI 链路由 `tests/cli.test.mjs` 以独立进程验证。验证入口见[测试系统](../../docs/testing.md#分层与入口)，命令见 [CLI](../../apps/cli/README.md)。
