import { defineComponent } from '@locus/core/components'
import { i18n } from './i18n.ts'
import { apiToken, registerRepository, requestRepository } from './operations.ts'

const gitea = defineComponent({
  id: 'gitea',
  version: '5',
  name: 'Gitea',
  summary: i18n.t('component.summary'),
  kind: 'locus',
  operations: [registerRepository, requestRepository],
  credentials: [apiToken],
})

export const component = gitea.component
export const operations = gitea.operations
