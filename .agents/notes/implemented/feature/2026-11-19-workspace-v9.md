# 决策记录：Workspace 名称唯一、描述与 primary 挂载

Status: implemented

## 问题

Workspace 名称此前只要求非空，重名时靠“唯一名称或 UUID”消歧；没有描述字段；多个挂载中 shell 固定取第一个可访问目录。随着 Workspace 被当作项目语境使用，名称需要可稳定引用，项目需要一句描述，shell 需要一个显式的默认根目录，而不是依赖插入顺序。

## 决定

Core schema 升到 v9，Workspace 增加 `name_key` 与 `description`，挂载增加 `is_primary`。

名称在 `trim` 后精确匹配并唯一；长度为 1–64 字符，不允许控制字符。创建或更新时冲突返回 `conflict`。引用先按 UUID，再按精确名称。

`description` 可选，最长 500 字符；`PATCH` 传空字符串清空。

每个 Workspace 最多一个 `primary` 挂载。`locus shell` 优先使用 primary；primary 不可访问时报告 `primaryMissing` 并回退到第一个可访问挂载；没有 primary 时同样取第一个可访问挂载；没有可访问挂载时使用用户主目录。`LOCUS_MOUNTS` 与 `--print-env` 包含 `primary` 与 `primaryMissing`。

Workspace URL 根从 `locus://workspaces` 改为 `locus://ws`；operation id 改为 `locus.ws.*`。`PATCH locus://ws/<id>` 同时更新名称与描述；新增 `PATCH locus://ws/<id>/mounts/<mount>` 更新挂载名称或 primary。

## 备选方案

**名称按 lowercase 唯一。** 能让 `Demo` 与 `demo` 冲突，但 SQLite `lower()` 只处理 ASCII，迁移时与 JS `toLowerCase()` 对非 ASCII 字符不一致；采用 trim 后精确匹配，避免迁移产生与运行时不同的唯一键。

**新增单一 `root` 字段。** 能表达项目根，但与挂载路径重复，且丢失多目录能力；在挂载上增加 `primary` 标记。

**自动把第一个挂载设为 primary。** 能减少配置，但插入顺序仍会决定默认 cwd；保持显式 primary，未设置时回退第一个可访问挂载。

**把 Workspace 扩展成完整 Project 表。** 能承载仓库与 CI 坐标，但当前需求只到名称、描述与挂载；模板与 Workspace 仍独立，不提前引入项目实体。

**删除旧 `locus://workspaces` 时保留别名。** 能让旧脚本继续工作，但会形成两条路由和帮助噪声；按当前本地产品阶段直接切换，旧数据不受影响。

## 后果

收益：Workspace 名称可直接引用且不再歧义；描述提供项目语境；shell 的默认 cwd 可显式指定并有可观察回退；URL 更短。

代价：v8→v9 迁移遇到重复名称会失败并要求先改名；旧 `locus://workspaces` URL 与 `locus.workspaces.*` operation id 不再可用；primary 是可选配置，未设置时行为仍是第一个可访问挂载；挂载路径仍不检查存在性。

迁移脚本位于 `temp/migrations/core-v8-to-v9.sql`，不入库、不进入运行时；升级前仍要求停止写者并备份整个数据目录。

## 测试

`packages/core/test/core.test.mjs` 覆盖名称唯一、描述更新与清空、primary 设置/清除、每 Workspace 最多一个 primary、级联删除与迁移后的表结构检查；`apps/cli/test/cli.test.mjs` 覆盖 `locus://ws`、名称冲突、描述更新、primary cwd、primaryMissing 回退与 shell 上下文。`pnpm test` 与 `pnpm docs:check` 为验证入口。
