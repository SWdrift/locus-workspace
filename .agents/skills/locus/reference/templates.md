# 项目模板

模板只复制字节、计算 digest 并写实例来源，不创建 Workspace、不执行脚本或 hook。

```sh
locus help template://
locus --json get template://templates
locus post template://templates/minimal/instances --data '{"destination":"/absolute/new-project","dryRun":true}'
locus post template://templates/minimal/instances --data '{"destination":"/absolute/new-project"}'
```

目标必须是绝对路径且不存在，父目录必须存在；通用 URL 客户端不转换相对路径。dryRun 是 JSON 字段，不是旧命令 flag。本地模板源可放在 URL 的编码路径参数中，或使用内置 ID。

结果在信封 data，包含文件、目录、digest 与 .template.json。模板排除规则、失败 code 与来源记录见 [Templates](../../../../packages/templates/README.md)。复制失败不能伪装成已创建，不支持覆盖或自动升级。
