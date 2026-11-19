import { defineComponent } from '@locus/core/components'
import { i18n } from './i18n.ts'
import { createTemplateInstance, listTemplates } from './operations.ts'

/** 模板组件的定义；首次访问组件服务时物化到数据目录。 */
const template = defineComponent({
  id: 'template',
  version: '2',
  name: i18n.t('component.name'),
  summary: i18n.t('component.summary'),
  kind: 'locus',
  info: { text: i18n.t('component.info') },
  operations: [listTemplates, createTemplateInstance],
})

export const component = template.component
export const operations = template.operations
