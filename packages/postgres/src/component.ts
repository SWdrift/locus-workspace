import { defineComponent } from '@locus/core/components'
import { databaseAuth, queryDatabase, registerDatabase } from './operations.ts'

export const postgres = defineComponent({
  id: 'postgres',
  version: '4',
  name: 'PostgreSQL',
  summary: '使用 Core 绑定的可信目标与数据库字段建立驱动连接',
  kind: 'locus',
  credentials: [databaseAuth],
  operations: [registerDatabase, queryDatabase],
})

export const component = postgres.component
export const operations = postgres.operations
