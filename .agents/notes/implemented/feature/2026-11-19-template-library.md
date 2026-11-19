# 决策记录：模板库与无实例记录

Status: implemented

## 问题

旧模板能力只有“复制内置/本地目录并写入目标根 `.template.json` 实例记录”。它解决了来源记录，但没有模板库：用户无法列出、注册、修改或删除自己的模板；每复制一次项目就多一份实例元信息，而用户明确要求模板只做脚手架，项目不保留模板来源。模板与 Workspace 也没有关联，用户需要自行把生成目录挂载到 Workspace。

需要在不引入模板引擎、hook 或 Workspace 写入的前提下，给出可管理的模板库、可独立更新的模板元信息，以及纯复制语义。

## 决定

模板库位于 `<dataDirectory>/templates/<id>/`，目录名就是模板 id。用户模板可直接编辑文件与 `.template.json`；服务不缓存，读取时以磁盘为准。内置模板保留在包内 `templates/<id>/`，只作兜底；用户模板同名遮蔽内置，删除用户副本后内置重新可见。

`.template.json` 改为模板元信息，只存在于模板库，不复制到目标。字段为 `schema`、`id`、`name`、`version`、`description`；`id` 必须等于目录名，`name` 必填。未知字段与不支持的 schema 明确失败。

operation 为 `GET template://templates`、`GET template://templates/<id>`、`POST template://templates`、`PATCH template://templates/<id>`、`DELETE template://templates/<id>`、`POST template://templates/<id>/instances`。没有覆盖式 `PUT`：内容直接改模板库，或删除后重新注册。`PATCH` 只写元信息；纯内置模板不能直接修改或删除，先注册用户副本。

实例化只复制字节：目标绝对路径且不存在，父目录存在；排除 `.git/`、`node_modules/`、`.DS_Store`、`Thumbs.db`、`.template.json`，模板源根排除 `template.json`；拒绝符号链接与特殊文件；临时目录 rename。目标目录不写 `.template.json`、digest 或来源；返回结果中的 digest 与文件清单只用于本次调用校验。

不渲染变量、不执行 hook、不自动 `git init`、不访问网络。模板与 Workspace 没有 API 关联；用户自行把生成目录挂载到 Workspace。

## 备选方案

**保留目标 `.template.json` 实例记录。** 能回答项目来自哪个模板，但用户明确要求实例化后不写该文件；来源交给用户或 Git 维护。记录被移除。

**把模板元信息放 SQLite。** 能让列表不依赖文件系统，但模板内容本来就是目录，元信息与内容分开会增加两套真源；继续使用模板目录内的 `.template.json`。

**允许覆盖式 `PUT`。** 能整体替换模板，但模板库可直接编辑，`PUT` 只是重复入口；删除后重新注册或直接覆盖目录已足够。

**内置模板可改可删。** 能少一次副本，但包内资源会被本机修改污染，也无法区分作者版本；采用只读内置加用户遮蔽。

**引入模板引擎或 post-create hook。** 能生成带变量或安装依赖的项目，但会把未审计代码执行、语法碰撞与失败回滚引入模板包；当前只做复制。

**让模板创建 Workspace 或挂载。** 能一键完成初始化，但模板包会依赖 Workspace 与 Core，破坏两者的独立边界；用户显式挂载。

## 后果

收益：模板库可列举、注册、修改、删除；元信息可单独更新；用户模板遮蔽内置，定制不需要改包；项目目录不再有实例元信息；模板与 Workspace 保持独立。

代价：项目不再自动记录模板来源；模板 id 与元信息需要保持同步；模板库损坏只能在实例化时发现；内置模板不能直接改，需要先复制；没有模板升级或三方合并。

旧项目中的 `.template.json` 实例记录不再被读取或解释；它只是普通文件，用户可自行删除或保留。模板子系统文档、Templates README、命令手册、Skill 参考与测试已同步更新。

## 测试

`packages/templates/test/templates.test.mjs` 覆盖模板库列表、详情、注册、元信息更新、删除、用户遮蔽内置、直接编辑、纯复制、无 `.template.json`、dry-run、排除、目标约束、缺失源、符号链接与 Dispatcher 错误映射。`pnpm test` 与 `pnpm docs:check` 为验证入口。
