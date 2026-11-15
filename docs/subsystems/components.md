# 组件

## 范围

组件是 Locus 识别、登记和观察的一种软件或基础设施能力单元。Core 只回答“有哪些组件、它们现在怎么样”，不代替组件执行安装、服务管理或业务操作。本页覆盖 `packages/core` 的组件机制、`apps/cli` 的 `component` 命令域与 `locus <id>` 入口；具体命令语法见[实用命令](../commands.md#组件操作)。

不包含：远程环境上的组件实例、组件依赖图求解、自动安装与启动、动态生成每个组件的子命令、把组件发现当作授权。

## 两类组件

| `kind` | 来源 | 定义位置 | 外部状态 | 可删除 |
| --- | --- | --- | --- | --- |
| `locus` | 包代码，首次访问时物化 | `<dataDirectory>/components/<id>.yaml` | 声明 `requires` 时由依赖派生 | 否 |
| `external` | 用户通过 `component add` 登记 | 单文件或文件夹 | 自身 `probe` | 是 |

包组件只允许 `kind: locus`；动态组件只允许 `kind: external`。纯 Locus 组件与依赖外部的 Locus 组件不是两种 kind，后者用 `requires` 表达。

提供组件的包导出 `component` 与 `api`，作为包的一部分参与类型检查，并由 CLI 组合根传给 `createLocusCore()`；`config-reference` 这类非组件包不导出组件。没有包的外部软件（如 Docker）只登记 YAML。

## 定义

包定义由 `@locus/core` 的 `defineComponent()` 校验并冻结，返回 `component` 与 `api`；`component add` 只接受 YAML 文本中的描述性元数据。YAML 不接受 `capabilities`/`credentials`，避免形成第二份可编辑真源。

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 小写字母开头，只含小写字母、数字与短横线；同时作为顶层命令名与文件名；`version`、`workspace`、`component`、`shell`、`help`、`rt`、`pg` 保留 |
| `version` | 是 | 非空字符串，只做相等比较，不解释语义 |
| `name`、`summary` | 是 | 展示用名称与一句话说明 |
| `kind` | 是 | `locus` 或 `external` |
| `requires` | 否 | 仅 `locus`；依赖的组件 id，不能重复或引用自身 |
| `capabilities` | 否 | 仅代码定义；本地 id、`resourceType`、`defaultAuthLevel`、`secrets`（slot/access）与 handler；不产生授权 |
| `credentials` | 否 | 仅代码定义；凭据槽数组：id 与 fields（name/secret/required）；不授予凭据，也不进入 YAML |
| `config` | 否 | 内联映射，或相对 `<dataDirectory>` 的文件/文件夹路径；Core 不解释内容 |
| `probe` | 否 | 仅 `external`；`kind` 为 `argv`（默认）、`tcp` 或 `http`，共同支持 `timeoutMs` 与 `onFailure` |
| `deploy` | 否 | `argv` 与 `timeoutMs`；缺少即 `not-deployable` |
| `info` | 否 | `text` 或 `json` 二选一；`locus <id> --json` 原样输出 `json` |

### 探针类型

| `kind` | 字段 | 判定 |
| --- | --- | --- |
| `argv` | `argv` | `ENOENT` 为 `absent`，退出 0 为 `healthy`，非零按 `onFailure`，超时为 `abnormal` |
| `tcp` | `host`、`port` | 连接成功为 `healthy`，拒绝或解析失败按 `onFailure`，超时为 `abnormal` |
| `http` | `url`、`expectStatus`（默认 200） | 状态码匹配为 `healthy`，不匹配或请求失败按 `onFailure`，超时为 `abnormal` |

```yaml
probe:
  kind: tcp
  host: 127.0.0.1
  port: 5432
  timeoutMs: 3000
  onFailure: stopped
```

`argv` 必须是字符串数组，直接交给 `execa`，不经过 shell，不展开变量；Windows 的 `.cmd`/`.bat` 由 `execa` 解析并转义。执行前先解析 PATH/PATHEXT，未找到时记为 `absent`。输出默认按 UTF-8 解码，带 BOM 或含 ASCII 片段的无 BOM UTF-16LE 会自动识别；纯中文 UTF-16 与 GBK 输出仍可能乱码，但状态码仍有效。未知字段、绝对路径、`..`、非法 URL 与非法端口在写入前拒绝。

## 物化与版本

1. 首次访问组件服务时，把包定义的描述性元数据写入 `<dataDirectory>/components/<id>.yaml`；`version` 一并写入。
2. 文件已存在时不自动改写。版本与代码一致则直接使用；不一致仍使用文件，并在 `list`/`show` 标记“需要升级”。
3. `component upgrade` 按代码重写描述性字段，保留文件中的 `config`，更新 `version`；只对 `locus` 组件生效。
4. 物化文件被删除后，下次访问按当前版本重建；文件非法时报错且不覆盖，删除后可重建。
5. 同名单文件与文件夹并存视为冲突，只影响该 id。

`list`、`show`、`probe`、`deploy` 读取物化文件的描述性元数据，并把包代码的能力与字段合并为只读视图；能力/字段契约不写回文件。`--help` 与 `version` 不访问组件服务，不创建数据目录。

YAML 物化只保存描述性元数据；`capabilities`/`credentials` 属于包代码契约，升级时保留 config 但不写回能力列表。capability 的 `secrets` 必须引用已声明字段槽，资源必须精确，不接受通配符。Core Security 的可信组件身份、Root 覆盖与精确绑定独立于可编辑 YAML，详见[安全服务](../../packages/core/README.md#安全服务)。`external` 不拥有可执行能力或凭据字段。

## 状态

外部状态只在显式 `probe` 时写入，读取不探测。未探查不落值，展示为“未探查”。`component list` 同时显示距最近观察的时长，避免把旧 `healthy` 当成当前事实。`component probe --all` 逐个探查 `external` 组件；没有探针的定义跳过，派生状态由依赖组件在读取时汇总。

| 状态 | 判定 |
| --- | --- |
| `healthy` | 探针退出 0；或 `requires` 的组件全部 healthy |
| `stopped` | 探针非零退出且声明 `onFailure: stopped` |
| `abnormal` | 探针非零退出的默认归类；超时也归入此类 |
| `absent` | 子进程返回 `ENOENT`；或依赖组件 absent |

`locus` 组件的状态由 `requires` 派生，不执行探针；依赖未登记时展示“未登记依赖”，不猜成 `absent`。依赖循环归为 `abnormal`。聚合优先级为 `absent` > `stopped` > `abnormal` > `healthy`。

部署状态由最近一次 `deploy` 决定：`deployed`、`failed`、`not-deployed`（已声明但未执行）、`not-deployable`（未声明）。

## 存储

```text
<dataDirectory>/
├─ core.sqlite                 # component_states：外部状态与部署状态
└─ components/                 # 组件定义实例
   ├─ template.yaml            # 包物化
   ├─ remote-targets.yaml      # 包物化；config 指向 remote-targets/
   ├─ docker.yaml              # 动态登记
   └─ postgres/
      ├─ component.yaml        # 文件夹形态
      └─ settings.yaml         # 组件自有配置
```

组件 YAML 是可复制、可手工编辑的元数据文件；`capabilities`/`credentials` 属于包代码的可信契约，不写入 YAML。状态保存在 `core.sqlite` 的 `component_states` 表，不随定义迁移。删除动态组件只删除定义与状态，不卸载、不停止外部软件。

多个动态定义可以直接复制到 `components/`（单文件或 `<id>/component.yaml`），不经过 `component add`；文件仍需满足定义 schema，损坏的定义进入 `problems`，不影响其他组件。

## 与远程目标的关系

`remote-targets` 是 `kind: locus` 组件，声明 `requires: [openssh]`、`register-private-key` / `register-password` / `private-key-access` / `password-access` 能力、SSH 私钥／密码字段槽与 `config: remote-targets/`。密钥认证在连接前要求 `openssh` 组件为 `healthy`，密码认证要求 `plink` 组件；未登记或状态未就绪时以 `component-unavailable` 失败。该检查不替代目标自身的能力、Core 绑定与凭据检查。

Remote Targets 依赖 Core 的 `CredentialRef` / `CapabilityFailure` 类型与能力上下文接口；CLI 组合根把组件状态投影成窄接口 `ComponentGate` 注入。

## 不变量

- 一个组件只有一份定义：包代码常量返回 `component` + `api` 两个视图，数据目录 YAML 只保存描述性元数据，不存在第二套能力注册表。
- 定义与状态分离：文件可复制，状态是本机观察。
- 读取不探测；`probe`、`deploy`、`upgrade` 都是显式动作。
- 登记不产生权限；组件状态不表示调用方被授权执行操作。
- 单个定义无效不阻断其他组件命令。
- 秘密值不进入定义、状态、JSON 或日志。

## 登记判据

组件不是软件普查。只登记满足至少一项的软件：有可区分的外部状态（可停、可缺、可不兼容）、是其他能力的门禁，或已有 Locus 操作入口。单纯查询版本的命令继续用原生命令，不进入 `.locus/components/`。

## 失败边界

| 场景 | 行为 |
| --- | --- |
| 未知字段、非法 id、非法 `argv`、路径逃逸 | `invalid-spec`，退出码 2 |
| 定义文件无法解析 | 该 id 进入 problems；`show` 失败并给出路径 |
| 动态组件 id 已存在或属于包 | `component-exists` 或 `component-package`，退出码 2 |
| 未声明探针 / 部署入口 | `no-probe` / `no-deploy`，退出码 2 |
| 探针未通过 | 写入对应状态，CLI 退出 1 |
| 部署失败 | 写入 `failed`，CLI 退出 1 |
| 传输组件未就绪 | `component-unavailable`，连接前失败 |

## 未实现

远程目标上的组件实例、`requires` 之外的依赖图、自动安装或服务启停、动态组件 CLI 包装、能力级状态、组件 Web/MCP 表面。新增这些能力前先确认存在真实消费方。
