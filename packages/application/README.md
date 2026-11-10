# @locus/application

## 简述与职责

进程内 Application Composition。当前只有一个明确用例：`buildWorkspaceOverview(services, workspaceId, options)`，组合 Workspace、Filesystem、Git、Session、Remote Machine、Connectivity 与 Gitea 的公开服务，返回结构化 Overview。

它不依赖 CLI、Commander、UI 框架或宿主外壳，不执行原生 I/O，不保存派生事实，也不自动确认候选关系。CLI 与 UI 消费同一结果，各自负责展示。

## 边界

- 只调用领域公开服务；不读取领域数据库，不复制领域实现。
- 默认只读取 Core 长期关系与领域已保存配置；`observe: true` 才执行有界只读观察。
- 保留 Confirmed、Observed、Suggested 与 Unknown/Unavailable 的区分；不压成统一成功/失败状态。
- 单一来源失败不抹除其他来源结果。
- `actions` 与 `next` 当前保留 CLI 命令提示字符串，用于兼容既有 `--json` 与 CLI 输出；UI 不应把它们当作数据来源或执行入口。
- 不引入通用 Entity、Query、Workflow 或查询引擎；新增用例需有真实第二个消费者。

## 使用

```ts
import { buildWorkspaceOverview } from '@locus/application'

const overview = await buildWorkspaceOverview({ locus, filesystem, git }, workspaceId, { observe: false })
```

类型与字段由[源码](src/workspace-overview.ts)维护，阅读顺序与状态语义见[领域生成与应用投影](../../docs/domain-generation.md)和 [Workspace Overview 决定](../../.agents/notes/implemented/feature/2026-11-09-workspace-overview.md)。
