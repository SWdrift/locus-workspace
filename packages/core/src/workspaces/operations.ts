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
      summary: '列出全部 Workspace 及其挂载和关系；无需 Body 或 query。',
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
      summary: '创建具有稳定 Identity 的 Workspace；Body 必须提供 name。',
      method: 'POST',
      scheme: 'locus',
      authority: 'workspaces',
      path: '',
      auth: 'user',
      input: workspaceInput,
      fields: { name: { description: 'Workspace 名称，不要求唯一。', required: true } },
      output: workspaceOutput,
      run: (_query, input) => deps.workspaces.create(input.name),
    }),
    defineOperation({
      id: 'locus.workspaces.get',
      summary: '按路径 id（Identity 或唯一名称）读取 Workspace、挂载与关系；无需 Body 或 query。',
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
      summary: '按路径 id（Identity 或唯一名称）重命名 Workspace；Body 必须提供 name。',
      method: 'PATCH',
      scheme: 'locus',
      authority: 'workspaces',
      path: '/:id',
      auth: 'user',
      input: workspaceInput,
      fields: { name: { description: '新的 Workspace 名称，不改变 Identity。', required: true } },
      output: workspaceOutput,
      run: (_query, input, context) => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        return deps.workspaces.rename(workspace.id, input.name)
      },
    }),
    defineOperation({
      id: 'locus.workspaces.remove',
      summary: '删除路径 id 指定的 Workspace、挂载及相关 Workspace 引用；不删除外部资源，无需 Body 或 query。',
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
      summary: '列出路径 id 指定 Workspace 的本机目录挂载；无需 Body 或 query。',
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
      summary: '为路径 id 指定的 Workspace 添加挂载；Body 必须提供本机绝对路径 path，可选 name。',
      method: 'POST',
      scheme: 'locus',
      authority: 'workspaces',
      path: '/:id/mounts',
      auth: 'user',
      input: mountInput,
      fields: {
        path: { description: '本机绝对目录路径；只登记引用，不检查目录存在性。', required: true },
        name: { description: '挂载名称；省略时由目录名生成，同一 Workspace 内必须唯一。', required: false },
      },
      output: mountOutput,
      run: (_query, input, context) => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        return deps.mounts.add(workspace.id, input.path, input.name === undefined ? undefined : { name: input.name })
      },
    }),
    defineOperation({
      id: 'locus.workspaces.mounts.remove',
      summary: '删除 Workspace 路径 id 下由 mount（挂载 Identity 或名称）指定的挂载；不删除目录，无需 Body 或 query。',
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
      summary: '列出路径 id 指定 Workspace 的 member 与 association 关系；无需 Body 或 query。',
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
      summary:
        '确认 Workspace 关系；Body 必填 kind（member/association）、namespace、id，可选 source:{kind:manual/discovery,detail}。',
      method: 'POST',
      scheme: 'locus',
      authority: 'workspaces',
      path: '/:id/relations',
      auth: 'user',
      input: relationInput,
      fields: {
        kind: { description: '关系种类：member（成员）或 association（关联）。', required: true },
        namespace: { description: '目标资源的命名空间；locus.workspace 目标必须存在。', required: true },
        id: { description: '目标资源 Identity，不是当前 Workspace 的路径 id。', required: true },
        source: {
          description: '可选确认来源对象 {kind:"manual"|"discovery",detail:string}；默认人工显式确认。',
          required: false,
        },
      },
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
      summary: '按路径 relation（关系 Identity）解除 Workspace 路径 id 的关系；不删除目标资源，无需 Body 或 query。',
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
