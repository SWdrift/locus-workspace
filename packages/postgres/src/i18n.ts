import { defineI18n } from '@locus/core/i18n'

export const i18n = defineI18n('postgres', {
  'component.summary': '通过 Core 绑定的目标与数据库字段建立驱动连接',
  'operation.database.register':
    '以路径 id 作为资源键登记或替换 PostgreSQL 连接凭据；JSON Body 必填 host、database、username，可选 port（字符串）；password 由可信输入提供；无 query。返回 registered:true 与凭据 reference。',
  'operation.database.query':
    '使用路径 id 绑定的 PostgreSQL 连接执行 SQL；JSON Body 必填 sql，可选 values（参数数组，对应 SQL 的 $1、$2 等占位符）；无 query。返回 JSON 兼容的 rows 数组与 rowCount。',
  'field.password': '指定 PostgreSQL 用户的连接密码；仅接受可信输入。',
  'query.connection-init-failed': 'PostgreSQL 连接初始化失败',
  'query.failed': 'PostgreSQL 查询失败：{{detail}}',
  'query.credential-incomplete': '数据库凭据缺少 host、database、username 或 password',
  'query.port-range': '数据库端口必须是 1 到 65535 的整数',
})
