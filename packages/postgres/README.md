# PostgreSQL Compose

> 临时验证消费者：本包用于验证权限平面的真实数据库交付路径，不是长期产品包。权限控制面验证完成后移除，并同步清理 CLI、测试与文档引用。

## 简述与职责

`@locus/postgres` 用一份 `defineComponent` 声明 `register` / `list` 能力、`database-auth` 字段槽与 handler，并导出 `component` 与 `api`。Root 在 `register` 时固定 host/port/database、用户名与密码；`list` 只使用 Core 绑定字段中的目标，调用者不能替换 host、port 或 database。它把合并后的字段放入驱动参数，不构造包含密码的连接 URL，不实现数据库服务器或迁移工具。身份、权限、凭据绑定与 Provider 归 [Core Security](../../docs/subsystems/core-security.md)。

## 使用

```ts
import { Pool } from 'pg'
import { api, component } from '@locus/postgres'

// CLI/组合根：绑定可信组件后执行一次能力
const port = host.bindComponent(session, component)
await port.execute(
  { capability: 'register', resource: { type: 'database', id: 'local' }, parameters: {} },
  (context) => api.register(context, {
    credential: 'credential:postgres-local',
    host: '127.0.0.1',
    port: '5432',
    database: 'app',
    username: 'app',
    password: 'secret-from-hidden-input',
  }),
)

const result = await port.execute(
  { capability: 'list', resource: { type: 'database', id: 'local' }, parameters: {} },
  (context) => api.list(context, {
    credential: 'credential:postgres-local',
    sql: 'select 1',
  }),
)
```

`register` 是 Root 级，固定目标并写字段；`list` 是 User 级，只读取绑定字段。CLI 命令入口由 `apps/cli` 维护，见[命令手册](../../docs/commands.md#安全与凭据)；普通 User 使用不触发 Root。

## 契约与失败

- `database-auth` 字段：`host`、`port`、`database`、`username` 公开，`password` 秘密；字段缺失或与声明不符以 `credential-fields-mismatch` 失败。`list` 不接受连接目标参数。
- `register` 只能调用 `registerCredential`；`list` 只能调用 `withCredential`。
- 密码只进入驱动参数；不形成 `connectionString`，不写入日志或结果。
- `createPostgresPool` 返回的 lease 在 `dispose()` 时调用驱动 `end()`，清除可控参数引用；释放后读取 `pool` 以 `delivery-failed` 失败。
- `credential` 引用由 Core 的 `parseCredentialRef` 校验；换成其他引用会以 `access-denied` / `credential-binding-mismatch` 失败。
- 驱动可能复制密码；本包不清零驱动内部内存。

## 验证

`pnpm --filter @locus/postgres test` 使用内存 Provider 与注入的 Pool 工厂，检查字段交付、无密码 URL、释放与错误引用。真实数据库消费：

```sh
node packages/postgres/test/manual-postgres.mjs
```

脚本在临时目录启动 PostgreSQL 16、使用 scram-sha-256 主机认证，验证无密码登录被拒绝，再由 Core 交付字段并执行 `select`；缺少 PostgreSQL 可执行文件时以非零明确阻塞。
