# 子系统设计

本目录维护 `packages/` 模块构成的子系统的当前设计：职责边界、数据模型、关键流程、不变量与失败边界。模块 API 与用法在模块 README，决定理由与备选方案在 Agent Notes，组件依赖与交付面在[项目架构](../architecture.md)。

未实施子系统可以登记明确标注状态的设计大纲，完整方案仍由 `proposed` Agent Note 唯一维护；实现并验证后才把现行契约迁入所属页面，不将大纲视为交付证据。

目录按所有权分组：`core/` 存放 `packages/core` 自身的子系统，其余页面属于独立包与 CLI。统一调用协议跨 Core、组件、CLI 与远程目标：URI、operation 与 Dispatcher 归[统一资源调用](invocation.md)，授权与凭据模型归 [Core Security](core/security.md)，组件声明见[组件](core/components.md)，命令语法归[实用命令](../commands.md#安全与凭据)，远程目标见[远程目标](remote-targets.md)，失败如何跨层上浮归[错误处理机制](../errors.md)。

## Core 内子系统

| 子系统 | 设计 |
|---|---|
| 组件 | [组件](core/components.md) |
| 权限与凭据（Core Security） | [当前契约与平台证据](core/security.md)；带口令 SSH 私钥交付仍待决 |
| 统一资源调用 | [协议、operation、凭证、授权与事件](invocation.md) |

## 独立包子系统

| 子系统 | 设计 |
|---|---|
| 项目模板 | [项目模板](templates.md) |
| 命令行 | [CLI](cli.md) |
| 远程目标 | [远程目标](remote-targets.md) |
