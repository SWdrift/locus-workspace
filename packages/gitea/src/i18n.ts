import { defineI18n } from '@locus/core/i18n'

export const i18n = defineI18n('gitea', {
  'component.summary': '通过 Core 绑定的固定 origin 与令牌访问 Gitea API',
  'operation.repository.register':
    '以路径 id 作为资源键登记或替换 Gitea API 凭据；JSON Body 必填 origin（仅含协议、主机和端口的 HTTP/HTTPS 源站）；token 由可信输入提供；无 query。返回 registered:true 与凭据 reference。',
  'operation.repository.request':
    '使用路径 id 绑定的 Gitea 凭据发起同源请求；JSON Body 必填 path（可含上游 query），可选 method（默认 GET）、headers（不得含 Authorization）与 body（文本）；本操作无 query。返回 kind=response 及 status、筛选后的 headers、文本 body，或 authentication-failed（401/403）、network-failed；不跟随重定向。',
  'field.token': '绑定到 origin 的 Gitea API 令牌；仅接受可信输入，请求时作为 Bearer 凭据使用。',
  'redaction.token': '[已脱敏]',
})
