# Workspace 与挂载

## 语义

- Workspace 具有稳定 UUID，与目录、Project 根和 Agent Session 解耦；可以没有任何挂载。
- 挂载是 Workspace 对本机绝对目录的引用，不复制、不移动、不拥有目录内容。
- 同一 Workspace 内挂载名称与路径都唯一；路径不存在仍可保存，`shell` 会报告缺失并跳过它选择 `cwd`。
- 挂载名称必须以字母或数字开头，只包含字母、数字、下划线和短横线，最长 64 字符；省略 `--name` 时取目录名并做安全化处理。
- 删除 Workspace 只删除 Locus 自有的 Workspace、挂载与关系记录，不删除外部目录。

## 命令

所有命令支持全局 `--json`，可放在子命令前。

| 命令 | 行为 |
| --- | --- |
| `locus workspace create <name>` | 创建具有新 UUID 的 Workspace |
| `locus workspace list` | 列出 Workspace 与挂载数量 |
| `locus workspace show <workspace>` / `open` | 按 Identity 或唯一名称查看挂载与关系 |
| `locus workspace rename <workspace> <name>` | 改名，Identity 不变 |
| `locus workspace remove <workspace> --yes` | 删除 Workspace 及自有挂载/关系 |
| `locus workspace mount <workspace> <path> [--name <name>]` | 挂载本机绝对目录 |
| `locus workspace mounts <workspace>` | 列举挂载 |
| `locus workspace unmount <workspace> <mount> --yes` | 取消挂载，接受挂载 ID 或名称 |
| `locus workspace link <workspace> <namespace> <reference>` | 保存显式长期关系 |
| `locus workspace unlink <workspace> <relation-id> --yes` | 解除关系 |

`<workspace>` 可以是 UUID 或唯一名称；名称重复时命令失败并要求使用 Identity。`<mount>` 同理接受挂载 ID 或名称。

## 示例

```sh
# 创建并挂载两个目录
WS=$(locus --json workspace create 研究 \
  | node -pe 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).id')
locus --json workspace mount "$WS" /home/me/project --name project
locus --json workspace mount "$WS" /home/me/data

# 按名称查看；JSON 中包含 mounts 数组
locus --json workspace show 研究

# 取消挂载只删除记录
locus workspace unmount "$WS" project --yes

# 删除 Workspace 不删除 /home/me/project
locus workspace remove "$WS" --yes
```

JSON 的 Workspace 形状：

```json
{
  "id": "uuid",
  "name": "研究",
  "createdAt": "ISO-8601",
  "relations": [],
  "mounts": [
    { "id": "uuid", "workspaceId": "uuid", "name": "project", "path": "/home/me/project", "createdAt": "ISO-8601" }
  ]
}
```

## 失败

- 路径不是绝对路径、名称为空或格式非法：退出 2。
- 同一 Workspace 重复挂载同一路径或名称：退出 2。
- 找不到 Workspace 或挂载：退出 2。
- 缺少 `--yes`：退出 1，且不写数据。
