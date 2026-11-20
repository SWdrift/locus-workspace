# 项目模板

## 范围与边界

项目模板负责管理模板库，并把模板目录纯复制到新的项目目录。它是文件系统能力，不创建 Workspace、不挂载目录、不读写 `core.sqlite`，也不执行模板内的脚本、hook 或网络请求。包导出 `id: template` 的 `locus` 组件定义与 `template://` operation，只转发模板库与复制服务。

模板与 Workspace 没有 API 关联：模板只生成普通目录，用户自行决定是否挂载到某个 Workspace。

| 组件 | 职责 |
| --- | --- |
| `components/templates` | 解析模板库、读写 `.template.json`、复制文件、计算 digest；导出 `component` 与 `operations` |
| `apps/cli` | 通用 `template://` 调用与信封输出；目标路径由调用方明确给出 |
| `.agents/skills/locus` | Agent 使用模板命令的索引与操作参考 |

模块契约见 [Templates README](../../components/templates/README.md)，命令语法见[实用命令](../commands.md#模板操作)，设计取舍见[模板库决定](../../.agents/notes/implemented/feature/2026-11-19-template-library.md)。

## 模板库

模板库位于 `<dataDirectory>/templates/<id>/`，目录名就是模板 id。模板库内可直接编辑文件与 `.template.json`；服务不缓存，读取时以磁盘为准。

- 用户模板优先；没有用户模板时解析包内 `templates/<id>/` 的内置模板。
- 用户模板同名遮蔽内置；删除用户副本后内置重新可见。
- 单个模板损坏进入 `problems`，不阻断其他模板。
- 内置模板只读；要修改就先注册为用户模板。

`.template.json` 是模板元信息，不是项目实例记录；只存在于模板库，不复制到目标。

```json
{
  "schema": "locus.template/v1",
  "id": "node-service",
  "name": "Node service",
  "version": "1.0.0",
  "description": "Node.js + TypeScript 服务骨架"
}
```

`id` 必须等于目录名；`name` 必填；`version` 与 `description` 可选。未知字段与不支持的 schema 明确失败。

## 复制流程

1. 校验目标：必须是绝对路径、父目录存在、目标当前不存在。
2. 解析模板：用户模板优先，其次内置模板。
3. 遍历模板目录：排除 `.git/`、`node_modules/`、`.DS_Store`、`Thumbs.db`、`.template.json`，模板源根排除 `template.json`；拒绝符号链接与特殊文件，读取文件字节并计算 digest。
4. 在目标同级创建临时目录，按相对路径写入目录与文件。
5. 再次确认目标不存在，将临时目录 rename 为目标；失败时清理临时目录。
6. Body 中的 `dryRun: true` 只执行第 1–3 步并返回文件、目录与 digest，不创建任何目标内容。

复制是单次文件系统操作，不跨机器、不做增量同步。目标目录只包含模板内容本身；不写 `.template.json`、digest 或来源记录。源目录在复制期间被并发修改会产生不一致快照；当前不支持重试或校验源快照。

## 操作与数据模型

| operation | 方法与路由 | 说明 |
| --- | --- | --- |
| `template.templates.list` | `GET template://templates` | 列出用户模板与内置模板，返回 `templates` 与 `problems` |
| `template.templates.get` | `GET template://templates/<id>` | 读取元信息、digest、文件数与目录数 |
| `template.templates.register` | `POST template://templates` | 从路径或内置模板注册用户模板 |
| `template.templates.metadata` | `PATCH template://templates/<id>` | 只更新 `name`/`version`/`description` |
| `template.templates.remove` | `DELETE template://templates/<id>` | 删除用户模板 |
| `template.templates.create` | `POST template://templates/<id>/instances` | 复制模板到目标 |

```ts
interface TemplateSummary {
  id: string
  name: string
  sourceKind: 'builtin' | 'user'
  version?: string
  description?: string
}

interface TemplateDetail extends TemplateSummary {
  digest: string
  fileCount: number
  directoryCount: number
}
```

复制结果只返回本次调用的信息：

```ts
interface CreateTemplateResult {
  destination: string
  template: TemplateSummary
  digest: string
  files: string[]
  directories: string[]
  dryRun: boolean
}
```

`digest` 与文件清单只用于本次调用校验，不落盘。

## 不变量

- 模板库可编辑、可复制、可手工修复；服务不缓存内容。
- 内置模板只读兜底，用户模板同名遮蔽；删除用户副本后内置重新可见。
- 不写实例记录，目标项目不包含 `.template.json`；模板来源由用户或 Git 自己维护。
- 目标必须不存在；没有覆盖或 `--force` 路径。
- 模板中的符号链接与设备、FIFO 等特殊文件明确失败，不跟随、不复制。
- 默认排除 VCS、依赖目录与模板元信息；完整列表见 [Templates README](../../components/templates/README.md#复制)。
- 只复制字节；不替换变量、不渲染文本、不自动 `git init`、不执行模板 hook。
- 不修改源模板；源目录中的文件内容与目录结构保持原样。
- 删除或修改模板不影响已经创建的项目；项目来源由用户或 Git 自己维护。

## 失败边界

失败分类包括：非法元信息、非法 id、非法目标、模板不存在、目标已存在、用户模板已存在、修改内置模板、符号链接、特殊文件与文件系统 IO。具体 code、触发条件与 CLI 退出码由 [Templates README](../../components/templates/README.md#失败)与[实用命令](../commands.md#输出与退出码)维护。

失败不会留下目标目录：临时目录在 rename 前失败时被清理；rename 成功后不再回滚已创建项目。

## 演进

出现变量替换需求时，先在模板元信息中增加渲染白名单与严格 token 规则，不直接引入完整模板引擎。需要项目级来源记录时，由新的领域能力显式设计，不恢复目标根 `.template.json`。远程模板需要缓存、校验与失败隔离后再加入。

## 验证

Templates [模块测试](../../components/templates/test/templates.test.mjs)覆盖模板库 CRUD、元信息更新、用户模板遮蔽内置、直接编辑、纯复制、排除、digest、dry-run、目标约束、非法元信息、缺失源与符号链接，并经真实 Dispatcher 验证错误分类；CLI 参数与输出归客户端测试，e2e 覆盖在挂载内创建项目。验证入口见[测试系统](../testing.md#归属与去重)。
