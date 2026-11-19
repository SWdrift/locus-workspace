# 决策记录：项目模板复制与来源记录

Status: implemented

部分被取代：目标 `.template.json` 实例记录已移除，模板库、模板元信息与纯复制语义见[模板库决策](2026-11-19-template-library.md)。

## 问题

Workspace 可以挂载多个本机目录，但新建项目仍需手工复制文件夹。需要一个独立能力，把模板目录复制到目标位置，并回答“这个项目来自哪个模板、哪一版”，同时不能把文件内容、渲染规则或升级逻辑塞进 Core。

现有方向要求尽量复用第三方与成熟做法，但模板文件本身可能是代码、JSON 或带 `{{ }}` 的文本；引入完整模板引擎会把语法碰撞、转义与执行语义变成新产品面。版本管理也尚未确定，不能先假设一个升级模型。

## 决定

### 独立文件系统包

新增 `@locus/templates`，只依赖 Node 内置模块。它不 import `@locus/core`，不知道 Workspace 或挂载，只接受绝对目标路径与模板源，返回复制结果。CLI 负责相对路径解析与命令投影；Core 不新增模板表或字段。

模板源支持：

- 内置模板 ID，来自 `packages/templates/templates/<id>/`；
- 本地目录，传入路径存在时优先于同名内置模板。

不建立模板注册表或配置文件。

### 只复制文件夹

v1 只复制字节，不替换变量、不渲染文本、不执行 hook、不自动 `git init`、不访问网络。复制始终排除：

```text
任意层级：.git/、node_modules/、.DS_Store、Thumbs.db、.template.json
模板源根：template.json
```

符号链接与设备/FIFO 等特殊文件明确失败；不跟随、不复制。空目录会保留。

目标必须是绝对路径且当前不存在；父目录必须已存在。复制先写同级临时目录，完成后 rename 到目标，失败清理临时目录，避免留下半个项目。没有 `--force` 或覆盖路径。

### 源元数据与实例记录分离

模板源可选 `template.json`，只承载 `id`、`name`、`version`、`description`。没有 manifest 的普通文件夹也可直接复制，ID 取目录名。

复制完成后在目标根生成 `.template.json`：

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

`sourceDigest` 是实际复制文件、目录路径与内容的确定性 SHA-256，用来标识模板内容；`templateVersion` 是作者声明，允许缺失。记录不写源绝对路径，避免把本机路径带进可提交项目。实例记录只做 provenance，不承诺自动升级。

### CLI 与内置模板

CLI 增加：

- `locus template list`；
- `locus template create <template> <destination> [--dry-run]`；
- 全局 `--json` 输出同构结果。

`--dry-run` 只计算文件、目录与 digest，不写目标。内置 `minimal` 模板只有 `README.md` 与 `.gitignore`，避免提前绑定技术栈。Skill 增加 `reference/templates.md`，不增加新的运行时脚本。

## 备选方案

**把模板放进 Core 或新增 Core 表。** 能让模板与 Workspace 共用持久化，但 Core 会开始理解文件内容、复制规则与目标目录；模板是文件系统能力，不是长期身份或关系。保持独立包。

**使用完整模板引擎（Handlebars、Eta 等）。** 能提供变量、条件和循环，但代码/配置中的 `{{ }}`、`<% %>` 会与引擎语法碰撞，还引入转义与执行语义。v1 只做复制；需要变量替换时再设计白名单与严格 token。

**源与实例共用一个 `.template.json`。** 少一个文件名，但作者配置与项目 provenance 生命周期不同；复制时容易把旧记录带进新项目，也无法区分“模板声明”和“何时从哪份内容复制”。使用源 `template.json` + 目标 `.template.json`。

**建立模板注册表/配置。** 能按名称管理本地模板，但当前只有内置与路径两种来源，注册表会增加发现、清理与并发语义。先按路径与内置 ID 解析。

**自动执行模板 hook 或 `git init`。** 能完成更多初始化，但模板可能来自外部，hook 是未审计代码执行；VCS 边界也应由用户决定。v1 不执行。

**直接 `fs.cp` 整树复制。** 代码更少，但无法统一排除、计算 digest、拒绝符号链接或保证临时目录 rename；当前 walker 的复杂度换来明确边界。

## 后果

收益：项目模板可以独立测试与复用；复制结果可验证（digest + 实例记录）；不会创建 Workspace 或挂载副作用；目标不存在与临时目录策略避免覆盖和半成品；不执行不可信模板代码。

代价：没有变量替换，项目名/占位符需要模板作者预先处理；没有模板升级、diff 或三方合并，只能重新创建或手工对比；默认排除 `.git` 与 `node_modules` 可能不符合所有“原样复制”预期；模板源路径与目标目录仍是主机本地事实。

重新引入条件：出现明确的变量替换需求时，在 manifest 中增加 render 白名单与严格 token 规则；需要升级时先设计旧模板快照或 Git 合并策略，不以版本号自动覆盖；远程模板需要缓存、校验与失败隔离后再加入。

## 测试

- Templates 测试覆盖本地/内置复制、排除、digest 稳定性、实例记录、dry-run、目标/父目录约束、非法 manifest、缺失源与符号链接。
- CLI 测试覆盖 `template list/create`、相对目标、dry-run、目标已存在与缺失模板；确认模板命令不创建 Workspace 数据库。
- e2e 覆盖模板创建。
