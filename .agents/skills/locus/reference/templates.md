# 项目模板

模板库位于 `<dataDirectory>/templates/<id>/`，可直接编辑内容与 `.template.json`。内置模板只作兜底，用户模板同名遮蔽内置。从模板创建项目只复制字节，不写 `.template.json`，不执行脚本或 hook。

```sh
locus help template://
locus --json get template://templates
locus --json get template://templates/minimal
locus post template://templates --data '{"id":"node-service","source":{"kind":"path","path":"X:/templates/node-service"}}'
locus patch template://templates/node-service --data '{"description":"Node 服务骨架"}'
locus delete template://templates/node-service
locus post template://templates/minimal/instances --data '{"destination":"/absolute/new-project","dryRun":true}'
locus post template://templates/minimal/instances --data '{"destination":"/absolute/new-project"}'
```

目标必须是绝对路径且不存在，父目录必须存在；通用 URL 客户端不转换相对路径。`GET template://templates` 返回 `templates` 与 `problems`；用户模板优先，同名遮蔽内置。内置模板不能直接修改或删除，先 `POST` 用户副本。模板内容与失败语义见 [Templates](../../../../packages/templates/README.md)。
