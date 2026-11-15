# Gitea Compose

## 简述与职责

`@locus/gitea` 用一份 `defineComponent` 声明 `register` / `request` 能力、`api-token` 字段槽与 handler，并导出 `component` 与 `api`。它只向绑定 origin 发送 `Authorization: Bearer` 请求，不实现完整 Gitea 客户端，也不决定权限或持有令牌。身份、权限、凭据绑定与 Provider 归 [Core Security](../../docs/subsystems/core-security.md)。

## 使用

```ts
import { api, component } from '@locus/gitea'

const port = host.bindComponent(session, component)
await port.execute(
  { capability: 'register', resource: { type: 'gitea', id: 'local' }, parameters: {} },
  (context) => api.register(context, {
    credential: 'credential:gitea-local',
    token: 'secret-from-hidden-input',
  }),
)

const result = await port.execute(
  { capability: 'request', resource: { type: 'gitea', id: 'local' }, parameters: {} },
  (context) => api.request(context, {
    origin: 'https://gitea.example',
    path: '/api/v1/version',
    credential: 'credential:gitea-local',
  }),
)
```

`register` 是 Root 级、只写 token；`request` 是 User 级、只读 token。第一版 CLI 不暴露 Gitea 命令，组件 API 可供其他可信消费端使用。

## 契约与失败

- `api-token` 字段：`token` 秘密且必填；字段缺失或与声明不符以 `credential-fields-mismatch` 失败。
- URL 必须与 origin 同源，禁止调用方自带 `Authorization`。
- 使用 `redirect: 'manual'`，重定向不自动转发认证 Header。
- 返回 `response`、`authentication-failed`（401/403）或 `network-failed`；不透传 fetch 异常。
- 响应 body 由调用方读取或取消。
- 引用由 `@locus/config-reference` 校验；换成其他 `CredentialRef` 会以 `access-denied` / `credential-binding-mismatch` 失败。

## 验证

`pnpm --filter @locus/gitea test` 使用真实 Node fetch 与本地 HTTP 服务，检查 Header、跨源拒绝、重定向不转发、401/403 与网络失败；Provider 为显式内存实现。
