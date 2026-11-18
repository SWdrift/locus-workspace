# PostgreSQL Compose

> 临时验证消费者：本包用于验证权限平面的真实数据库交付路径，不是长期产品包。权限控制面验证完成后移除，并同步清理 CLI、测试与文档引用。

## 简述与职责

`@locus/postgres` 用一份 `defineComponent` 声明 `pg.database.register` / `pg.database.query` operation、`database-auth` 字段槽与 handler，并导出 `component` 与 `operations`。Root 在 `register` 时固定 host/port/database、用户名与密码；`query` 只使用 Core 绑定字段中的目标，调用者不能替换 host、port 或 database。它把合并后的字段放入驱动参数，不构造包含密码的连接 URL，不实现数据库服务器或迁移工具。身份、权限、凭据绑定与 Provider 归 [Core Security](../../docs/subsystems/core/security.md)。

## 源码导航

源码入口：[组件声明](src/component.ts)、[operation](src/operations.ts)、[查询与驱动释放](src/query.ts)、[DTO](src/types.ts)及[schema](src/schemas.ts)。行为验证在[包测试](test/postgres.test.mjs)；该包仍是临时消费者，不建立长期连接池平台。

## 使用

```ts
import { createLocusCore } from '@locus/core'
import { component, operations } from '@locus/postgres'

// CLI/组合根把 component 与 operations 交给 createLocusCore()
const core = createLocusCore({ components: [{ component, operations }] })
```

`register` 是 `PUT pg://databases/<id>`，声明为 Root：写入 `database-auth` 的公开目标字段与秘密密码，返回稳定 `CredentialRef`。`query` 是 `POST pg://databases/<id>/queries`，声明为 User：只读取该 `<id>` 的绑定字段，使用新的 `pg.Pool` 执行查询并在 `finally` 中 `end()`。CLI 命令入口由 `apps/cli` 维护，见[命令手册](../../docs/commands.md#安全与凭据)；普通 User 使用不触发 Root。

## 契约与失败

- `database-auth` 字段：`host`、`port`、`database`、`username` 公开，`password` 秘密；字段缺失或与声明不符以 `credential-fields-mismatch` 失败。`query` 不接受连接目标参数。
- `register` 只能调用 `context.credential.write`；`query` 只能调用 `context.credential.read`。
- 绑定键由本组件、slot `database-auth` 与 URL 中的数据库 id 组成；替换 id 读取其他绑定或缺失绑定会失败。
- 密码只进入驱动参数；不形成 `connectionString`，不写入日志或结果。连接初始化或查询失败映射为 `unavailable`。
- 驱动可能复制密码；本包不清零驱动内部内存。

## 验证

`pnpm --filter @locus/postgres test` 使用内存 Provider 与注入的 Pool 工厂，检查字段交付、无密码 URL、释放与错误引用。真实数据库消费：

```sh
node packages/postgres/test/manual-postgres.mjs
```

脚本在临时目录启动 PostgreSQL 16、使用 scram-sha-256 主机认证，验证无密码登录被拒绝，再由 Core 交付字段并执行 `select`；缺少 PostgreSQL 可执行文件时以非零明确阻塞。
