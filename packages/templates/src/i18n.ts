import { defineI18n } from '@locus/core/i18n'

export const i18n = defineI18n('template', {
  'component.name': '项目模板',
  'component.summary': '管理模板库并复制模板目录',
  'component.info':
    '模板库位于数据目录 templates/<id>/，可直接编辑文件与 .template.json。\n内置模板只作兜底，用户模板同名遮蔽内置。\n从模板创建项目只复制字节，不写入实例记录。',
  'operation.templates.list':
    '列出用户模板与内置模板，返回 templates 与 problems；用户模板优先，同名遮蔽内置。无路径参数、query 或 Body。',
  'operation.templates.get': '读取路径 id 指定的模板元信息与当前内容摘要（digest、文件数、目录数）；不执行复制。',
  'operation.templates.register':
    '把 source 指定的目录复制进模板库；Body 必须提供 id，source.kind 为 path 或 builtin。已有用户模板同 id 时冲突。',
  'operation.templates.metadata': '只更新路径 id 对应模板的 .template.json：name、version、description；id 不可修改。',
  'operation.templates.remove': '删除路径 id 对应的用户模板；不删除已创建的项目。内置模板不能删除。',
  'operation.templates.create':
    '从路径 id 指定的模板复制到 destination；JSON Body 必填绝对路径 destination，可选 dryRun:true。\n只复制字节，不写 .template.json、不渲染、不执行 hook。',
  'operation.missing-id': '缺少路径参数 id',
  'engine.id-invalid': '模板 id 必须以小写字母开头，只包含小写字母、数字与短横线，最长 64 字符',
  'engine.template-exists': '用户模板已存在：{{id}}',
  'engine.template-builtin': '内置模板不能修改或删除：{{id}}',
  'engine.template-not-found': '找不到模板：{{template}}',
  'engine.source-not-found': '模板源目录不存在：{{path}}',
  'engine.metadata-id-mismatch': '.template.json id 必须为 {{expected}}，实际为 {{actual}}',
  'engine.metadata-unknown-field': '.template.json 包含未知字段：{{field}}',
  'engine.metadata-schema': '不支持的 .template.json schema：{{schema}}',
  'engine.metadata-field-invalid': '{{field}} 必须是非空字符串，最长 {{max}} 字符',
  'engine.destination-exists': '目标已存在：{{destination}}',
  'engine.read-store-dir-failed': '无法读取模板库目录 {{directory}}：{{detail}}',
  'engine.read-builtin-dir-failed': '无法读取内置模板目录 {{directory}}：{{detail}}',
  'engine.read-path-failed': '无法读取路径 {{path}}：{{detail}}',
  'engine.read-file-failed': '无法读取 {{file}}：{{detail}}',
  'engine.read-template-failed': '无法读取模板 {{directory}}：{{detail}}',
  'engine.invalid-json': '{{file}} 不是有效 JSON：{{detail}}',
  'engine.json-object-required': '{{file}} 必须是 JSON 对象',
  'engine.symlink': '模板包含符号链接：{{path}}',
  'engine.unsupported-entry': '模板包含不支持的文件类型：{{path}}',
  'engine.destination-absolute': '目标必须是绝对路径',
  'engine.parent-missing': '目标父目录不存在：{{directory}}',
})
