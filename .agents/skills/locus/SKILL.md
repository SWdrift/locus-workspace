---
name: locus
description: 通过声明驱动的资源 URL 管理 Workspace、组件、模板和远程目标，并在统一 shell 中工作。
---

# Locus Workspace

默认使用资源 URL，不使用已移除的领域命令别名。先用 locus routes <scheme://> 或 GET locus://operations 读取当前注册声明，再按方法调用；--json 结果的业务数据位于 data。

## 分层索引

| 任务 | 读取 |
| --- | --- |
| Workspace、挂载与关系 | [workspace](reference/workspace.md) |
| 本机 shell 与环境注入 | [shell](reference/shell.md) |
| 模板复制 | [templates](reference/templates.md) |
| 组件登记、观察与部署 | [components](reference/components.md) |
| SSH 目标登记与访问 | [remote-targets](reference/remote-targets.md) |
| 身份、Root 与凭据 | [security](reference/security.md) |
| 只读脚本 | [脚本](scripts/README.md) |

## 快速流程

```sh
locus routes locus://ws
locus --json get locus://ws
locus --json post locus://ws --data '{"name":"研究"}'
locus --json get locus://components
locus routes rt://
locus --json get rt://targets
locus shell <workspace>
```

## 硬规则

- URL 方法是操作意图：裸 URL 仅 GET，写入必须显式方法；不自动重试副作用。
- 秘密不放 Body、argv 值、环境或日志。资源凭据使用声明允许的 --field-file field=path，或 --prompt field 选择隐藏输入；Root 密码只在可信 TTY。
- 信封 ok 表示调用结果，data 的探测状态、远端 exitCode 仍需检查，不能仅看 CLI 退出码。
- Workspace Identity 与目录无关；不缓存隐式当前 Workspace。先读当前资源，再做更改。
- 外部组件健康状态不授予权限，观察时间不能当当前事实；不自动安装或部署。
- 远程目标只经 rt://；不绕过入口直接调用 ssh/plink，不读取或输出秘密。
- shell 环境不是 Session、Grant 或沙箱。
