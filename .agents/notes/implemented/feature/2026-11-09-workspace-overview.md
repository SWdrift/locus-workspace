# 决策记录：Workspace Overview 的跨能力组合

Status: implemented

## 问题

Workspace 已有 Filesystem、Git、Gitea、Session、Remote Machine 与 Connectivity 六项能力，但用户要理解一个 Workspace 的当前状态，仍需依次执行六个领域的查询并手工拼接。直接新增“Workspace 健康分数”或通用查询引擎会丢失来源，也会把已确认关系、本次观察、未确认建议和不可用状态压成同一种事实。

本轮要验证的是：这些能力能否在应用层组合成一个可操作视图，而不是继续增加领域插件、跨域数据仓库或新的持久化模型。

## 决定

### 入口与边界

新增 CLI 用例：

```text
workspace overview <workspace> [--observe]
```

它只组合公开服务与 Core 长期关系，不新增领域服务、中央 Capability Registry、通用 Graph Query Engine、Activity 对象或跨域数据库。CLI 仍只负责参数、编排、渲染与退出。

### 两种成本模式

默认模式只读取：

- Core Workspace、能力选择与长期关系。
- 已加载提供方、保存的提供方选择与当前是否加载。
- Filesystem 已保存位置。
- Remote Machine 资料/地址与 Connectivity Profile 摘要。
- 各领域已保存关联的引用与来源。

默认模式不访问原生文件、Git、Session、Gitea API 或 SSH；不把旧配置显示为在线状态。Gitea 仓库、Git 分支、Session 可访问性等显示为“未观察”。

`--observe` 才执行有界只读观察：

- Filesystem：每个已登记位置一次 `inspect`。
- Git：如果 Workspace 已选择 Git，每个位置执行一次 `git.inspect`；该调用同时提供 Filesystem 观察，避免重复读取。
- Session：对已保存关联执行 `inspectReference`，不读取 transcript。
- Gitea：每个关联仓库查询最近 Run（客户端上限 1）；能唯一对应本地 Git 时再按 `head_sha` 查询最多 3 条 Run。
- Connectivity：对关联机器的 Profile 执行 `ssh -G` 检查；FRP 仅探测既有 visitor 端口。

`--observe` 不执行 `machine observe`、`connect verify`、远程命令或 `connect open`，不启动 SSH/FRP visitor，不读取日志、Artifact、Secret 或环境变量。实时观察按独立来源并发执行；单段失败保留其他段的结果。输出包含每段耗时与总耗时。

### 事实分层

- **Confirmed**：来自 Core 的长期关系，以及 Plugin 已保存的位置/Profile/实例配置。配置存在不等于当前可达。
- **Observed**：本次 `--observe` 查询到的原生事实，带观察时间或明确状态。
- **Suggested**：Git Remote 与已登记 Gitea 实例产生的候选，不写入 Core。
- **Unknown / Unavailable**：未观察、提供方缺失、外部系统不可达或查询失败。

不计算单一 Workspace 健康分数。人类输出将已确认、本次观察、未确认建议和未知/不可用分开标记。

### 交互收敛

Overview 的后续操作直接生成自已交付命令，放在对应资源附近：

- `matched/empty`：说明当前提交没有匹配 Run，提供 `gitea runs` 与 `gitea run show`；不推断失败原因。
- `unmatched`：说明本地 Remote 与仓库完整名称不一致，提供 `gitea repo suggest`；不自动 link。
- 未确认 Gitea 候选：每个候选提供 `gitea repo link`。
- Machine 无 Profile：提供 `connect profile add <machine> default --target <ssh 地址>`；不再作为 attention。
- 没有 Session/Profile：保持普通信息，不报异常；Session 可选时提供 `session list`。
- 访问失败：提供 `gitea instance verify` 或 `connect verify` 等既有入口，不自动请求。
- 已保存关系但能力未选择：不发起该领域的 `--observe` 查询，显示 `not-observed` 并提供 `capability configure`；选择后才观察。

Attention 只保留需要用户处理或注意的问题。Gitea 的相同认证/网络错误按状态与错误合并为一条，列出受影响关联；插件未加载、未配置、凭据失败和原生资源不可访问分别表达。JSON 在每个资源项增加 `actions`，不新增通用领域模型。

### CI 与本地 HEAD

只有同时满足以下条件，Overview 才把 Gitea Run 与本地 Git HEAD 关联：

1. Workspace 已选择 Git，且观察到真实仓库。
2. 本地 Remote 与已登记实例、当前仓库完整名称一致。
3. 恰好一个本地仓库位置匹配。
4. 本地仓库有提交。

结果：

- 唯一匹配且无 Run → `matched/empty`。
- 本地无可用仓库/Remote → `no-local-git`。
- 有本地仓库但 Remote 不匹配 → `unmatched`。
- 多个本地仓库匹配 → `ambiguous`，不猜测。
- 尚无提交 → `no-commit`。

CI success 不代表部署成功；Overview 不建立 Machine 或部署关系。Connection Profile 已配置不代表连接成功；Session `persisted` 不代表 Agent 当前正在工作。这些语义在输出说明中保留。

