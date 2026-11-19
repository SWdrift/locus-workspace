import { z } from 'zod'
import { i18n } from '../i18n/core.ts'
import { defineOperation } from '../invocation/operation.ts'
import type { OperationDefinition } from '../invocation/types.ts'
import { WorkspaceFailure } from './errors.ts'
import type { MountService, Workspace, WorkspaceService } from './types.ts'

export function createWorkspaceOperations(deps: {
  readonly workspaces: WorkspaceService
  readonly mounts: MountService
}): readonly OperationDefinition<any, any, any>[] {
  return [
    defineOperation({
      id: 'locus.ws.list',
      summary: i18n.t('operation.ws.list'),
      method: 'GET',
      scheme: 'locus',
      authority: 'ws',
      path: '',
      auth: 'user',
      input: z.undefined(),
      output: z.array(workspaceOutput).readonly(),
      run: () => deps.workspaces.list(),
    }),
    defineOperation({
      id: 'locus.ws.create',
      summary: i18n.t('operation.ws.create'),
      method: 'POST',
      scheme: 'locus',
      authority: 'ws',
      path: '',
      auth: 'user',
      input: workspaceCreateInput,
      fields: {
        name: { description: i18n.t('field.workspace-name'), required: true },
        description: { description: i18n.t('field.workspace-description'), required: false },
      },
      output: workspaceOutput,
      run: (_query, input) =>
        deps.workspaces.create(
          input.name,
          input.description === undefined ? undefined : { description: input.description },
        ),
    }),
    defineOperation({
      id: 'locus.ws.get',
      summary: i18n.t('operation.ws.get'),
      method: 'GET',
      scheme: 'locus',
      authority: 'ws',
      path: '/:id',
      auth: 'user',
      input: z.undefined(),
      output: workspaceOutput,
      run: (_query, _input, context) => resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? ''),
    }),
    defineOperation({
      id: 'locus.ws.update',
      summary: i18n.t('operation.ws.update'),
      method: 'PATCH',
      scheme: 'locus',
      authority: 'ws',
      path: '/:id',
      auth: 'user',
      input: workspaceUpdateInput,
      fields: {
        name: { description: i18n.t('field.workspace-new-name'), required: false },
        description: { description: i18n.t('field.workspace-description'), required: false },
      },
      output: workspaceOutput,
      run: (_query, input, context) => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        return deps.workspaces.update(workspace.id, {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined ? {} : { description: input.description }),
        })
      },
    }),
    defineOperation({
      id: 'locus.ws.remove',
      summary: i18n.t('operation.ws.remove'),
      method: 'DELETE',
      scheme: 'locus',
      authority: 'ws',
      path: '/:id',
      auth: 'user',
      input: z.undefined(),
      output: z.object({ workspaceId: z.string(), removed: z.literal(true) }),
      run: (_query, _input, context) => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        deps.workspaces.remove(workspace.id)
        return { workspaceId: workspace.id, removed: true as const }
      },
    }),
    defineOperation({
      id: 'locus.ws.mounts.list',
      summary: i18n.t('operation.ws.mounts.list'),
      method: 'GET',
      scheme: 'locus',
      authority: 'ws',
      path: '/:id/mounts',
      auth: 'user',
      input: z.undefined(),
      output: z.array(mountOutput).readonly(),
      run: (_query, _input, context) => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        return deps.mounts.list(workspace.id)
      },
    }),
    defineOperation({
      id: 'locus.ws.mounts.add',
      summary: i18n.t('operation.ws.mounts.add'),
      method: 'POST',
      scheme: 'locus',
      authority: 'ws',
      path: '/:id/mounts',
      auth: 'user',
      input: mountInput,
      fields: {
        path: { description: i18n.t('field.mount-path'), required: true },
        name: { description: i18n.t('field.mount-name'), required: false },
        primary: { description: i18n.t('field.mount-primary'), required: false },
      },
      output: mountOutput,
      run: (_query, input, context) => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        return deps.mounts.add(workspace.id, input.path, {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.primary === undefined ? {} : { primary: input.primary }),
        })
      },
    }),
    defineOperation({
      id: 'locus.ws.mounts.update',
      summary: i18n.t('operation.ws.mounts.update'),
      method: 'PATCH',
      scheme: 'locus',
      authority: 'ws',
      path: '/:id/mounts/:mount',
      auth: 'user',
      input: mountUpdateInput,
      fields: {
        name: { description: i18n.t('field.mount-name'), required: false },
        primary: { description: i18n.t('field.mount-primary'), required: false },
      },
      output: mountOutput,
      run: (_query, input, context) => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        return deps.mounts.update(workspace.id, context.url.pathParams.mount ?? '', {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.primary === undefined ? {} : { primary: input.primary }),
        })
      },
    }),
    defineOperation({
      id: 'locus.ws.mounts.remove',
      summary: i18n.t('operation.ws.mounts.remove'),
      method: 'DELETE',
      scheme: 'locus',
      authority: 'ws',
      path: '/:id/mounts/:mount',
      auth: 'user',
      input: z.undefined(),
      output: z.object({ workspaceId: z.string(), removedMount: z.string() }),
      run: (_query, _input, context) => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        const mount = context.url.pathParams.mount ?? ''
        deps.mounts.remove(workspace.id, mount)
        return { workspaceId: workspace.id, removedMount: mount }
      },
    }),
    defineOperation({
      id: 'locus.ws.relations.list',
      summary: i18n.t('operation.ws.relations.list'),
      method: 'GET',
      scheme: 'locus',
      authority: 'ws',
      path: '/:id/relations',
      auth: 'user',
      input: z.undefined(),
      output: z.array(relationOutput).readonly(),
      run: (_query, _input, context) => resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '').relations,
    }),
    defineOperation({
      id: 'locus.ws.relations.add',
      summary: i18n.t('operation.ws.relations.add'),
      method: 'POST',
      scheme: 'locus',
      authority: 'ws',
      path: '/:id/relations',
      auth: 'user',
      input: relationInput,
      fields: {
        kind: { description: i18n.t('field.relation-kind'), required: true },
        namespace: { description: i18n.t('field.relation-namespace'), required: true },
        id: { description: i18n.t('field.relation-id'), required: true },
        source: { description: i18n.t('field.relation-source'), required: false },
      },
      output: relationOutput,
      run: (_query, input, context) => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        return deps.workspaces.link(
          workspace.id,
          input.kind,
          { namespace: input.namespace, id: input.id },
          input.source ?? { kind: 'manual', detail: i18n.t('workspace.default-relation-detail') },
        )
      },
    }),
    defineOperation({
      id: 'locus.ws.relations.remove',
      summary: i18n.t('operation.ws.relations.remove'),
      method: 'DELETE',
      scheme: 'locus',
      authority: 'ws',
      path: '/:id/relations/:relation',
      auth: 'user',
      input: z.undefined(),
      output: z.object({ workspaceId: z.string(), removedRelationId: z.string() }),
      run: (_query, _input, context) => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        const relation = context.url.pathParams.relation ?? ''
        deps.workspaces.unlink(workspace.id, relation)
        return { workspaceId: workspace.id, removedRelationId: relation }
      },
    }),
  ]
}

