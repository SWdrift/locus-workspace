import { defineI18n } from '@locus/core/i18n'

export const i18n = defineI18n('template', {
  'component.name': '项目模板',
  'component.summary': '复制模板目录并记录来源',
  'component.info':
    '复制内置或本地模板目录，并写入 .template.json 记录来源与 digest。\n目标目录必须不存在；不执行模板脚本。',
  'operation.templates.list':
    '列出可用内置模板的摘要数组（id、name、sourceKind 及可选 version/description）；无路径参数、query 或 JSON Body。',
  'operation.templates.create':
    '从路径 id 指定的内置模板或本机模板目录创建实例；JSON Body 必填 destination（目标绝对路径），可选 dryRun:true 只预检不写入；无 query。返回模板摘要、目标路径、摘要 digest、文件与目录清单，以及实例记录路径 .template.json。',
  'operation.missing-id': '缺少路径参数 id',
  'engine.destination-exists': '目标已存在：{{destination}}',
  'engine.non-empty-string': '{{field}} 必须是非空字符串',
  'engine.read-path-failed': '无法读取路径 {{path}}：{{detail}}',
  'engine.read-file-failed': '无法读取 {{file}}：{{detail}}',
  'engine.invalid-json': '{{file}} 不是有效 JSON：{{detail}}',
  'engine.json-object-required': '{{file}} 必须是 JSON 对象',
  'engine.id-invalid': 'template.json id 只允许字母、数字、点、下划线和短横线，最长 64 字符',
  'engine.read-builtin-dir-failed': '无法读取内置模板目录 {{directory}}：{{detail}}',
  'engine.duplicate-builtin-id': '内置模板 ID 重复：{{id}}',
  'engine.template-not-found': '找不到模板：{{template}}',
  'engine.symlink': '模板包含符号链接：{{path}}',
  'engine.unsupported-entry': '模板包含不支持的文件类型：{{path}}',
  'engine.read-template-failed': '无法读取模板 {{directory}}：{{detail}}',
  'engine.destination-absolute': '目标必须是绝对路径',
  'engine.parent-missing': '目标父目录不存在：{{directory}}',
})
