# CP Template + Workspace

## Control Plane Role

本平面控制两块相互独立的能力：`components/templates` 的模板库与纯复制，以及 `packages/core` Workspace 的身份、名称、描述与挂载；`apps/cli` 只提供 URL 形式的调用与 shell。模板负责把一套文件复制成项目目录，Workspace 负责长期语境与挂载；二者没有 API 关联，唯一联系是用户把模板生成目录 `mount` 进某个 ws。

模板库、纯复制、Workspace v9、名称唯一、`description` 与 `primary` 已落地，并通过 `pnpm verify`、迁移实跑与 e2e。

旧平面 [`cp-2026-11-14-templates.md`](./cp-2026-11-14-templates.md) 与 [`cp-2026-11-14-workspace-core.md`](./cp-2026-11-14-workspace-core.md) 中与本平面重叠的模板/Workspace 部分以本平面为准；其余内容仍按各自范围有效。

Gitea 流水线、远程机器关联、仓库绑定与部署不在本平面；`packages/gitea`、`packages/postgres` 保持现状，不顺手修改。

## Meta Reference

- [cp-meta.md](./cp-meta.md)：控制平面结构、命名与更新规则。
- [项目架构](../docs/architecture.md)：组件职责、依赖方向与扩展边界。
- [Core](../packages/core/README.md)：装配、Workspace、挂载、持久化与迁移。
- [项目模板子系统](../docs/subsystems/templates.md)：模板范围、复制流程、不变量与失败边界。
- [Templates](../components/templates/README.md)：模板源、API 与失败码。
- [CLI](../apps/cli/README.md) 与[统一资源调用](../docs/subsystems/invocation.md)：URL 调用、帮助投影与退出码。
- [实用命令](../docs/commands.md#模板操作)：当前命令语法。
- [Locus Skill](../.agents/skills/locus/SKILL.md)：Agent 入口与参考页。
- 扩展/收尾使用 `create-control-plane` / `compact-control-plane`。

## Scope

- `components/templates/src`：模板库解析、元信息、复制、digest 与 operation。
- `components/templates/templates/`：内置模板源；目标是多套静态骨架。
- `components/templates/test`：模板库 CRUD、元信息、复制、排除与失败。
- `packages/core/src/workspaces`、`packages/core/src/storage/schema/workspace.ts`、`packages/core/src/storage/database.ts`：Workspace 名称唯一、`description`、`primary` 与 schema v9 迁移。
- `packages/core/test`：Workspace/挂载行为、唯一性、primary 与迁移。
- `apps/cli`：URL 调用与 `locus shell` 的选择逻辑；不新增领域别名树。
- `docs/subsystems/templates.md`、`components/templates/README.md`、`packages/core/README.md`、`docs/commands.md`、`.agents/skills/locus/reference/templates.md` 与 workspace 参考。
- 不包含：Gitea/CI、远程目标关联、仓库绑定、项目实体、模板变量渲染、hook、`git init`、模板升级/三方合并、Web。

## Core Rules

### 边界

- 模板与 ws 解耦：不提供 `ws init`，ws 不读模板元信息，目标项目不写 `.template.json`；用户自行先建目录再挂载。
- 模板只复制字节：不渲染、不执行 hook、不 `git init`、不访问网络。
- CLI 以 URL 为主：裸 URL 默认 GET；写操作必须显式 `post/put/patch/delete`；多 URL 只允许 GET；不新增领域别名树。特殊入口仍只有 `version`、`init`、`security reset-root`、`shell`。

### 模板库

- 用户模板位于 `<dataDirectory>/templates/<id>/`，可直接编辑文件与 `.template.json`；服务不缓存，每次读取以磁盘为准。
- 内置模板只作兜底；用户模板优先，同名遮蔽内置。
- `.template.json` 是模板元信息，只存在于模板库，不复制到目标。`id` 不可通过元信息更新改变；`name` / `version` / `description` 可改。
- operation 仅：`GET template://templates`、`GET template://templates/<id>`、`POST template://templates`、`PATCH template://templates/<id>`、`DELETE template://templates/<id>`、`POST template://templates/<id>/instances`；不提供 `PUT`。
- `POST` 把 source 复制进模板库；已有用户模板同 id 冲突；同名内置允许创建用户副本并遮蔽。
- `PATCH` 只写 `.template.json`；纯内置模板先 `POST` 副本再改。
- `DELETE` 只删用户模板；删除遮蔽副本后内置重新可见。
- 实例化仍是纯复制：目标绝对路径且不存在、父目录存在；排除 `.git/`、`node_modules/`、`.DS_Store`、`Thumbs.db`、`.template.json`；符号链接与特殊文件失败；临时目录 rename，失败清理。
- 详情中的 digest、文件数、目录数按当前内容计算；实例化结果中的 digest 只返回、不落盘。

### Workspace

- URL 根为 `locus://ws`；不使用 `locus://workspaces`。
- 名称唯一：存 `name` + `name_key`（`trim()` 后精确匹配），`UNIQUE(name_key)`；1–64 字符，不允许控制字符；冲突返回 `conflict`。
- `description` 可选，最长 500；`PATCH` 空字符串清空。
- 挂载名称与路径在同一 ws 内唯一；挂载只保存绝对路径与名称，不校验目录存在。
- `primary` 每个 ws 最多一个；SQL 列名为 `is_primary`（`primary` 是 SQLite 保留字），DTO 字段仍为 `primary`。shell 优先 primary，缺失则回退第一个可访问挂载，并在 `--print-env` 报告 `primaryMissing`；没有 primary 时沿用第一个可访问挂载。
- 删除 ws 级联删除挂载与关系，不删除外部目录。
- Core schema 升到 v9；只维护 v8→v9 一跳迁移，放在 `temp/migrations/`，不入库、不进入运行时。存在重复名称时迁移明确失败并列出冲突，不自动改名。

### 验证与文档

- 行为变更先取得真实运行证据，再更新文档；`pnpm verify` 为快速门禁，`pnpm docs:check` 检查 Markdown。
- 不把未运行的结果写成通过；e2e 冷却不加 `--force`。
- 长期取舍在实现验证后写入 Agent Notes；本平面只保留当前任务与设计约束。

## Task Board

### 模板库

- [x] 定义 `.template.json` schema、模板 id 规则与用户/内置解析顺序
- [x] 模板库扫描：列表、详情、损坏模板进入 `problems`、用户模板遮蔽内置
- [x] `POST template://templates`：校验 source、复制进模板库、同 id 用户模板冲突
- [x] `PATCH template://templates/<id>`：只更新 `name`/`version`/`description`，`id` 不可变
- [x] `DELETE template://templates/<id>`：删除用户模板，遮蔽解除
- [x] 实例化改为纯复制：移除 `.template.json` 实例记录与 `metadataPath`
- [x] 保持排除规则、符号链接/特殊文件失败、临时目录 rename 与 dry-run
- [x] 增加静态内置模板：`node-service`、`ts-lib`、`python-service`
- [x] 测试：CRUD、遮蔽、直接编辑、无 `.template.json`、dry-run、排除与失败
- [x] 更新 Templates README、模板子系统、命令手册与 Skill 模板参考

### Workspace v9

- [x] schema v9：`workspaces.description`、`workspaces.name_key` + 唯一索引、`mounts.is_primary` + 每 ws 唯一约束
- [x] `temp/migrations/core-v8-to-v9.sql` 与升级步骤；重复名称明确拒绝；实跑迁移（复制 v8 开发库 → 迁移 → 新 Core 读写；重复名称失败且回滚）
- [x] operation：`locus://ws` 创建/列表/详情/更新/删除；mounts 列表/添加/改名/设 primary/删除
- [x] 名称规范化、唯一冲突、`description` 清空与长度限制
- [x] shell：primary 选择、`primaryMissing` 回退、`--print-env` 输出
- [x] 测试：trim 后精确唯一、description、primary 设置/清除/回退、级联删除、跨进程
- [x] 更新 Core README、命令手册与 Skill workspace/shell 参考

### CLI 与证据

- [x] 确认所有新能力只通过 URL 调用；裸 URL 默认 GET；不新增领域别名
- [x] 更新 `docs/commands.md` 与 Skill 示例：模板 CRUD、ws CRUD、mount、shell
- [x] 运行 `pnpm verify`（build + lint + format + 198 项测试 + 73 个文档）与 `pnpm e2e`（42 次调用）
- [x] 实现验证后补写 Agent Note：模板库与无实例记录、Workspace v9 名称/描述/primary
- [ ] 完成本平面后精简/删除旧模板与 Workspace 平面中过时内容

## Verification

- `pnpm verify`：构建、依赖边界、格式、198 项测试与 73 个 Markdown 文档检查通过。
- `pnpm e2e`：真实 CLI 42 次调用通过，覆盖 `locus://ws`、模板纯复制、shell 与跨进程恢复。
- 迁移实跑：复制 v8 开发库，执行 `temp/migrations/core-v8-to-v9.sql`，新 Core 创建带描述 Workspace 与 primary 挂载成功；重复名称迁移失败并回滚到 v8。

## Design Snapshot

### 模板 URL

| 方法 | URL | 用途 |
|---|---|---|
| GET | `template://templates` | 列出用户模板 + 内置模板 |
| GET | `template://templates/<id>` | 元信息 + 当前内容摘要 |
| POST | `template://templates` | 从 source 注册用户模板 |
| PATCH | `template://templates/<id>` | 只改元信息 |
| DELETE | `template://templates/<id>` | 删除用户模板 |
| POST | `template://templates/<id>/instances` | 复制到目标，排除 `.template.json` |

模板元信息：

```json
{
  "schema": "locus.template/v1",
  "id": "node-service",
  "name": "Node service",
  "version": "1.0.0",
  "description": "Node 服务骨架"
}
```

`POST` 的 source 可来自路径或内置模板；`PATCH` 只写 `.template.json`。内容修改不经过 operation，直接改模板库目录。

### Workspace URL

| 方法 | URL | 用途 |
|---|---|---|
| GET | `locus://ws` | 列出工作空间 |
| POST | `locus://ws` | 创建 `{name, description?}` |
| GET | `locus://ws/<ws>` | 详情 + mounts |
| PATCH | `locus://ws/<ws>` | 改 name/description |
| DELETE | `locus://ws/<ws>` | 删除，不删外部目录 |
| GET | `locus://ws/<ws>/mounts` | 列挂载 |
| POST | `locus://ws/<ws>/mounts` | 加 `{path, name?, primary?}` |
| PATCH | `locus://ws/<ws>/mounts/<mount>` | 改名 / 设 primary |
| DELETE | `locus://ws/<ws>/mounts/<mount>` | 移除挂载 |

### 数据结构

```ts
interface Workspace {
  id: string
  name: string
  description?: string
  createdAt: string
  mounts: Mount[]
}

interface Mount {
  id: string
  workspaceId: string
  name: string
  path: string
  primary: boolean
  createdAt: string
}
```

### 用户流程（无 API 关联）

```sh
locus template://templates
locus post template://templates --data '{"id":"node-service","source":{"kind":"path","path":"X:/templates/node-service"}}'
locus post template://templates/node-service/instances --data '{"destination":"X:/Projects/demo","dryRun":true}'
locus post template://templates/node-service/instances --data '{"destination":"X:/Projects/demo"}'

locus post locus://ws --data '{"name":"demo","description":"演示项目"}'
locus post locus://ws/demo/mounts --data '{"path":"X:/Projects/demo","primary":true}'
locus shell demo
```

## Defaults and Open Points

- 内置模板默认只读兜底；用户副本通过 `POST` 或直接放入模板库遮蔽。若后续需要直接改内置，再改为首次访问复制进模板库。
- `primary` 按本平面保留；若实现前决定移除，回退规则改为“第一个可访问挂载”，其余不变。
- 名称唯一性按 `trim()` 后精确匹配；中文和大小写混合名称保留原始显示。
- `description` 上限 500，空字符串清空；实现前可调整上限。
- 模板 id 采用组件 id 风格：小写字母开头，只含小写字母、数字与短横线，最长 64。path source 的 `.template.json.id` 必须缺省或与目标 id 一致；builtin clone 会重写为 target id。
- `.template.json` 使用 `schema: locus.template/v1`；`id` 不可通过 PATCH 修改。
- 迁移遇到重复 ws 名称时失败并列出冲突，由用户先改名；不自动生成新名称。
