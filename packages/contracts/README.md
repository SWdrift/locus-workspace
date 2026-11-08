# @locus/contracts

## 简述与职责

Core、领域 Plugin、Host 与应用之间实际使用的 TypeScript 类型与必要协议常量，不含运行逻辑、版本值或 DSH/Cordis 依赖。没有通用资源协议、Plugin SDK 或运行时注册器；契约只随真实生产者和消费者演进。

## 使用

通过 workspace 依赖与 `import type` 引用，构建后从 `lib/` 提供声明与空 ESM 入口。调用方不用运行时导入本包；类型本身不执行输入校验。

```ts
import type { LocusService } from '@locus/contracts'

function workspaceNames(locus: LocusService): readonly string[] {
  return locus.workspaces.list().map((workspace) => workspace.name)
}
```

## 契约边界

| 交互 | 生产者与消费者 | 语义所有者 |
| --- | --- | --- |
| `LocusService` / Workspace 用例 | Core → host 的 `locus` → Plugin、CLI | [Core](../core/README.md) |
| Filesystem 位置与观察 | Filesystem → CLI、Git | [Filesystem](../../plugins/filesystem/README.md) |
| Git 只读观察 | Git → CLI | [Git](../../plugins/git/README.md) |
| Session 发现、引用与原生入口 | Session → CLI | [Session](../../plugins/session/README.md) |
| Remote Machine 资料、地址与观察 | Remote Machine → CLI | [Remote Machine](../../plugins/remote-machine/README.md) |

具体字段与方法由[源码](src/index.ts)维护，不在 README 重抄类型清单。Core 的领域引用对其自身是不透明的；Plugin 返回当前观察，应用显式确认后才调用长期关系用例。提供方声明、保存的选择、加载与可用性不是同一事实，Tag 不能解释为依赖或授权。

## 修改与验证

修改契约必须同步实际实现与所有消费者，不预留无调用方的接口。当前契约属于项目内实验 API，不承诺独立 SDK 兼容；持久数据的版本与恢复要求不能因此省略。

执行 `pnpm build` 检查所有生产者和消费者；真实行为通过 `pnpm test:all` 与 `pnpm verify:full` 验证，不能用类型通过代替运行证据。验证入口见[开发与验证](../../docs/development.md#修改与验证)。