/** 以稳定 Identity 或唯一名称定位；名称已唯一，不再有歧义分支。 */
function resolveWorkspace(workspaces: WorkspaceService, reference: string): Workspace {
  const all = workspaces.list()
  const byId = all.find(workspace => workspace.id === reference)
  if (byId !== undefined) return byId
  const key = reference.trim()
  const named = all.find(workspace => workspace.name.trim() === key)
  if (named !== undefined) return named
  throw new WorkspaceFailure('not-found', i18n.t('workspace.not-found', { reference }))
}

const workspaceCreateInput = z.object({
  name: z.string(),
  description: z.string().optional(),
})
const workspaceUpdateInput = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
})
const mountInput = z.object({
  path: z.string(),
  name: z.string().optional(),
  primary: z.boolean().optional(),
})
const mountUpdateInput = z.object({
  name: z.string().optional(),
  primary: z.boolean().optional(),
})
const relationInput = z.object({
  kind: z.enum(['member', 'association']),
  namespace: z.string(),
  id: z.string(),
  source: z.object({ kind: z.enum(['manual', 'discovery']), detail: z.string() }).optional(),
})

const relationOutput = z.object({
  id: z.string(),
  kind: z.enum(['member', 'association']),
  target: z.object({ namespace: z.string(), id: z.string() }),
  source: z.object({ kind: z.enum(['manual', 'discovery']), detail: z.string() }),
  createdAt: z.string(),
})
const mountOutput = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  path: z.string(),
  primary: z.boolean(),
  createdAt: z.string(),
})
const workspaceOutput = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  createdAt: z.string(),
  relations: z.array(relationOutput).readonly(),
  mounts: z.array(mountOutput).readonly(),
})
