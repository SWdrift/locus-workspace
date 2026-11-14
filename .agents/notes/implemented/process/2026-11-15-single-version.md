# 决策记录：单一产品版本，构建时生成到 Core

Status: implemented

## 问题

仓库原先在根 `package.json`、四个子包 `package.json` 与 Core 源码的 `LOCUS_VERSION` 字面量里各写一份 `0.0.0`。改版本要同时改多处，漏改不会报错，CLI 的 `version` 输出也可能与包元数据不一致。组件定义又把 `version` 当作独立递增的组件级版本，进一步制造了第二套版本语义。

当前没有独立发布子包或按包兼容的需求，维护多个版本号只有成本。

## 决定

- 版本只在根 `package.json` 的 `version` 维护；子包 `package.json` 不再声明 `version`，仓库内也不自定组件版本。
- `pnpm build` 先运行 [scripts/version.mjs](../../../../scripts/version.mjs)，把根版本写成 `packages/core/src/version.generated.ts`；该文件被 `.gitignore` 排除，不手工编辑。
- Core 从生成模块导出 `LOCUS_VERSION`，`createLocusCore().info.version` 与 `locus version` 都读它，因此命令输出的是打包时的版本，而不是运行时重新读取仓库文件。
- 包组件的定义物化时写入同一产品版本；`upgrade` 比较产品版本，不再由维护者单独递增组件版本。外部组件的 `version` 仍只标识用户自己的定义。

验证：把根版本临时改为 `9.9.9-smoke` 后执行 `pnpm build`，`node apps/cli/lib/index.js version` 与 Core 的 `LOCUS_VERSION` 同时输出该值；恢复 `0.0.0` 并重建后回到原值。`pnpm test` 的版本断言改为与根 `package.json` 比较。

## 备选方案

**运行时读取 `package.json`。** 可以让版本与仓库文件永远一致，但 Core 构建产物要反向定位仓库根，安装或打包后位置不再成立，也违背“打包时的版本”这一要求。

**继续手写字面量，只加一致性测试。** 能发现漂移，但每次改版本仍需改两处，测试只能报警不能消除重复真源。

**子包各自维护版本。** 在需要独立发布与兼容矩阵前没有消费端；当前只会让“产品版本”与“包版本”并列，增加解释成本。

## 后果

改版本只改根 `package.json` 一处，构建产物与 CLI 输出必然同步。代价是版本变更必须重新构建才会体现，`version.generated.ts` 缺失时首次构建前 TypeScript 会报模块不存在；子包因此没有可发布的独立版本，未来若需要分别发版，必须显式引入新的版本策略而不是恢复今天的字面量。
