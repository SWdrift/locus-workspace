import { z } from 'zod'
import { defineOperation, operationMetadataSchema } from '../invocation/operation.ts'
import type { OperationDefinition } from '../invocation/types.ts'
import type { ComponentList, ComponentProbeAll, ComponentRemoval, ComponentsService, ComponentView } from './types.ts'

const componentCredential = z.object({
  id: z.string(),
  fields: z.array(
    z.object({
      name: z.string(),
      secret: z.boolean(),
      required: z.boolean(),
    }),
  ),
})
const componentInfo = z.union([z.object({ text: z.string() }).strict(), z.object({ json: z.json() }).strict()])
const componentView: z.ZodType<ComponentView> = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  kind: z.enum(['locus', 'external']),
  version: z.string(),
  codeVersion: z.string().optional(),
  needsUpgrade: z.boolean(),
  requires: z.array(z.string()),
  operations: z.array(operationMetadataSchema).optional(),
  credentials: z.array(componentCredential).optional(),
  source: z.enum(['package', 'dynamic']),
  definitionPath: z.string(),
  configPath: z.string().optional(),
  info: componentInfo.optional(),
  external: z
    .object({
      state: z.enum(['healthy', 'stopped', 'abnormal', 'absent']).nullable(),
      detail: z.string(),
      checkedAt: z.string().optional(),
      source: z.enum(['probe', 'derived']),
    })
    .optional(),
  deploy: z.object({
    state: z.enum(['deployed', 'failed', 'not-deployed', 'not-deployable']),
    detail: z.string(),
    checkedAt: z.string().optional(),
  }),
})
const componentList: z.ZodType<ComponentList> = z.object({
  components: z.array(componentView),
  problems: z.array(
    z.object({
      id: z.string(),
      source: z.enum(['package', 'dynamic']),
      path: z.string(),
      error: z.string(),
    }),
  ),
})
const componentRemoval: z.ZodType<ComponentRemoval> = z.object({
  component: z.string(),
  removed: z.literal(true),
})
const componentProbeAll: z.ZodType<ComponentProbeAll> = z.object({
  probed: z.array(componentView),
  skipped: z.array(z.object({ id: z.string(), reason: z.string() })),
})
const componentSource = z.union([z.object({ text: z.string() }), z.object({ path: z.string() })])

/** 组件资源只依赖服务访问器，保留 Core 的惰性组件装配。 */
export function createComponentOperations(
  components: () => ComponentsService,
): readonly OperationDefinition<any, any, any>[] {
  return [
    defineOperation({
      id: 'locus.components.list',
      summary: '列出已登记组件、最近观察状态与定义问题；无需 Body 或 query，不主动探查。',
      method: 'GET',
      scheme: 'locus',
      authority: 'components',
      path: '',
      auth: 'user',
      input: z.undefined(),
      output: componentList,
      run: () => components().list(),
    }),
    defineOperation({
      id: 'locus.components.get',
      summary: '按路径 id 读取组件完整说明、operation 与最近观察状态；无需 Body 或 query。',
      method: 'GET',
      scheme: 'locus',
      authority: 'components',
      path: '/:id',
      auth: 'user',
      input: z.undefined(),
      output: componentView,
      run: (_query, _input, context) => components().show(context.url.pathParams.id ?? ''),
    }),
    defineOperation({
      id: 'locus.components.register',
      summary: '登记 external 组件；Body 提供 text（YAML 内容）或 path（本机 YAML 文件路径）。',
      method: 'POST',
      scheme: 'locus',
      authority: 'components',
      path: '',
      auth: 'user',
      input: componentSource,
      fields: {
        text: { description: 'external 组件的完整 YAML 定义；与 path 任择其一。', required: false },
        path: { description: '本机 external 组件 YAML 文件路径；与 text 任择其一。', required: false },
      },
      output: componentView,
      run: (_query, input) =>
        'text' in input ? components().addFromText(input.text) : components().addFromPath(input.path),
    }),
    defineOperation({
      id: 'locus.components.remove',
      summary: '按路径 id 删除动态登记的 external 组件；包组件不可删除，无需 Body 或 query。',
      method: 'DELETE',
      scheme: 'locus',
      authority: 'components',
      path: '/:id',
      auth: 'user',
      input: z.undefined(),
      output: componentRemoval,
      run: (_query, _input, context) => {
        const id = context.url.pathParams.id ?? ''
        components().remove(id)
        return { component: id, removed: true as const }
      },
    }),
    defineOperation({
      id: 'locus.components.upgrade',
      summary: '按路径 id 刷新包组件定义到代码版本并保留 config；无需 Body 或 query。',
      method: 'POST',
      scheme: 'locus',
      authority: 'components',
      path: '/:id/actions/upgrade',
      auth: 'user',
      input: z.undefined(),
      output: componentView,
      run: (_query, _input, context) => components().upgrade(context.url.pathParams.id ?? ''),
    }),
    defineOperation({
      id: 'locus.components.probe',
      summary: '按路径 id 执行 external 组件已声明的探针并保存观察结果；无需 Body 或 query。',
      method: 'POST',
      scheme: 'locus',
      authority: 'components',
      path: '/:id/actions/probe',
      auth: 'user',
      input: z.undefined(),
      output: componentView,
      run: (_query, _input, context) => components().probe(context.url.pathParams.id ?? ''),
    }),
    defineOperation({
      id: 'locus.components.probe-all',
      summary: '探查全部 external 组件，逐项返回结果或跳过原因；无需 Body 或 query。',
      method: 'POST',
      scheme: 'locus',
      authority: 'components',
      path: '/actions/probe',
      auth: 'user',
      input: z.undefined(),
      output: componentProbeAll,
      run: async () => {
        const service = components()
        const { components: registered } = service.list()
        const probed: ComponentView[] = []
        const skipped: Array<{ id: string; reason: string }> = []
        for (const item of registered) {
          if (item.kind !== 'external') continue
          try {
            probed.push(await service.probe(item.id))
          } catch (error) {
            skipped.push({ id: item.id, reason: error instanceof Error ? error.message : String(error) })
          }
        }
        return { probed, skipped }
      },
    }),
    defineOperation({
      id: 'locus.components.deploy',
      summary: '按路径 id 执行组件已声明的部署命令并保存结果；无需 Body 或 query。',
      method: 'POST',
      scheme: 'locus',
      authority: 'components',
      path: '/:id/actions/deploy',
      auth: 'user',
      input: z.undefined(),
      output: componentView,
      run: (_query, _input, context) => components().deploy(context.url.pathParams.id ?? ''),
    }),
  ]
}
