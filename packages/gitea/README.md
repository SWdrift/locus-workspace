# Gitea Compose

## 简述与职责

`@locus/gitea` 用一份 `defineComponent` 声明 `gitea.repository.register` / `gitea.repository.request` operation、`api-token` 字段槽与 handler，并导出 `component` 与 `operations`。Root 在 `register` 时固定 origin 与 token；`request` 只使用绑定字段中的 origin 发送 `Authorization: Bearer`，调用者不能再指定 origin。它不实现完整 Gitea 客户端，也不决定权限或持有令牌。身份、权限、凭据绑定与 Provider 归 [Core Security](../../docs/subsystems/core/security.md)。

## 使用

```ts
import { createLocusCore } from '@locus/core'
import { component, operations } from '@locus/gitea'

const core = createLocusCore({ components: [{ component, operations }] })
```

`register` 是 `PUT gitea://repositories/<id>`，声明为 Root：固定 origin 并写入 token。`request` 是 `POST gitea://repositories/<id>/requests`，声明为 User：只读取该 `<id>` 的绑定字段。CLI 不提供 Gitea 专用命令，可通过 `locus post gitea://repositories/<id>/requests` 调用；完整 URI 规则见[统一资源调用](../../docs/subsystems/invocation.md)。

## 契约与失败

- `api-token` 字段：`origin` 公开且必填，`token` 秘密且必填；字段缺失或与声明不符以 `credential-fields-mismatch` 失败。
- URL 必须与登记 origin 同源，禁止调用方自带 `Authorization`；`origin` 在 Root 登记后固定。
- 使用 `redirect: 'manual'`，重定向不自动转发认证 Header。
- 返回 `response`、`authentication-failed`（401/403）或 `network-failed`；不透传 fetch 异常。
- 响应 body 由调用方读取或取消。
- 绑定键由本组件、slot `api-token` 与 URL 中的仓库 id 组成；替换 id 读取其他绑定或缺失绑定会失败。

## 验证

`pnpm --filter @locus/gitea test` 使用真实 Node fetch 与本地 HTTP 服务，检查 Header、跨源拒绝、重定向不转发、401/403 与网络失败；Provider 为显式内存实现。
