import { defineComponent } from '@locus/core'

/** 模板组件的定义；首次访问组件服务时物化到数据目录。 */
const template = defineComponent({
  id: 'template',
  version: '1',
  name: '项目模板',
  summary: '复制模板文件夹并记录来源',
  kind: 'locus',
  info: {
    text: [
      '复制内置或本地模板文件夹，并写入 .template.json 记录来源与 digest。',
      '目标目录必须不存在；不执行模板脚本。',
    ].join('\n'),
  },
})

export const component = template.component
export const api = template.api
