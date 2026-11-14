# 项目模板

## 范围与边界

项目模板把模板目录复制到新的项目目录，并在目标根写入来源记录。它是文件系统能力，不创建 Workspace、不挂载目录、不读写 `core.sqlite`，也不执行模板内的脚本、hook 或网络请求。

| 组件 | 职责 |
| --- | --- |
| `packages/templates` | 解析模板源、复制文件、计算 digest、写入实例记录 |
| `apps/cli` | `locus template` 命令、相对目标路径解析、文本/JSON 投影 |
| `.agents/skills/locus` | Agent 使用模板命令的索引与操作参考 |

模块契约见 [Templates README](../../packages/templates/README.md)，命令语法见[实用命令](../commands.md#模板操作)，设计取舍见[项目模板决定](../../.agents/notes/implemented/feature/2026-11-13-project-templates.md)。

## 模板源

模板源有两种：

- 内置模板 ID，来自 `packages/templates/templates/<id>/`；
- 本地模板目录，路径存在时优先于同名内置模板。

源目录可选包含 `template.json`，只描述 `id`、`name`、`version`、`description`。没有 manifest 的普通目录也可直接作为模板，ID 取目录名。manifest 不控制复制行为；v1 不包含渲染规则、hook 或排除配置。

## 复制流程

1. 校验目标：必须是绝对路径、父目录存在、目标当前不存在。
2. 解析模板源，并读取可选的源 manifest。
3. 遍历源目录：排除默认忽略项，拒绝符号链接与特殊文件，读取文件字节并计算 digest。
4. 在目标同级创建临时目录，按相对路径写入目录与文件。
5. 写入 `.template.json` 实例记录。
6. 再次确认目标不存在，将临时目录 rename 为目标；失败时清理临时目录。
7. `--dry-run` 执行第 1 至 3 步并返回文件、目录与 digest，不创建任何目标内容。

复制是单次文件系统操作，不跨机器、不做增量同步。源目录在复制期间被并发修改会产生不一致快照；当前不支持重试或校验源快照。

## 数据模型

源 `template.json` 是可选作者元数据。目标 `.template.json` 是实例记录：

```json
{
  "schema": "locus.template-instance/v1",
  "templateId": "minimal",
  "templateVersion": "1.0.0",
  "sourceKind": "builtin",
  "sourceDigest": "sha256:...",
  "createdAt": "ISO-8601",
  "parameters": {}
}
```

`sourceDigest` 是实际复制内容（路径、目录与文件字节）的确定性 SHA-256，标识模板内容；`templateVersion` 是作者声明，允许缺失。实例记录不写源绝对路径，避免把本机路径带进可提交项目。字段定义与 digest 计算由 [Templates README](../../packages/templates/README.md#实例记录)维护。

版本分三层：

| 层 | 载体 | 作用 |
| --- | --- | --- |
| 模板声明版本 | 源 `template.json` | 作者维护的展示版本 |
| 实例来源 | 目标 `.template.json` | 记录创建时使用的模板内容与参数 |
| 项目版本 | 目标目录的 Git 历史 | 创建后的真实变更历史 |

## 不变量

- 目标必须不存在；没有覆盖或 `--force` 路径。
- 模板中的符号链接与设备、FIFO 等特殊文件明确失败，不跟随、不复制。
- 默认排除 VCS、依赖目录与实例/作者元数据；完整列表见 [Templates README](../../packages/templates/README.md#模板源)。
- 只复制字节；不替换变量、不渲染文本、不自动 `git init`、不执行模板 hook。
- 不修改源模板；源目录中的文件内容与目录结构保持原样。
- 实例记录只做 provenance，不承诺自动升级或三方合并。
- 模板命令不读取或创建 Workspace 数据库；目标在挂载内时自然可见，不在挂载内时只是普通文件。

## 失败边界

失败分类包括：非法 manifest、非法目标、模板不存在、目标已存在、符号链接、特殊文件与文件系统 IO。具体 code、触发条件与 CLI 退出码由 [Templates README](../../packages/templates/README.md#失败)与[实用命令](../commands.md#输出与退出码)维护。

失败不会留下目标目录：临时目录在 rename 前失败时被清理；rename 成功后不再回滚已创建项目。

## 演进

出现变量替换需求时，先在 manifest 中增加渲染白名单与严格 token 规则，不直接引入完整模板引擎。需要升级时先设计旧模板快照或 Git 合并策略，不以版本号自动覆盖目标项目。远程模板需要缓存、校验与失败隔离后再加入。

## 验证

Templates 模块测试覆盖复制、排除、digest、实例记录、dry-run、目标约束、非法 manifest、缺失源与符号链接；命令行子进程用例位于 `packages/templates/test/cli.test.mjs`，覆盖 `template list/create` 与 Workspace 数据库无副作用；e2e 覆盖在挂载内创建项目与跨进程命令链。验证入口见[测试系统](../testing.md#归属与去重)。