## 验证

### 进程内与 profile

- `pnpm test:all`：95 个测试，94 通过，1 个既有平台跳过。
- 新增 CLI 用例覆盖：零资源 Workspace、默认不观察、`--observe` 的 Filesystem/Git/Gitea/Session/Machine/Connectivity、本地 HEAD 对应、`matched/empty` 与 `unmatched` 的不同下一步、未确认 Remote 候选、工作树 dirty、Gitea 401 时其他来源仍成功、同一错误合并、失败 CI、无 Profile 不误报、能力未选择时不请求、提供方全部缺失时长期关系保留。
- profile 冒烟通过：62 个独立 DSH 进程；包含最小 Workspace、多能力 Workspace、插件停用、重复 Overview 与长驻 shell 连续查询。
- profile 冒烟中的 Gitea 使用 fixture，不冒充真实实例。

### 真实 Gitea 1.25.5

- 实例：`http://localhost:9700`，登录 `CZXyee`，Actions 已启用。
- 真实 Overview（初始 2 个关联仓库）：
  - 交互收敛后默认模式 19ms；`--observe` 1078ms（Git/Gitea/Connectivity 仍为主要成本，处于与收敛前 6ms/1194ms 相同量级）。
  - `CZXyee/2608-freight-platform` 最近 Run #135 success，提交 `eef8ca…`。
  - `CZXyee/test` 最近 Run #15 success；历史 Run #14 单独查询为 `completed/failure`，提交 `a1b390…`。
  - 本地 HEAD `b168874…` 与 `2608` Remote 匹配，但没有对应 Run，Overview 报 `matched/empty`，没有伪造成成功或失败。
  - 扩展到 4 个关联仓库后：`2610` 有本地 Remote 但当前提交无 Run，报 `matched/empty`；`SW-Projects` 无对应 Remote，报 `unmatched`。`--observe` 耗时 1221ms。
  - 确认前 `other` Remote 的 2610 仓库以建议显示；显式关联后不再作为未确认建议。
  - 本地工作树修改后，Overview 报 `git-worktree-dirty`。
  - 移除启动环境凭据后再次观察：Filesystem/Git 仍为 `accessible`/`repository`，Gitea 关联报 `credential-missing`，没有把访问失败写成空 CI；同一错误的跨关联合并由进程内双关联用例验证。
  - Machine 没有 Profile 时显示 `Profile=未配置` 与 `connect profile add ...`，不进入 attention；`matched/empty` 显示无匹配 Run 与查看 Run 的入口。
  - 未观察到 token 出现在 JSON 或输出中。
- 真实 Session 查询为空：当前 `.dsh` 数据目录没有可关联 Session；多能力会话状态由 profile fixture 验证，不把空来源写成 live。
- 长驻 shell 连续执行默认、`--observe`、默认三次 Overview，共 3 行 JSON，同一 DSH 进程；观察耗时 557ms，未重复启动 DSH。
- 未执行 SSH `hostname`、`connect verify`、FRP 启动或远程命令；Connectivity 只做 `ssh -G` 检查。

### 限制

- `--observe` 仍是显式快照，不是持续刷新、后台同步或 Activity Timeline。
- 真实 Gitea 的四个关联仓库最近 Run 均为 success；失败 Run 的分类由历史 Run 详情与进程内 fake 覆盖，未为了测试触发或修改真实 CI。
- 未验证真实 Session 关联，因为当前数据目录没有 Session；Session 观察由 fixture 与包测试覆盖。
- 未新增 HMR 机制；本轮未单独把 Overview 的模块热替换写成已验证事实。
- 未实现 Nginx、Database、Project Management 或自动部署。

## 后果

- Workspace 获得一个跨能力、可读、可继续操作的入口；用户不必依次调用六组命令再手工拼接。
- 默认概览成本低；只有明确 `--observe` 才承担 Git/API/配置检查成本。
- 来源、时间和失败段保留，单个外部系统故障不会隐藏其他领域。
- 没有新增持久化或领域模型；后续 Web 应复用相同领域用例，不解析 CLI 文本。

## 备选方案

**建立统一 Workspace 健康分数。** 会把确认、观察、建议和缺失压成一个无法解释的数字；不采用。

**建立跨域查询引擎或数据仓库。** 当前只有 CLI 一个组合调用方，且各领域已有公开服务；不采用。

**默认执行全部观察。** 会让普通概览产生 Git/SSH/API 成本，并把配置状态误读为在线；不采用。

**把 Overview 结果持久化为 Activity。** 没有真实 Activity/Resume 调用方，且会引入第二套历史与过期语义；不采用。

## 后续

- 优先解决真实体验缺口：Gitea 最近 Run 与本地 HEAD 不一致时的用户操作路径、Session 空来源的引导、Profile 告警的可操作建议。
- Nginx/Database 只有在出现真实实例、授权与只读观察需求时再评估；不以 Overview 需要更多卡片为由提前建包。
- 若未来 Web 需要同一视图，复用各领域公开用例与 provenance 语义，不复制 CLI 渲染规则。
