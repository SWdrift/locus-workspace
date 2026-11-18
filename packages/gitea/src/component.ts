import { defineComponent } from '@locus/core/components'
import { apiToken, registerRepository, requestRepository } from './operations.ts'

const gitea = defineComponent({
  id: 'gitea',
  version: '5',
  name: 'Gitea',
  summary: '使用 Core 绑定的固定 origin 与令牌访问',
  kind: 'locus',
  operations: [registerRepository, requestRepository],
  credentials: [apiToken],
})

export const component = gitea.component
export const operations = gitea.operations
