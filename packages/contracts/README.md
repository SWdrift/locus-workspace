# @locus/contracts

## 简述与职责

Locus 插件与宿主共享的公开类型契约。它只声明服务形状与只读数据，不包含可执行逻辑、版本值或生命周期，避免 core、宿主和插件互相引用实现。

## 使用前提

- TypeScript 项目，通过 workspace 依赖引用。
- 包从构建产物 `lib/` 提供类型与空的 ESM 入口；运行时不需要导入它。

## 使用

```ts
import type { LocusService } from '@locus/contracts'

function readVersion(locus: LocusService): string {
  return locus.info.version
}
```

成功判据：TypeScript 能解析 `LocusService`；编译后的代码不保留该导入。

## 配置与契约

`LocusInfo` 暴露只读的 `version`；`LocusService` 暴露只读的 `info`。没有默认值、环境变量或配置项。

## 失败与限制

修改接口属于破坏性契约变更，必须同步实现与消费方。本包不做运行时校验，形状不符只会在消费方使用字段时暴露。

## 验证依据

`pnpm build` 生成 `packages/contracts/lib/index.d.ts` 与 `lib/index.js`，退出码 0（2026-11-06 实跑）。没有独立运行时行为可测。
