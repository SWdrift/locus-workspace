# @locus/host-dsh

## 简述与职责

Cordis 插件，把 Locus core 装配进 DSH profile：创建 core、注册 `locus` 服务，并在插件 fiber 释放时释放 core。它只做宿主适配，不承载业务规则或界面。

## 使用前提

- DSH `0.2.1-rc.5` 的 profile，且已执行 `pnpm build`。
- 包以 `link:` 安装进项目内 profile；运行时的 `@locus/core` 由 workspace 链接解析。

## 使用

在 profile 的 `cordis.patch.yml` 插入插件行：

```yaml
- insert:
    - id: locus-host
      name: '@locus/host-dsh'
```

启动后其他插件可通过 `ctx.get('locus')` 读取服务。成功判据：`--dump-config` 中出现该行，启动时该行不处于未激活状态。

## 配置与契约

- 导出 `name = 'locus-host'` 与 `apply(ctx)`；没有配置项。
- 注册的服务名是 `locus`，形状为 `LocusService`，只暴露只读 `info`。
- 服务与 core 的生命周期跟随插件 fiber，卸载时自动移除并调用 `core.dispose()`。

## 失败与限制

服务名已被其他插件占用时，提供会失败并使该行无法激活。服务只暴露公开契约，调用方不能借它访问 core 内部对象。

## 扩展与实现边界

DSH/Cordis 依赖只出现在本包。新增宿主能力应扩展 `LocusService` 契约与 core 实现，而不是把 Cordis Context 或 core 内部类型传给插件。

## 验证依据

- 项目内 profile 实跑 `pnpm exec dsh --profile locus version` 输出 `0.0.0`、退出码 0（2026-11-06）。
- 独立 Cordis `Context` 加载本插件后读取 `ctx.get('locus').info.version` 得到 `0.0.0`，`ctx.fiber.dispose()` 正常完成（2026-11-06 实跑）。
