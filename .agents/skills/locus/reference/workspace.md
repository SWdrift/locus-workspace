# Workspace 与挂载

## 语义

Workspace 具有持久 UUID，可以没有目录。挂载只引用本机绝对路径，不拥有原生目录；删除 Workspace、关系或挂载不删除外部文件。引用接受 UUID 或唯一名称；路径段中的特殊字符必须 URL 编码。

## 调用

```sh
locus help locus://workspaces
locus --json post locus://workspaces --data '{"name":"研究"}'
locus --json get locus://workspaces
locus --json get locus://workspaces/<id>
locus patch locus://workspaces/<id> --data '{"name":"研究二"}'
locus post locus://workspaces/<id>/mounts --data '{"path":"/absolute/project","name":"project"}'
locus get locus://workspaces/<id>/mounts
locus delete locus://workspaces/<id>/mounts/<mount-id-or-name>
locus post locus://workspaces/<id>/relations --data '{"kind":"association","namespace":"example.resource","id":"target","source":{"kind":"manual","detail":"显式确认"}}'
locus delete locus://workspaces/<id>/relations/<relation-id>
locus delete locus://workspaces/<id>
```

JSON 返回信封，Workspace 在 data，Identity 为 data.id。手写 workspace create/show/open 等别名及旧 --yes 已移除；显式 DELETE 表达删除意图，执行前仍应获得用户授权。

## 失败

非法输入退出 1；冲突、对象不存在和授权失败退出 2。同一 Workspace 内挂载名称与路径唯一；名称歧义时使用 UUID。完整规则见 [Core](../../../../packages/core/README.md#workspace-与关系)。
