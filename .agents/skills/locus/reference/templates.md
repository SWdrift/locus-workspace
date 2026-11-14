# 项目模板

模板功能只复制文件夹，不创建 Workspace、不挂载目录、不访问数据库。

## 命令

| 命令 | 行为 |
| --- | --- |
| `locus template list` | 列出内置模板 |
| `locus --json template list` | 输出内置模板数组 |
| `locus template create <template> <destination> [--dry-run]` | 复制模板到新目录 |
| `locus --json template create ...` | 输出目标、模板元数据、文件/目录与 digest |

`<template>` 可以是内置 ID（如 `minimal`）或本地模板目录。本地路径存在时优先。`<destination>` 相对路径按当前进程目录解析；目标必须不存在。

`--dry-run` 只计算结果，不写目标；适合先确认文件列表与 digest。

## 排除与实例记录

复制始终排除 `.git/`、`node_modules/`、`.DS_Store`、`Thumbs.db`、`.template.json`，以及模板源根目录的 `template.json`。符号链接会失败。

目标根会生成 `.template.json`：

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

`sourceDigest` 标识复制的模板内容；`templateVersion` 只是作者声明。v1 不提供升级、diff 或覆盖。

## 与 Workspace 的关系

模板命令不修改 Workspace。`locus shell <workspace>` 的 `cwd` 是第一个可访问挂载，在其中执行 `locus template create minimal my-app` 就会把项目建在该挂载内；不在挂载内创建也只是普通文件，不会自动成为 Workspace 成员。
