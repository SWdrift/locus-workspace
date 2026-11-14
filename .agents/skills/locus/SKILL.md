---
name: locus
description: 管理 Locus Workspace、挂载本机目录，并在注入 Workspace 上下文的统一 shell 中工作。
---

# Locus Workspace

Locus 用稳定的 Workspace Identity 组织长期工作语境。Workspace 可以没有目录，也可以挂载多个本机文件夹；`locus shell` 把这些挂载与 `locus` 命令注入用户 shell。

## 分层索引

| 任务 | 读取 |
| --- | --- |
| 创建、查看、改名、删除 Workspace；挂载/取消挂载 | [reference/workspace.md](reference/workspace.md) |
| 启动统一 shell、读取注入的 `LOCUS_*` 环境 | [reference/shell.md](reference/shell.md) |
| 复制项目模板、查看 `.template.json` 来源记录 | [reference/templates.md](reference/templates.md) |
| 可复用脚本 | [scripts/README.md](scripts/README.md) |

## 快速流程

```sh
locus --json workspace create 研究
locus --json workspace mount <workspace> /absolute/project --name project
locus --json workspace show <workspace>
locus template create minimal my-app
locus shell <workspace>
```

在 shell 内，`locus` 已加入 `PATH`，`LOCUS_WORKSPACE_*`、`LOCUS_MOUNTS` 与每个挂载的 `LOCUS_MOUNT_<NAME>` 已注入。

## 硬规则

- 结构化调用统一使用 `--json`；stdout 只放结果，诊断读 stderr。
- 优先使用 Workspace Identity；名称只在唯一时作为便捷引用。
- `workspace remove`、`workspace unmount`、`workspace unlink` 必须显式带 `--yes`，且不会删除外部目录或文件。
- 挂载路径必须是绝对路径；同一 Workspace 内名称与路径都唯一。
- `locus shell` 注入的是环境与命令，不是权限沙箱；不会提升系统权限。
- 需要跨进程恢复或脚本组合时，先用 `locus --json workspace show <workspace>` 读取当前事实，不缓存派生状态。
