---
name: locus
description: 管理 Locus Workspace、挂载本机目录，在注入 Workspace 上下文的统一 shell 中工作，登记与观察组件，并访问声明式登记的远程目标。
---

# Locus Workspace

Locus 用稳定的 Workspace Identity 组织长期工作语境。Workspace 可以没有目录，也可以挂载多个本机文件夹；`locus shell` 把这些挂载与 `locus` 命令注入用户 shell。

组件是现实软件能力的登记与观察：包组件随包交付，外部组件（如 Docker、OpenSSH）通过 `component add` 登记。组件状态只说明“现在怎么样”，不授予操作权限。

## 分层索引

| 任务 | 读取 |
| --- | --- |
| 创建、查看、改名、删除 Workspace；挂载/取消挂载 | [reference/workspace.md](reference/workspace.md) |
| 启动统一 shell、读取注入的 `LOCUS_*` 环境 | [reference/shell.md](reference/shell.md) |
| 复制项目模板、查看 `.template.json` 来源记录 | [reference/templates.md](reference/templates.md) |
| 发现组件、登记外部组件、读取探针与部署状态 | [reference/components.md](reference/components.md) |
| 登记并访问远程 SSH 目标、读取探测结果 | [reference/remote-targets.md](reference/remote-targets.md) |
| 本地 Root 初始化／认证、CredentialRef 与 Profile 边界 | [reference/security.md](reference/security.md) |
| 可复用脚本 | [scripts/README.md](scripts/README.md) |

## 快速流程

```sh
locus --json workspace create 研究
locus --json workspace mount <workspace> /absolute/project --name project
locus --json workspace show <workspace>
locus template create minimal my-app
locus --json component list
locus --json component show docker
locus --json remote-targets list
locus shell <workspace>
```

在 shell 内，`locus` 已加入 `PATH`，`LOCUS_WORKSPACE_*`、`LOCUS_MOUNTS` 与每个挂载的 `LOCUS_MOUNT_<NAME>` 已注入。

## 硬规则

- 结构化调用统一使用 `--json`；stdout 只放结果，诊断读 stderr。
- 优先使用 Workspace Identity；名称只在唯一时作为便捷引用。
- `workspace remove`、`workspace unmount`、`workspace unlink` 必须显式带 `--yes`，且不会删除外部目录或文件。
- 挂载路径必须是绝对路径；同一 Workspace 内名称与路径都唯一。
- `locus shell` 注入的是环境与命令，不是权限沙箱；不会提升系统权限。
- 使用外部组件前先 `component show`/`component probe`；`unknown` 与过期时间不能当作可用。
- 不自动安装、启停或部署外部软件；`component deploy` 只在用户明确要求时执行。
- 远程目标只经 `locus remote-targets` 访问；不得直接调用 `ssh`/`plink`，不得读取或输出凭据文件内容。
- Root 密码只进入可信本地 Host 的隐藏 TTY，不进入 Prompt、Bash 参数、argv/env/.env 或日志；普通 User 凭据使用不触发 Root，非交互认证失败不得绕过。
- 需要跨进程恢复或脚本组合时，先用 `locus --json workspace show <workspace>` 读取当前事实，不缓存派生状态。
