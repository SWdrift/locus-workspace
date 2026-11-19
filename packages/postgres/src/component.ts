import { defineComponent } from '@locus/core/components'
import { i18n } from './i18n.ts'
import { databaseAuth, queryDatabase, registerDatabase } from './operations.ts'

export const postgres = defineComponent({
  id: 'postgres',
  version: '4',
  name: 'PostgreSQL',
  summary: i18n.t('component.summary'),
  kind: 'locus',
  credentials: [databaseAuth],
  operations: [registerDatabase, queryDatabase],
})

export const component = postgres.component
export const operations = postgres.operations
