# Workspace 与挂载

## 语义

Workspace 具有持久 UUID，可以没有目录。名称唯一（trim 后精确匹配），可选 description。挂载只引用本机绝对路径，不拥有原生目录；删除 Workspace、关系或挂载不删除外部文件。每个 Workspace 最多一个 `primary` 挂载，shell 优先用它作为 cwd。引用先按 UUID，再按唯一名称；路径段中的特殊字符必须 URL 编码。

## 调用

```sh
locus routes locus://ws
locus --json post locus://ws --data '{"name":"研究","description":"长期语境"}'
locus --json get locus://ws
locus --json get locus://ws/<id>
locus patch locus://ws/<id> --data '{"name":"研究二","description":"新描述"}'
locus post locus://ws/<id>/mounts --data '{"path":"/absolute/project","name":"project","primary":true}'
locus get locus://ws/<id>/mounts
locus patch locus://ws/<id>/mounts/<mount> --data '{"primary":true}'
locus delete locus://ws/<id>/mounts/<mount>
locus post locus://ws/<id>/relations --data '{"kind":"association","namespace":"example.resource","id":"target","source":{"kind":"manual","detail":"显式确认"}}'
locus delete locus://ws/<id>/relations/<relation-id>
locus delete locus://ws/<id>
```

JSON 返回信封，Workspace 在 data，Identity 为 data.id。手写 workspace create/show/open 等别名及旧 `--yes` 已移除；显式 DELETE 表达删除意图，执行前仍应获得用户授权。

## 失败

非法输入退出 1；名称冲突、对象不存在和授权失败退出 2。同一 Workspace 内挂载名称与路径唯一；名称已唯一，不再有歧义分支。完整规则见 [Core](../../../../packages/core/README.md#workspace-与关系)。
