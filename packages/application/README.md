# @locus/application

## 简述与职责

CLI 与本地 UI 共用的 Workspace/Filesystem 用例层。只组合 `LocusService` 与 `FilesystemService` 的公开方法，不拥有持久化、不实现领域 I/O，也不依赖 DSH/Cordis。

## 使用

```ts
import { createWorkspaceApplication } from '@locus/application'

const app = createWorkspaceApplication({ locus, filesystem })
const workspace = app.createWorkspace('研究')
const location = app.registerLocation(workspace.id, 'D:/Projects')
await app.createFile(workspace.id, location.id, 'notes.md')
```

`filesystem` 可省略：Workspace 用例仍可用，调用 Filesystem 用例时明确失败。新建、重命名与读取、发现共用同一 `FilesystemService`；`renameEntry` 只是用例命名，避免与 Workspace 改名混淆。`confirmResource` 先执行一次真实观察，再把可访问引用交给 Core；发现、读取和写入都不会自动成为长期关系。

## 边界

- 不缓存服务实例；调用方每次请求或命令重新创建应用对象，以便宿主热重载后使用新实例。
- 不定义第二套 Workspace 或 Filesystem 语义，类型与行为由 [contracts](../contracts/README.md) 和所属领域维护。
- 不提供 CLI 语法、HTTP 路由或 UI 展示；这些属于各交互面的投影。
