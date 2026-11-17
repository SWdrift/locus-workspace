# 决策记录：组件模型

Status: implemented

> 部分被取代：组件定义现为 `component` + `operations`，不再返回 `api` 或以 capability 作为授权入口；定义、物化、状态与 `requires` 机制继续有效，调用协议见[统一资源调用与 operation 授权](2026-11-17-invocation-api.md)。

## 问题

工作环境里既有 Docker、OpenSSH 这类没有 Locus package 的软件，也有模板、远程目标这类由包实现的能力。Agent 需要知道当前环境有哪些软件、是否可用，但不能把“发现”当成“登记”，也不能把“可用”当成“授权”。为每个软件都开发一套集成不现实，而仅靠自由文本说明又无法判断当前状态。

此前仓库明确不建立能力注册表与动态注册：所有能力都编译进包，在组合根接入。引入组件后，必须在不恢复插件加载器的前提下，给外部软件一个统一、可检查的登记位置。

## 决定

Core 增加组件机制：定义契约、声明式登记、物化、状态与极简生命周期。组件回答“有哪些、现在怎么样”，具体执行仍在组件内部或原生命令。

### 两类组件

- `locus`：由包代码定义，可声明 `requires` 与 `config`；首次访问组件服务时物化到 `<dataDirectory>/components/<id>.yaml`。
- `external`：只有 YAML，由用户通过 `component add` 登记；可以有 `probe` 与 `deploy`。

不设“需要外部的 Locus 组件”这一独立种类，用 `requires` 表达。`packages/` 下除 Core 外的每个包都必须导出 `kind: locus` 的 `component` 与 `operations`；动态登记只接受 `kind: external`。

### 一个入口，两种输入

`defineComponent()` 是唯一入口：对象直接校验，字符串按 YAML 解析后走同一 schema，返回深度冻结的 `component` 与 `operations`。包传对象，`component add` 传文本，不维护第二套注册表。

定义字段为 `id`、`version`、`name`、`summary`、`kind`、`requires`、`config`、`probe`、`deploy`、`info`，以及包代码专属的 `operations` 与 `credentials`。`config` 是内联映射或相对数据目录的路径，Core 不解释内容。

### 物化与版本

包定义在首次访问组件服务时物化，`version` 一并写入。文件已存在时不自动改写；版本不一致只标记 `needsUpgrade`，由 `component upgrade` 按代码重写定义字段并保留 `config`。删除物化文件后按当前版本重建；非法文件不覆盖。

### 状态

外部状态只有 `healthy`、`stopped`、`abnormal`、`absent`，未探查不落值。探针有三种：`argv` 经 `execa` 执行（Windows 的 `.cmd`/`.bat` 由 execa 解析），`ENOENT` 为 `absent`、退出 0 为 `healthy`、非零按 `onFailure`；`tcp` 按连接结果判定；`http` 按 `expectStatus` 判定。超时统一归为 `abnormal`。`locus` 组件的状态由 `requires` 派生，不执行探针。部署状态为 `deployed`、`failed`、`not-deployed`、`not-deployable`。

状态写 `core.sqlite` 的 `component_states` 表；定义是可复制文件，两者不混存。读取不创建数据库，也不触发探针。

### 命令与消费

CLI 提供 `component add/list/show/upgrade/remove/probe/deploy`；`locus <id>` 只解析未知顶层命令，不进入帮助。远程目标通过 CLI 注入的窄接口 `ComponentGate` 检查 `openssh`/`plink` 状态，未登记或非 `healthy` 时在连接前失败，不静默改用其他客户端。

## 备选方案

**为每种软件建立 package 与集成。** 收益是统一 API；否决原因是 Docker、OpenSSH 这类工具的使用方式就是原生命令，包装成 API 不会增加可靠性，反而把维护成本固定到每个软件上。

**把定义存进 SQLite，与状态合并。** 否决原因是定义需要可复制、可手工编辑、可跨机带走；文件更直接，也让损坏范围限制在单个组件。SQLite 只保留状态。

**保留六态可用性与能力级状态。** 否决原因是组件级 A/B/C 已能回答当前问题；能力级状态需要每个能力单独探测，首版没有真实消费方。

**每次访问自动刷新定义字段。** 否决原因是会静默覆盖本地修改，也无法让代码变更与本地实例之间的差异可见；版本标记加手动升级更可解释。

**自动升级或自动部署。** 否决原因是定义变化可能涉及命令与权限；升级、安装、服务启停都必须由用户显式触发。

**恢复插件加载器，把组件做成可执行模块。** 否决原因是第三方代码进入 Core 生命周期、加载顺序与错误隔离都不可控；包组件仍是编译期接入，动态组件只是数据。

**OpenSSH 缺失时自动回退到进程内 SSH 实现。** 本轮未实现；回退需要独立的主机密钥校验与平台验证，且必须显式请求。当前失败信息要求登记或探测组件，不隐藏缺失。

## 后果

- Core 新增 `yaml` 依赖，用于读写组件定义；其余仍是 Node 内置模块。Core 仍不 import 任何包。
- 包组件首次使用前会写入数据目录；只读的 `version` 与 `--help` 不触发。
- `templates` 包的组件 id 是 `template`，包名与组件 id 不强制相同；命令名与组件 id 一致。
- 远程目标多了一次前置登记成本：没有 `openssh` 组件时 `probe`/`exec`/`shell` 会失败并给出命令。
- 组件状态会过期；`show` 必须显示 `checkedAt`，调用方不能把旧状态当成当前事实。删除包组件对应的包后，`component_states` 中可能留下无人认领的行，读取时忽略。
- `list` 显示状态时长；`tcp`/`http` 探针内置，端口与服务检查不再需要在 YAML 里嵌入脚本。
- 组件定义包含机器相关值时，复制到其他机器后需要重新登记或探测；不做跨机自动适配。
- 没有远程环境上的组件实例、依赖图求解、自动安装、动态子命令与 Web/MCP 表面。

## 测试

- `packages/core/test/components.test.mjs`：对象/YAML 等价、未知字段、保留 id、物化、版本不一致、`upgrade` 保留 `config`、损坏隔离、动态登记与删除、argv/tcp/http 探针、状态跨进程、`requires` 派生、部署状态、释放边界、v2 迁移。
- `packages/core/test/runner.test.mjs`：无 BOM 的 UTF-16LE 解码、命令缺失返回 `ENOENT`、Windows `.cmd` 执行。
- `packages/remote-targets/test/remote-targets.test.mjs`：传输组件未登记/未就绪时在凭据检查前失败。
- `apps/cli/test/cli.test.mjs`：组件物化、`component add`、`locus <id>`、手动升级、单条与批量探针、部署、包组件删除拒绝、未知命令不创建目录。
- `tests/components.test.mjs`：所有非 Core 包导出唯一组件定义。
- 门禁为 `pnpm verify`；真实本机冒烟覆盖 Docker `stopped`、OpenSSH/Plink `healthy`，以及 `temp/environment-survey` 的 29 个组件批量登记与 `probe --all`。
