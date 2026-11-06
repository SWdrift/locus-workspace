# @locus/cli

## 简述与职责

Cordis 插件，提供 Locus 命令行的最小面：读取启动参数，打印 core 提供的版本。当前只有 `version` 命令，不承载其他业务操作或输出格式。

## 使用前提

- DSH profile 已加载 `@locus/host-dsh`，因此 `locus` 服务可用。
- `DSH_HOME` 指向项目内 `.dsh`，且已执行 `pnpm build`。

## 使用

```sh
DSH_HOME=.dsh pnpm exec dsh --profile locus version
```

成功判据：stdout 只有一行 `0.0.0`，退出码 0。

无参数或未知命令向 stderr 输出 `usage: dsh --profile locus version`，退出码 1。

## 配置与契约

- 导出 `name = 'locus-cli'` 与 `apply(ctx)`，注入 `locus`、`cmdlineArgs`、`appExit`。
- 只接受位置参数 `version`；`--version` 与 `-V` 属于 dsh 启动器，不会到达本插件。

## 失败与限制

依赖服务缺失时插件不会激活，也不会打印版本。当前不支持其他子命令，未知参数按用法错误处理。

## 扩展与实现边界

新增命令应扩展本插件或新增插件；命令必须通过 `locus` 服务读取 core 信息，不能实例化 core 或复制版本字面量。

## 验证依据

2026-11-06 在项目内 profile 实跑：

| 调用 | 观察结果 |
|---|---|
| `pnpm exec dsh --profile locus version` | stdout `0.0.0`，退出码 0 |
| 无参数 | stderr 用法提示，退出码 1 |
| `bogus` | stderr 用法提示，退出码 1 |
