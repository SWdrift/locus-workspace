# @locus/core

## 简述与职责

独立 TypeScript 领域内核的第一层。当前定义产品版本与 core 生命周期，不依赖 DSH、Cordis、宿主或 UI。后续工作空间能力在此扩展，宿主适配留给 `@locus/host-dsh`。

## 使用前提

- Node.js 24 或更高，ESM。
- 只依赖 `@locus/contracts`，无第三方运行时依赖。

## 使用

```ts
import { createLocusCore } from '@locus/core'

const core = createLocusCore()
console.log(core.info.version) // 0.0.0
await core.dispose()
```

成功判据：`core.info.version` 等于 `LOCUS_VERSION`；`dispose()` 完成后不留下需要手动清理的资源。

## 配置与契约

- `LOCUS_VERSION` 是产品版本的唯一来源，当前为 `0.0.0`。
- `createLocusCore()` 返回 `LocusCore`：`info` 是冻结的只读对象，`dispose()` 返回 Promise。
- 没有配置项、环境变量或持久状态。

## 失败与限制

当前没有 I/O、配置或持久化，`dispose()` 只是生命周期占位。版本变化需要修改 `LOCUS_VERSION` 并重新构建所有依赖包。

## 扩展与实现边界

宿主通过 `LocusService` 暴露 core 能力；core 不能 import Cordis、DSH、UI 或具体插件，也不能把内部实现类型泄漏给插件。

## 验证依据

- `pnpm build` 退出码 0，生成 `packages/core/lib/index.js` 与类型声明（2026-11-06）。
- Node 冒烟：`import('./packages/core/lib/index.js')` 后 `createLocusCore().info.version` 输出 `0.0.0`（2026-11-06 实跑）。
