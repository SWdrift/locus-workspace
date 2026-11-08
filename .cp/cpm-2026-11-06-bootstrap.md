# CPM Bootstrap

`cp-2026-11-06-bootstrap.md` 的记忆文件，只保存该控制面后续仍需的已核实选择与约束；不保存一次性进度或项目级通用经验。DSH 插件开发的通用形态、生命周期、坑点与失败现象由[DSH 插件开发](../docs/references/dsh-plugin-development.md)唯一维护，不在此复述。

## 项目内运行时选择

- 项目内 dsh 使用根 devDependency `@deepseek-ai/dsh@0.2.1-rc.5`，命令一律 `pnpm exec dsh`；机器全局存在同版本 `dsh`，不能用来判断项目内行为。
- `DSH_HOME` 固定为仓库内 `.dsh/`，profile 名 `locus`，不读写 `~/.dsh`。
- profile 安装实际 Plugin 的 `link:` 依赖，当前安装入口见[开发与验证](../docs/development.md#宿主运行)；Core/contracts 由 workspace 链接解析，不重复装进 profile，不维护固定“只有两个插件”的限制。
- 插件行写入 `.dsh/profiles/locus/cordis.patch.yml`，不使用 bundle 层；`dsh plugin add` 会提示 `declares no dsh.bundle`，属预期。
- pnpm 首次安装把原生依赖构建写入 `pnpm-workspace.yaml` 的 `allowBuilds`；这些条目是安装成功所需，不应删回占位字符串。

## 构建与 tsconfig

- `tsconfig.base.json` 对齐 DSH 上游：`target es2024`、`module esnext`、`moduleResolution bundler`、`rewriteRelativeImportExtensions`，以及 strict / noUncheckedIndexedAccess / exactOptionalPropertyTypes / noUnused* 等检查。
- 构建使用 `tsc -b tsconfig.json`；根 `tsconfig.json` 只做 solution 引用，各包 composite 并输出到 `lib/`。
- 包之间不做 TS path 别名，依赖 workspace 包名与构建顺序；新增包必须同时加入根 references 与消费者的 `workspace:*` 依赖，否则 `tsc -b` 不会构建它。
- 产物中的 package 导入由 Node 解析；相对导入写 `.ts` 后缀，由 `rewriteRelativeImportExtensions` 改写为 `.js`。改 tsconfig 后必须实跑 profile 验证，不只跑 typecheck。

## 归属边界

- 插件开发事实、坑点、版本差异：写入 DSH 插件开发参考文档。
- 项目内选择、构建约束、控制平面执行规则：留在 `cp-2026-11-06-bootstrap.md` 或本文件。
- 一次性进度与计划：留在 CP 任务区，阶段收尾时删除。
