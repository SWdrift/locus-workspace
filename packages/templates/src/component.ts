import { defineComponent, defineOperation } from '@locus/core'
import { z } from 'zod'
import { createTemplateService } from './engine.ts'

/** 列出内置与本地模板；只读，不接触凭据。 */
const list = defineOperation({
  id: 'template.templates.list',
  method: 'GET',
  scheme: 'template',
  authority: 'templates',
  path: '',
  auth: 'user',
  input: z.undefined(),
  output: z.array(z.unknown()),
  async run() {
    return [...(await createTemplateService().list())]
  },
})

/** 在指定目标目录实例化模板；目标不存在时由服务层拒绝。 */
const create = defineOperation({
  id: 'template.templates.create',
  method: 'POST',
  scheme: 'template',
  authority: 'templates',
  path: '/:id/instances',
  auth: 'user',
  input: z.object({
    destination: z.string(),
    dryRun: z.boolean().optional(),
  }),
  output: z.unknown(),
  async run(_query, input, context) {
    const id = context.url.pathParams.id
    if (id === undefined) throw new Error('缺少路径参数 id')
    return createTemplateService().create(id, {
      destination: input.destination,
      ...(input.dryRun === true ? { dryRun: true } : {}),
    })
  },
})

/** 模板组件的定义；首次访问组件服务时物化到数据目录。 */
const template = defineComponent({
  id: 'template',
  version: '2',
  name: '项目模板',
  summary: '复制模板文件夹并记录来源',
  kind: 'locus',
  info: {
    text: [
      '复制内置或本地模板文件夹，并写入 .template.json 记录来源与 digest。',
      '目标目录必须不存在；不执行模板脚本。',
    ].join('\n'),
  },
  operations: [list, create],
})

export const component = template.component
export const operations = template.operations
