# 决策记录：CLI 按包与组件子系统延迟加载

Status: implemented

## 问题

CLI 原先在每个命令启动时静态导入全部组件包与 Core 组件服务。实测 `locus version` 加载 296 个文件模块、约 0.39s；其中 `execa` 111 个文件、`yaml` 72 个、`pg` 及其协议与类型约 27 个。`version`、`--help`、Workspace 与安全命令不执行探针、不连接 PostgreSQL、也不读写组件定义，却承担同一笔固定导入成本。

## 决定

- CLI 入口先按顶层命令确定包域，再动态导入需要的组件包：`pg` 只加载 PostgreSQL，`remote-targets`/`rt` 只加载 Remote Targets，`template` 只加载 Templates，`component`、`security capability` 与未知顶层组件入口加载全集。包内依赖随包一起静态加载，例如 `pg` 随 PostgreSQL、`execa` 与 `yaml` 随 Remote Targets。
- CLI 传入 Core 的组件定义只包含当前包域已加载的包；未知顶层命令按全集处理，保留 `locus <id>` 回退。
- Core 的组件服务改为首次访问 `locus.components` 时同步加载；Workspace、安全与版本命令不加载组件定义、探针执行器或 YAML。
- `parseComponent` 保留在 Core 公共入口，但只在首次调用时加载 YAML 解析模块；`defineComponent`、`ComponentFailure` 与类型留在无 YAML 的模块中。
- 命令处理函数在动作边界动态导入所属包 API；同一包已被入口预加载时命中 ESM 缓存。
- 不再为单个依赖在包内做细粒度动态导入；延迟边界统一到包与 Core 组件子系统。

## 备选方案

**按依赖逐个延迟导入。** 启动数字接近，但把 `execa`、`yaml`、`pg` 的加载时机分散到包内部，调用点与错误边界变多；按包边界收拢后，包的依赖关系保持静态可读。

**只给 `version` 与 `--help` 加快速路径。** 预计只再省 30–50ms，但需要复制命令树或拆分组合根，放弃。

**用打包器生成单文件 CLI。** 可进一步减少 ESM 解析与 Windows 文件 stat，但引入额外构建工具、source map 与原生模块外置维护；当前启动已接近 Node 基线，暂不采用。

## 后果

- `version` 与 Workspace 命令实测 0.12–0.15s，启动图从 296 个文件降到 28 个；`remote-targets list` 实测 0.33–0.40s、254 个文件，`component list` 实测约 0.48s、299 个文件。
- 包级命令会一次承担该包的全部依赖成本；`remote-targets` 与 `component` 不再享受细粒度延迟。
- Core 在创建时不再立即校验包组件定义；首次访问组件服务或构造命令域服务时校验。`version` 与 `--help` 仍不物化组件。
- 安全能力列表需要全部包定义，因此 `security capability` 与 `component` 使用全集加载；普通 `security status` 不加载组件包。
- 验证入口为 `pnpm verify`（190 个用例通过）与真实启动计时；`pg` 的 `Pool`、Remote Targets 的 `execa` 与 YAML 在包加载后仍按原静态契约工作。
