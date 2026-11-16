# 子系统设计

本目录维护 `packages/` 模块构成的子系统的当前设计：职责边界、数据模型、关键流程、不变量与失败边界。模块 API 与用法在模块 README，决定理由与备选方案在 Agent Notes，组件依赖与交付面在[项目架构](../architecture.md)。

未实施子系统可以登记明确标注状态的设计大纲，完整方案仍由 `proposed` Agent Note 唯一维护；实现并验证后才把现行契约迁入所属页面，不将大纲视为交付证据。

权限系统跨 Core Security、组件、CLI 与远程目标：模型以 Core Security 为入口，组件声明见[组件](components.md)，CredentialRef 解析归 Core Security，命令语法归[实用命令](../commands.md#安全与凭据)，远程目标见[远程目标](remote-targets.md)。

| 子系统 | 设计 |
|---|---|
| 项目模板 | [项目模板](templates.md) |
| 命令行 | [CLI](cli.md) |
| 远程目标 | [远程目标](remote-targets.md) |
| 组件 | [组件](components.md) |
| 权限与凭据（Core Security） | [当前契约与平台证据](core-security.md)；带口令 SSH 私钥交付仍待决 |
