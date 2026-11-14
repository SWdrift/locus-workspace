import { defineComponent } from '@locus/core'

/** 模板组件的定义；首次访问组件服务时物化到数据目录。 */
export const component = defineComponent({
  id: 'template',
  version: '1',
  name: '项目模板',
  summary: '复制模板文件夹并记录来源',
  kind: 'locus',
  info: {
    text: [
      'locus template list',
      'locus template create <template> <destination>',
      '',
      '目标目录必须不存在；模板源可以是内置 ID 或本地目录。',
      '创建后写入 .template.json 记录来源与 digest。',
    ].join('\n'),
  },
})
