import { z } from 'zod'
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
      id: 'locus.workspaces.list',
      method: 'GET',
      scheme: 'locus',
      authority: 'workspaces',
      path: '',
      auth: 'user',
      input: z.undefined(),
      output: z.array(workspaceOutput).readonly(),
      run: () => deps.workspaces.list(),
    }),
    defineOperation({
      id: 'locus.workspaces.create',
      method: 'POST',
      scheme: 'locus',
      authority: 'workspaces',
      path: '',
      auth: 'user',
      input: workspaceInput,
      output: workspaceOutput,
      run: (_query, input) => deps.workspaces.create(input.name),
    }),
    defineOperation({
      id: 'locus.workspaces.get',
      method: 'GET',
      scheme: 'locus',
      authority: 'workspaces',
      path: '/:id',
      auth: 'user',
      input: z.undefined(),
      output: workspaceOutput,
      run: (_query, _input, context) => resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? ''),
    }),
    defineOperation({
      id: 'locus.workspaces.rename',
      method: 'PATCH',
      scheme: 'locus',
      authority: 'workspaces',
      path: '/:id',
      auth: 'user',
      input: workspaceInput,
      output: workspaceOutput,
      run: (_query, input, context) => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        return deps.workspaces.rename(workspace.id, input.name)
      },
    }),
    defineOperation({
      id: 'locus.workspaces.remove',
      method: 'DELETE',
      scheme: 'locus',
      authority: 'workspaces',
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
      id: 'locus.workspaces.mounts.list',
      method: 'GET',
      scheme: 'locus',
      authority: 'workspaces',
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
      id: 'locus.workspaces.mounts.add',
      method: 'POST',
      scheme: 'locus',
      authority: 'workspaces',
      path: '/:id/mounts',
      auth: 'user',
      input: mountInput,
      output: mountOutput,
      run: (_query, input, context) => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        return deps.mounts.add(workspace.id, input.path, input.name === undefined ? undefined : { name: input.name })
      },
    }),
    defineOperation({
      id: 'locus.workspaces.mounts.remove',
      method: 'DELETE',
      scheme: 'locus',
      authority: 'workspaces',
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
      id: 'locus.workspaces.relations.list',
      method: 'GET',
      scheme: 'locus',
      authority: 'workspaces',
      path: '/:id/relations',
      auth: 'user',
      input: z.undefined(),
      output: z.array(relationOutput).readonly(),
      run: (_query, _input, context) => resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '').relations,
    }),
    defineOperation({
      id: 'locus.workspaces.relations.add',
      method: 'POST',
      scheme: 'locus',
      authority: 'workspaces',
      path: '/:id/relations',
      auth: 'user',
      input: relationInput,
      output: relationOutput,
      run: (_query, input, context) => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        return deps.workspaces.link(
          workspace.id,
          input.kind,
          { namespace: input.namespace, id: input.id },
          input.source ?? { kind: 'manual', detail: '显式确认' },
        )
      },
    }),
    defineOperation({
      id: 'locus.workspaces.relations.remove',
      method: 'DELETE',
      scheme: 'locus',
      authority: 'workspaces',
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

/** 以稳定 Identity 或唯一名称定位；名称歧义时要求使用 Identity。 */
function resolveWorkspace(workspaces: WorkspaceService, reference: string): Workspace {
  const all = workspaces.list()
  const byId = all.find(workspace => workspace.id === reference)
  if (byId !== undefined) return byId
  const named = all.filter(workspace => workspace.name === reference)
  if (named.length === 1 && named[0] !== undefined) return named[0]
  if (named.length > 1) throw new WorkspaceFailure('conflict', `Workspace 名称不唯一：${reference}`)
  throw new WorkspaceFailure('not-found', `找不到 Workspace：${reference}`)
}

const workspaceInput = z.object({ name: z.string() })
const mountInput = z.object({ path: z.string(), name: z.string().optional() })
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
  createdAt: z.string(),
})
const workspaceOutput = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  relations: z.array(relationOutput).readonly(),
  mounts: z.array(mountOutput).readonly(),
})
