# @locus/core

## 简述与职责

独立 TypeScript 领域内核，负责 Workspace 长期身份、成员/关联和能力选择。Core 不依赖 DSH/Cordis，不解析文件路径、Git 或其他领域内部结构；原生系统的事实与资源生命周期不归 Core 所有。

## 使用

Node.js 24 或更高、ESM；构建后使用 `createLocusCore({ dataDirectory })`。`dataDirectory` 为绝对路径，可省略并采用绝对 `LOCUS_HOME`，否则使用用户主目录下 `.locus-workspace/`。目录与进程 CWD、DSH Session 和 profile 分离；不要让多个设备把同一地址自动视为同一原生资源。

```ts
import { createLocusCore } from '@locus/core'

const core = createLocusCore()
try {
  const workspace = core.workspaces.create('研究')
  console.log(core.workspaces.get(workspace.id))
} finally {
  await core.dispose()
}
```

`info.version` 仍从唯一版本常量 `LOCUS_VERSION` 读取，当前为 `0.0.0`。只读版本、获取服务或创建句柄不创建数据库；首次 Workspace 操作才打开数据。释放后捕获的服务句柄也不可再调用。

## Workspace 与关系

创建产生 UUID，与目录、名称和会话无关。Workspace 可以没有目录；列出、按 Identity 打开、改名均不依赖 Filesystem 或 Git。打开只是读取长期对象，不建立隐藏的“当前项目根目录”。

长期关系分 `member` 与 `association`；目标是由领域提供方解释的 `namespace` / `id`，并保存确认来源及时间。同 Workspace、同关系种类和同目标重复确认保留首次关系与来源；成员和关联可以并存。解除一处关系不删除目标、其他 Workspace 的归属或外部文件。

`locus.workspace` 引用可表达 Workspace 间的嵌套或关联，目标必须存在；不递归展开，不传播能力、成员、权限或删除。其他命名空间保持不透明，不检查外部对象当前是否存在。

能力选择保存语义标识、提供方及其分类 Tag 的声明快照，不保存 Plugin 的领域参数。快照不证明提供方已加载、原生依赖可用或操作已授权；取消选择不删除成员及领域 Plugin 的配置。Core 没有能力注册器、依赖求解器或运行时。

## 持久化与恢复

Core 唯一拥有 `dataDirectory/core.sqlite`，实验格式版本为 SQLite `user_version=1`。数据库使用 DELETE journal、FULL synchronous、外键与事务；写入成功返回前提交，读用例采用一致快照。多个连接重新读取已提交数据，不用进程内旧对象覆盖；写锁等待 1000ms 后明确失败，调用者不能把失败当成确认成功。

未知版本、已有表结构但无版本或损坏库明确失败，不覆盖为空库。0 字节库视为初始化中断留下的空库，可安全建立当前结构；已有任何表结构则拒绝接管。本版本没有旧业务数据格式的自动迁移；升级前先备份，未来格式迁移必须显式实现。清除实验数据只能由用户在备份后、停止所有写者时移走选定数据目录，不自动清理或删除用户成果。

备份需停止全部 Locus 写者后复制**整个数据目录**，包括 Plugin 自有配置文件；复制单独 Core 库不能恢复全部能力配置。将副本放到干净目录并通过 `dataDirectory` 或 `LOCUS_HOME` 打开即可保持身份和关系。备份不包含原生文件、仓库或凭据；目录失联、Plugin 未加载仍保留长期引用。跨设备同步、在线多文件快照和自动合并不受支持。

## 验证与入口

`pnpm test:all` 覆盖身份/关系重开、共享与嵌套、幂等确认、备份恢复、锁定、未知版本/损坏和释放边界；实际 DSH 链路运行 `pnpm verify:full`。验证入口见[开发与验证](../../docs/development.md#修改与验证)。公共类型见 [contracts](../contracts/README.md)，宿主装配见 [host-dsh](../host-dsh/README.md)。
