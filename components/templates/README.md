# @locus/templates

## 简述与职责

本包管理模板库，并把模板目录纯复制到新的项目目录。模板库位于 `<dataDirectory>/templates/<id>/`，可直接编辑文件与 `.template.json`；内置模板只作兜底，用户模板同名时遮蔽内置。目标项目不写 `.template.json`，不记录实例来源。

包只操作文件系统，不写 Workspace 数据库，也不执行模板内的脚本、hook 或网络请求。包导出 `kind: locus` 的 `component`（`id: template`）与 `operations`，供 CLI 组合根注入并在首次访问组件服务时物化。

## 源码导航

| 修改意图 | 实现入口 |
| --- | --- |
| 组件声明与调用契约 | [component.ts](src/component.ts)、[operations.ts](src/operations.ts)、[schemas.ts](src/schemas.ts) |
| 模板库解析、元信息、复制与错误 | [engine.ts](src/engine.ts) |
| 本包文案表 | [i18n.ts](src/i18n.ts) |
| 结果类型与领域错误 | [types.ts](src/types.ts) |
| 行为验证 | [templates.test.mjs](test/templates.test.mjs) |

## 模板库

```text
<dataDirectory>/templates/<id>/
  .template.json          # 模板元信息
  README.md
  ...
```

- 目录名就是模板 `id`，规则为小写字母开头、只含小写字母/数字/短横线、最长 64 字符。
- `.template.json` 是模板元信息，不是项目实例记录；只存在于模板库，不复制到目标。
- 可直接编辑模板库内的文件与 `.template.json`；服务不缓存，读取时以磁盘为准。
- 用户模板优先；没有用户模板时解析内置模板。删除用户副本后，同名内置模板重新可见。
- 单个模板损坏进入 `problems`，不阻断其他模板。

元信息：

```json
{
  "schema": "locus.template/v1",
  "id": "node-service",
  "name": "Node service",
  "version": "1.0.0",
  "description": "Node.js + TypeScript 服务骨架"
}
```

`id` 必须与目录名一致，`PATCH` 不能修改 `id`；`name` 必填，`version` 与 `description` 可选。未知字段与不支持的 schema 明确失败。

## 操作

| operation | 方法与路由 | 说明 |
| --- | --- | --- |
| `template.templates.list` | `GET template://templates` | 列出用户模板与内置模板，返回 `templates` 与 `problems` |
| `template.templates.get` | `GET template://templates/<id>` | 读取元信息与当前内容摘要 |
| `template.templates.register` | `POST template://templates` | 从目录或内置模板注册用户模板 |
| `template.templates.metadata` | `PATCH template://templates/<id>` | 只更新 `name`/`version`/`description` |
| `template.templates.remove` | `DELETE template://templates/<id>` | 删除用户模板 |
| `template.templates.create` | `POST template://templates/<id>/instances` | 复制模板到目标目录 |

`POST template://templates` 的 Body：

```json
{
  "id": "node-service",
  "source": { "kind": "path", "path": "X:/templates/node-service" }
}
```

`source.kind` 也可以是 `builtin`，`source.id` 指向内置模板。注册会校验并复制模板内容，已有用户模板同 id 时冲突；同名内置允许创建用户副本并遮蔽。

## 复制

1. 校验目标：必须是绝对路径、父目录存在、目标当前不存在。
2. 解析模板：用户模板优先，其次内置模板。
3. 遍历模板目录：排除 `.git/`、`node_modules/`、`.DS_Store`、`Thumbs.db`、`.template.json`，模板源根排除 `template.json`；拒绝符号链接与特殊文件，读取文件字节并计算 digest。
4. `dryRun: true` 只返回文件、目录与 digest，不写目标。
5. 在目标同级创建临时目录，按相对路径写入目录与文件；不写任何实例记录。
6. 再次确认目标不存在，将临时目录 rename 为目标；失败时清理临时目录。

目标目录只包含模板内容本身；模板元信息、digest 与来源都不落盘。实例化结果中的 `digest` 只用于本次调用校验。

## 使用

```ts
import { createTemplateService } from '@locus/templates'

const templates = createTemplateService({ dataDirectory: '/absolute/data' })
const listed = await templates.list()
const registered = await templates.register({
  id: 'node-service',
  source: { kind: 'path', path: '/absolute/templates/node-service' },
})
const result = await templates.create('node-service', {
  destination: '/absolute/new-project',
})
console.log(result.files, result.digest)
```

`dataDirectory` 是 Core 数据目录；模板库固定为 `<dataDirectory>/templates/`。CLI 用法见[命令手册](../../docs/commands.md#模板操作)。

## 失败

| 领域 code | 含义 | operation 协议 code |
| --- | --- | --- |
| `invalid-template` | `.template.json` 非法、未知字段或 id 不匹配 | `invalid-argument` |
| `invalid-id` | 模板 id 不符合规则 | `invalid-argument` |
| `invalid-source` | 注册源目录不存在 | `invalid-argument` |
| `invalid-destination` | 目标非绝对路径、父目录不存在 | `invalid-argument` |
| `not-found` | 模板或源模板不存在 | `not-found` |
| `destination-exists` | 目标已存在 | `conflict` |
| `template-exists` | 用户模板同 id 已存在 | `conflict` |
| `template-builtin` | 试图修改或删除纯内置模板 | `forbidden` |
| `symlink` | 模板含符号链接 | `invalid-argument` |
| `unsupported-entry` | 模板含设备、FIFO 等特殊文件 | `invalid-argument` |
| `io` | 文件系统读取或写入失败 | `internal` |

直接服务保留 `TemplateFailure`；operation 在本包内转换为 `InvocationFailure`，原领域 code 位于 `details.domain`。Core 不维护模板专属映射。

## 限制与演进

不做渲染、参数替换、hook、`git init`、远程模板、模板升级或三方合并。模板内容与元信息直接修改模板库，不提供覆盖式 `PUT`；需要整体替换时删除旧模板后重新注册，或直接覆盖库内目录。项目自身的版本历史由目标目录中的 Git 承担。

## 验证

`pnpm test` 覆盖模板库 CRUD、元信息更新、用户模板遮蔽内置、直接编辑、纯复制、排除规则、dry-run、目标存在、缺失源、符号链接边界与 Dispatcher 错误分类。验证入口见[测试系统](../../docs/testing.md#分层与入口)。
