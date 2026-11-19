import { z } from 'zod'
import { i18n } from '../i18n/core.ts'
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
      summary: i18n.t('operation.components.list'),
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
      summary: i18n.t('operation.components.get'),
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
      summary: i18n.t('operation.components.register'),
      method: 'POST',
      scheme: 'locus',
      authority: 'components',
      path: '',
      auth: 'user',
      input: componentSource,
      fields: {
        text: { description: i18n.t('field.component-text'), required: false },
        path: { description: i18n.t('field.component-path'), required: false },
      },
      output: componentView,
      run: (_query, input) =>
        'text' in input ? components().addFromText(input.text) : components().addFromPath(input.path),
    }),
    defineOperation({
      id: 'locus.components.remove',
      summary: i18n.t('operation.components.remove'),
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
      summary: i18n.t('operation.components.upgrade'),
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
      summary: i18n.t('operation.components.probe'),
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
      summary: i18n.t('operation.components.probe-all'),
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
      summary: i18n.t('operation.components.deploy'),
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
