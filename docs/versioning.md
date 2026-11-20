# 版本管理

本页维护仓库的版本唯一来源、构建时生成规则与改版本流程。构建与运行环境见[开发与验证](development.md)，命令调用见[实用命令](commands.md#workspace-操作)，取舍理由见[单一产品版本](../.agents/notes/implemented/process/2026-11-15-single-version.md)。

## 唯一来源

根 [package.json](../package.json) 的 `version` 是仓库唯一版本，所有构建产物、CLI 输出与组件定义都以它为准。

- 子包 `packages/*`、`components/*` 与 `apps/*` 的 `package.json` 不声明 `version`；它们不独立发版。
- 源码、文档与测试不写死版本字面量；需要判定版本时读取根 `package.json` 或 Core 的 `LOCUS_VERSION`。
- 版本值只要求非空字符串，脚本不校验 SemVer，也不解释语义。

## 构建时生成

`pnpm build` 先运行 [scripts/version.mjs](../scripts/version.mjs)，把根版本写入 `packages/core/src/version.generated.ts`：

```ts
// 由 scripts/version.mjs 从根 package.json 生成，请勿手工编辑。
/** Locus 产品版本，也是仓库唯一版本。 */
export const LOCUS_VERSION = "<根 package.json 的 version>"
```

- 生成文件被 `.gitignore` 排除，不入库，避免出现第二份真源；内容未变化时不重写。
- Core 从生成模块导出 `LOCUS_VERSION`，`createLocusCore().info.version` 读取该常量。
- CLI 的 `version` 输出 `info.version`，因此输出的是打包时的版本，运行时不解析仓库文件。
- 单独执行 `pnpm --filter @locus/core build` 也会先运行生成器；其他包依赖 Core 的构建产物。

## 修改版本

1. 只改根 `package.json` 的 `version`。
2. 执行 `pnpm build` 重新生成并编译。
3. 执行 `pnpm verify`，再确认输出：

```sh
pnpm locus version
# 输出根 package.json 的 version

pnpm locus --json version
# {"version":"<根 package.json 的 version>"}
```

不提供自动递增、发布或标签脚本；需要时再按真实发布流程补充。

## 失败与边界

- 生成文件缺失时直接编译 Core 会报模块不存在；先执行 `pnpm build`，不要手工创建该文件。
- 删除了生成文件不会丢失信息，下次构建按根 `package.json` 重建。
- 本仓库当前没有子包独立版本、版本兼容矩阵或运行时读取 `package.json` 的路径；引入前需新的决策记录。

验证入口：`pnpm verify`（构建、测试与文档检查）；版本行为的测试覆盖与真实 CLI 子进程用例见[测试系统](testing.md#分层与入口)。
