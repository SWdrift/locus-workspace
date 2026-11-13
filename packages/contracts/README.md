# @locus/contracts

## 简述与职责

Core、领域 Plugin、Host 与 CLI 之间实际使用的 TypeScript 类型与必要协议常量，不含运行逻辑、版本值或 DSH/Cordis 依赖。没有通用资源协议、Plugin SDK 或运行时注册器；契约只随真实生产者和消费者演进。

## 使用

通过 workspace 依赖引用，构建后从 `lib/` 提供声明与 ESM 入口。类型本身不执行输入校验；只有引用命名空间等必要常量以运行时值提供。

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
| Filesystem 位置、观察与文件操作 | Filesystem → CLI、UI | [Filesystem](../../plugins/filesystem/README.md) |
| `LocusUiLauncher` | UI Plugin → CLI | [UI](../../packages/ui/README.md) |

具体字段与方法由[源码](src/index.ts)维护，不在 README 重抄类型清单。Core 的领域引用对其自身是不透明的；Plugin 返回当前观察，应用显式确认后才调用长期关系用例。

Filesystem 的引用命名空间前缀由本包导出，应用层组合不应复制字符串或自行解析领域引用。后续领域只在出现真实生产者与消费者后再加入契约，不预建空类型或占位服务。

## 修改与验证

修改契约必须同步实际实现与所有消费者，不预留无调用方的接口。当前契约属于项目内实验 API，不承诺独立 SDK 兼容；持久数据的版本与恢复要求不能因此省略。

执行 `pnpm build` 检查所有生产者和消费者；真实行为通过 `pnpm test:all` 与 `pnpm verify:full` 验证，不能用类型通过代替运行证据。验证入口见[测试系统](../../docs/testing.md#分层与入口)。
