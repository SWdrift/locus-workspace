# 决策记录：CLI 重依赖按命令边界延迟加载

Status: implemented

## 问题

CLI 每个命令启动时都静态导入全部组件包。实测 `locus version` 加载 296 个文件模块、约 0.39s；其中 `execa` 111 个文件、`yaml` 72 个、`pg` 及其协议与类型约 27 个。`version`、`--help` 与 Workspace 命令不执行探针、不连接 PostgreSQL、也不读写组件定义，却承担同一笔固定导入成本。

## 决定

- `@locus/core` 的组件 runner 在探针或部署执行边界动态导入 `execa`。
- `@locus/postgres` 的 `list` 在建立连接前动态导入 `pg`。
- `yaml` 通过 `createRequire` 在首次解析或序列化组件定义时同步加载，保持 `parseComponent` 等现有同步契约。
- `@locus/remote-targets` 的系统客户端执行与 Windows ACL 加固同样延迟导入 `execa`；`targets.yaml` 的读写使用同一类同步懒加载。

## 备选方案

**只给 `version` 与 `--help` 加快速路径。** 预计只再省 30–50ms，但需要复制命令树或拆分组合根；当前收益不足以证明重复契约的成本，放弃。

**用打包器生成单文件 CLI。** 可进一步减少 ESM 解析与 Windows 文件 stat，但引入额外构建工具、source map 与原生模块外置维护；当前启动已接近 Node 基线，暂不采用。

**整体延迟加载组件包。** 需要按命令域推导哪些组件定义参与 Core 装配，`workspace` 与未知顶层组件回退的边界更复杂；先保留组合根的所有包导入，只延迟包内重依赖。

## 后果

- `locus version` 实测从约 0.39s 降到 0.14–0.18s，文件模块从 296 降到 47；普通命令不再加载 `execa`、`yaml` 与 `pg`。
- 首次 `component probe`/`deploy`、`pg list`、组件或 targets YAML 读写会多承担一次动态导入或 `require` 成本。
- `yaml` 仍走同步加载；若未来改为异步解析，需要同时调整 `parseComponent` 等调用方。
- 验证入口为 `pnpm verify`（190 个用例通过）与真实 `locus version` 启动计时；`pg` 动态导入的 `Pool` 命名导出已确认可用。
