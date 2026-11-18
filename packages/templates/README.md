# @locus/templates

## 简述与职责

本机项目模板：把一个模板文件夹复制到新目录，并写入来源记录。包只操作文件系统，不写 Workspace 数据库，也不执行模板内的脚本、hook 或网络请求。包导出 `kind: locus` 的 `component`（`id: template`）与 `operations`，供 CLI 组合根注入并在首次访问组件服务时物化。

当前只做字节复制：不替换变量、不渲染文本、不做模板升级。

组件定义只声明 `template://` operation 与 `info.text`，不包含 `probe`、`deploy` 或 `requires`；它不改变复制行为。

## 源码导航

| 修改意图 | 实现入口 |
| --- | --- |
| 组件声明与调用契约 | [component.ts](src/component.ts)、[operations.ts](src/operations.ts)、[schemas.ts](src/schemas.ts) |
| 模板解析、复制与实例记录 | [engine.ts](src/engine.ts) |
| 结果类型与领域错误 | [types.ts](src/types.ts) |
| 行为验证 | [templates.test.mjs](test/templates.test.mjs) |

## 模板源

模板源可以是内置模板 ID，也可以是本地目录：

- 内置模板位于 `packages/templates/templates/<id>/`；
- 本地目录通过绝对或相对路径传入，存在时优先于同名内置模板。

`template.json` 可选，只承载展示与版本信息：

```json
{
  "id": "minimal",
  "name": "Minimal",
  "version": "1.0.0",
  "description": "空项目骨架"
}
```

`id` 可选；缺省取目录名。`version`、`name`、`description` 可省略。没有 manifest 的普通文件夹也可以直接复制。

复制时始终排除：

```text
任意层级：.git/、node_modules/、.DS_Store、Thumbs.db、.template.json
模板源根：template.json
```

符号链接与特殊文件明确失败，不跟随、不复制。

## 实例记录

复制完成后在目标根写入 `.template.json`：

```json
{
  "schema": "locus.template-instance/v1",
  "templateId": "minimal",
  "templateVersion": "1.0.0",
  "sourceKind": "builtin",
  "sourceDigest": "sha256:...",
  "createdAt": "2026-11-13T09:30:00.000Z",
  "parameters": {}
}
```

`sourceDigest` 是对实际复制的文件、目录路径与内容计算的确定性 SHA-256；它标识“这份模板”，不保证后续自动升级。`templateVersion` 是作者声明，允许缺失，不与 digest 强绑定。记录不包含源绝对路径。

## 使用

```ts
import { createTemplateService } from '@locus/templates'

const templates = createTemplateService()
const listed = await templates.list()
const result = await templates.create('minimal', {
  destination: '/absolute/new-project',
})
console.log(result.files, result.digest)
```

`create` 要求目标绝对路径且不存在；父目录必须已存在。复制先写入同级临时目录，完成后 rename 到目标，失败清理临时目录。`dryRun: true` 只计算文件、目录与 digest，不写入。

CLI 用法见[命令手册](../../docs/commands.md#模板操作)。

## 失败

| 领域 code | 含义 | operation 协议 code |
| --- | --- | --- |
| `invalid-template` | `template.json` 非法、内置模板 ID 重复 | `invalid-argument` |
| `invalid-destination` | 目标非绝对路径、父目录不存在 | `invalid-argument` |
| `not-found` | 模板源不存在 | `not-found` |
| `destination-exists` | 目标已存在 | `conflict` |
| `symlink` | 模板含符号链接 | `invalid-argument` |
| `unsupported-entry` | 模板含设备、FIFO 等特殊文件 | `invalid-argument` |
| `io` | 文件系统读取或写入失败 | `internal` |

直接服务保留 `TemplateFailure`；operation 在本包内转换为 `InvocationFailure`，原领域 code 位于 `details.domain`。Core 不维护模板专属映射。

## 限制与演进

不做渲染、参数替换、hook、`git init`、远程模板、模板升级或三方合并。出现真实需求后再扩展 manifest 与实例 schema；项目自身的版本历史由目标目录中的 Git 承担。

## 验证

`pnpm test` 覆盖本地/内置模板、排除规则、实例记录、digest 稳定性、dry-run、目标存在、缺失源、非法 manifest 与符号链接边界。验证入口见[测试系统](../../docs/testing.md#分层与入口)。
