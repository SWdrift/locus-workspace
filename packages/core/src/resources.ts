import { z } from 'zod'
import type { ComponentsService } from './components/service.ts'
import type { DefinedComponent } from './components/spec.ts'
import { defineComponent } from './components/spec.ts'
import type {
  EventBus,
  OperationDefinition,
  OperationMetadata,
} from './invocation.ts'
import { defineOperation, InvocationFailure } from './invocation.ts'
import type { SecurityHost, SecurityService } from './security/types.ts'
import type { LocusInfo, MountService, Workspace, WorkspaceService } from './types.ts'

export interface LocusOperationDependencies {
  readonly info: LocusInfo
  readonly workspaces: WorkspaceService
  readonly mounts: MountService
  readonly components: () => ComponentsService
  readonly security: () => SecurityService
  readonly host: () => SecurityHost
  readonly events: EventBus
  readonly operations: () => readonly { readonly namespace: string; readonly operation: OperationMetadata }[]
}

const componentView = z.unknown()

/** Workspace 服务抛通用错误；operation 边界只区分“找不到”与参数错误。 */
function domain<T>(action: () => T): T {
  try {
    return action()
  } catch (error) {
    if (error instanceof InvocationFailure) throw error
    const message = error instanceof Error ? error.message : String(error)
    if (/找不到/.test(message)) throw new InvocationFailure('not-found', message)
    if (/不能把自身|已挂载|已存在|不唯一|不能引用自身/.test(message)) {
      throw new InvocationFailure('conflict', message)
    }
    throw new InvocationFailure('invalid-argument', message)
  }
}

/** CLI 接受稳定 Identity 或唯一名称；名称歧义时要求使用 Identity。 */
function resolveWorkspace(workspaces: WorkspaceService, reference: string): Workspace {
  const all = workspaces.list()
  const byId = all.find((workspace) => workspace.id === reference)
  if (byId !== undefined) return byId
  const named = all.filter((workspace) => workspace.name === reference)
  if (named.length === 1 && named[0] !== undefined) return named[0]
  if (named.length > 1) throw new InvocationFailure('conflict', `Workspace 名称不唯一：${reference}`)
  throw new InvocationFailure('not-found', `找不到 Workspace：${reference}`)
}

const workspaceInput = z.object({ name: z.string() })
const mountInput = z.object({ path: z.string(), name: z.string().optional() })
const relationInput = z.object({
  kind: z.enum(['member', 'association']),
  namespace: z.string(),
  id: z.string(),
  source: z.object({ kind: z.enum(['manual', 'discovery']), detail: z.string() }).optional(),
})
const componentSource = z.union([
  z.object({ text: z.string() }),
  z.object({ path: z.string() }),
])
const componentProbeInput = z.undefined()
const securityPasswordInput = z.object({ password: z.string(), confirmation: z.string() })
const resetInput = z.object({ password: z.string(), confirmation: z.string(), confirm: z.string() })
const ttyFields = Object.freeze({
  password: Object.freeze({ secret: true, tty: true }),
  confirmation: Object.freeze({ secret: true, tty: true }),
})
const resetFields = Object.freeze({
  ...ttyFields,
  confirm: Object.freeze({ secret: true, tty: true }),
})
const operationLevelInput = z.object({ level: z.enum(['user', 'root']) })
const credentialCleanupInput = z.object({ apply: z.boolean().optional() })
const credentialStatusInput = z.object({ reference: z.string().regex(/^credential:[a-z0-9][a-z0-9-]*$/) })
const eventsQuery = z.object({
  type: z.string().optional(),
  subject: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(10_000).optional(),
})

function createOperations(deps: LocusOperationDependencies): readonly OperationDefinition<any, any, any>[] {
  const management = () => deps.host().management()

  return [
    defineOperation({
      id: 'locus.info.get', method: 'GET', scheme: 'locus', authority: 'info', path: '', auth: 'user',
      input: z.undefined(), output: z.object({ version: z.string() }),
      run: () => deps.info,
    }),
    defineOperation({
      id: 'locus.operations.list', method: 'GET', scheme: 'locus', authority: 'operations', path: '', auth: 'user',
      input: z.undefined(), output: z.array(z.object({
        component: z.string(),
        id: z.string(),
        method: z.string(),
        scheme: z.string(),
        authority: z.string(),
        path: z.string(),
        auth: z.string(),
      })),
      run: () => deps.operations().map(({ namespace, operation }) => ({
        component: namespace,
        id: operation.id,
        method: operation.method,
        scheme: operation.scheme,
        authority: operation.authority,
        path: operation.path,
        auth: operation.auth,
      })),
    }),

    defineOperation({
      id: 'locus.workspaces.list', method: 'GET', scheme: 'locus', authority: 'workspaces', path: '', auth: 'user',
      input: z.undefined(), output: z.unknown(),
      run: () => deps.workspaces.list(),
    }),
    defineOperation({
      id: 'locus.workspaces.create', method: 'POST', scheme: 'locus', authority: 'workspaces', path: '', auth: 'user',
      input: workspaceInput, output: z.unknown(),
      run: (_query, input) => domain(() => deps.workspaces.create(input.name)),
    }),
    defineOperation({
      id: 'locus.workspaces.get', method: 'GET', scheme: 'locus', authority: 'workspaces', path: '/:id', auth: 'user',
      input: z.undefined(), output: z.unknown(),
      run: (_query, _input, context) => domain(() => resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')),
    }),
    defineOperation({
      id: 'locus.workspaces.rename', method: 'PATCH', scheme: 'locus', authority: 'workspaces', path: '/:id', auth: 'user',
      input: workspaceInput, output: z.unknown(),
      run: (_query, input, context) => domain(() => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        return deps.workspaces.rename(workspace.id, input.name)
      }),
    }),
    defineOperation({
      id: 'locus.workspaces.remove', method: 'DELETE', scheme: 'locus', authority: 'workspaces', path: '/:id', auth: 'user',
      input: z.undefined(), output: z.object({ workspaceId: z.string(), removed: z.literal(true) }),
      run: (_query, _input, context) => domain(() => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        deps.workspaces.remove(workspace.id)
        return { workspaceId: workspace.id, removed: true as const }
      }),
    }),
    defineOperation({
      id: 'locus.workspaces.mounts.list', method: 'GET', scheme: 'locus', authority: 'workspaces', path: '/:id/mounts', auth: 'user',
      input: z.undefined(), output: z.unknown(),
      run: (_query, _input, context) => domain(() => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        return deps.mounts.list(workspace.id)
      }),
    }),
    defineOperation({
      id: 'locus.workspaces.mounts.add', method: 'POST', scheme: 'locus', authority: 'workspaces', path: '/:id/mounts', auth: 'user',
      input: mountInput, output: z.object({ id: z.string(), name: z.string(), path: z.string() }),
      run: (_query, input, context) => domain(() => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        return deps.mounts.add(workspace.id, input.path, input.name === undefined ? undefined : { name: input.name })
      }),
    }),
    defineOperation({
      id: 'locus.workspaces.mounts.remove', method: 'DELETE', scheme: 'locus', authority: 'workspaces', path: '/:id/mounts/:mount', auth: 'user',
      input: z.undefined(), output: z.object({ workspaceId: z.string(), removedMount: z.string() }),
      run: (_query, _input, context) => domain(() => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        const mount = context.url.pathParams.mount ?? ''
        deps.mounts.remove(workspace.id, mount)
        return { workspaceId: workspace.id, removedMount: mount }
      }),
    }),
    defineOperation({
      id: 'locus.workspaces.relations.list', method: 'GET', scheme: 'locus', authority: 'workspaces', path: '/:id/relations', auth: 'user',
      input: z.undefined(), output: z.unknown(),
      run: (_query, _input, context) => domain(() => (
        resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '').relations
      )),
    }),
    defineOperation({
      id: 'locus.workspaces.relations.add', method: 'POST', scheme: 'locus', authority: 'workspaces', path: '/:id/relations', auth: 'user',
      input: relationInput, output: z.object({ id: z.string(), kind: z.string() }),
      run: (_query, input, context) => domain(() => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        return deps.workspaces.link(
          workspace.id,
          input.kind,
          { namespace: input.namespace, id: input.id },
          input.source ?? { kind: 'manual', detail: 'CLI 显式输入' },
        )
      }),
    }),
    defineOperation({
      id: 'locus.workspaces.relations.remove', method: 'DELETE', scheme: 'locus', authority: 'workspaces', path: '/:id/relations/:relation', auth: 'user',
      input: z.undefined(), output: z.object({ workspaceId: z.string(), removedRelationId: z.string() }),
      run: (_query, _input, context) => domain(() => {
        const workspace = resolveWorkspace(deps.workspaces, context.url.pathParams.id ?? '')
        const relation = context.url.pathParams.relation ?? ''
        deps.workspaces.unlink(workspace.id, relation)
        return { workspaceId: workspace.id, removedRelationId: relation }
      }),
    }),

    defineOperation({
      id: 'locus.components.list', method: 'GET', scheme: 'locus', authority: 'components', path: '', auth: 'user',
      input: z.undefined(), output: z.unknown(),
      run: () => deps.components().list(),
    }),
    defineOperation({
      id: 'locus.components.get', method: 'GET', scheme: 'locus', authority: 'components', path: '/:id', auth: 'user',
      input: z.undefined(), output: componentView,
      run: (_query, _input, context) => deps.components().show(context.url.pathParams.id ?? ''),
    }),
    defineOperation({
      id: 'locus.components.register', method: 'POST', scheme: 'locus', authority: 'components', path: '', auth: 'user',
      input: componentSource, output: componentView,
      run: (_query, input) => (
        'text' in input
          ? deps.components().addFromText(input.text)
          : deps.components().addFromPath(input.path)
      ),
    }),
    defineOperation({
      id: 'locus.components.remove', method: 'DELETE', scheme: 'locus', authority: 'components', path: '/:id', auth: 'user',
      input: z.undefined(), output: z.object({ component: z.string(), removed: z.literal(true) }),
      run: (_query, _input, context) => {
        const id = context.url.pathParams.id ?? ''
        deps.components().remove(id)
        return { component: id, removed: true as const }
      },
    }),
    defineOperation({
      id: 'locus.components.upgrade', method: 'POST', scheme: 'locus', authority: 'components', path: '/:id/actions/upgrade', auth: 'user',
      input: z.undefined(), output: componentView,
      run: (_query, _input, context) => deps.components().upgrade(context.url.pathParams.id ?? ''),
    }),
    defineOperation({
      id: 'locus.components.probe', method: 'POST', scheme: 'locus', authority: 'components', path: '/:id/actions/probe', auth: 'user',
      input: componentProbeInput, output: componentView,
      run: (_query, _input, context) => deps.components().probe(context.url.pathParams.id ?? ''),
    }),
    defineOperation({
      id: 'locus.components.probe-all', method: 'POST', scheme: 'locus', authority: 'components', path: '/actions/probe', auth: 'user',
      input: componentProbeInput, output: z.unknown(),
      run: async () => {
        const { components } = deps.components().list()
        const probed: unknown[] = []
        const skipped: Array<{ id: string; reason: string }> = []
        for (const item of components) {
          if (item.kind !== 'external') continue
          try {
            probed.push(await deps.components().probe(item.id))
          } catch (error) {
            skipped.push({ id: item.id, reason: error instanceof Error ? error.message : String(error) })
          }
        }
        return { probed, skipped }
      },
    }),
    defineOperation({
      id: 'locus.components.deploy', method: 'POST', scheme: 'locus', authority: 'components', path: '/:id/actions/deploy', auth: 'user',
      input: z.undefined(), output: componentView,
      run: (_query, _input, context) => deps.components().deploy(context.url.pathParams.id ?? ''),
    }),

    defineOperation({
      id: 'locus.security.status', method: 'GET', scheme: 'locus', authority: 'security', path: '', auth: 'user',
      input: z.undefined(), output: z.unknown(),
      run: () => deps.security().status(),
    }),
    defineOperation({
      id: 'locus.security.provider', method: 'GET', scheme: 'locus', authority: 'security', path: '/provider', auth: 'user',
      input: z.undefined(), output: z.unknown(),
      run: () => deps.security().providerStatus(),
    }),
    defineOperation({
      id: 'locus.security.initialize', method: 'POST', scheme: 'locus', authority: 'security', path: '/actions/init', auth: 'none',
      input: securityPasswordInput, output: z.object({ initialized: z.literal(true) }), fields: ttyFields,
      run: async (_query, input) => {
        const status = await deps.security().status()
        if (status.initialized) throw new InvocationFailure('conflict', 'Root 安全身份已初始化')
        await deps.host().initializeRoot(input.password, input.confirmation)
        return { initialized: true as const }
      },
    }),
    defineOperation({
      id: 'locus.security.reset-root', method: 'POST', scheme: 'locus', authority: 'security', path: '/actions/reset-root', auth: 'user',
      input: resetInput, output: z.object({ reset: z.literal(true) }), fields: resetFields,
      run: async (_query, input) => {
        if (input.confirm !== 'RESET ROOT') {
          throw new InvocationFailure('forbidden', '重置 Root 需要显式本机接管确认')
        }
        await deps.host().resetRoot(input.password, input.confirmation)
        return { reset: true as const }
      },
    }),
    defineOperation({
      id: 'locus.security.change-root-password', method: 'POST', scheme: 'locus', authority: 'security', path: '/actions/change-root-password', auth: 'root',
      input: securityPasswordInput, output: z.object({ changed: z.literal(true) }), fields: ttyFields,
      run: async (_query, input) => {
        await management().changeRootPassword(input.password, input.confirmation)
        return { changed: true as const }
      },
    }),
    defineOperation({
      id: 'locus.security.operations.list', method: 'GET', scheme: 'locus', authority: 'security', path: '/operations', auth: 'root',
      input: z.undefined(), output: z.unknown(),
      run: () => management().listOperationAuthorities(),
    }),
    defineOperation({
      id: 'locus.security.operations.set', method: 'PUT', scheme: 'locus', authority: 'security', path: '/operations/:component/:operation', auth: 'root',
      input: operationLevelInput, output: z.unknown(),
      run: (_query, input, context) => management().setOperationLevel({
        componentId: context.url.pathParams.component ?? '',
        operation: context.url.pathParams.operation ?? '',
        level: input.level,
      }),
    }),
    defineOperation({
      id: 'locus.security.operations.reset', method: 'DELETE', scheme: 'locus', authority: 'security', path: '/operations/:component/:operation', auth: 'root',
      input: z.undefined(), output: z.unknown(),
      run: (_query, _input, context) => management().clearOperationLevel({
        componentId: context.url.pathParams.component ?? '',
        operation: context.url.pathParams.operation ?? '',
      }),
    }),

    defineOperation({
      id: 'locus.credentials.list', method: 'GET', scheme: 'locus', authority: 'credentials', path: '', auth: 'root',
      input: z.undefined(), output: z.unknown(),
      run: async () => {
        const [credentials, bindings] = await Promise.all([
          management().listCredentials(),
          management().listBindings(),
        ])
        return { credentials, bindings }
      },
    }),
    defineOperation({
      id: 'locus.credentials.component', method: 'GET', scheme: 'locus', authority: 'credentials', path: '/:component', auth: 'root',
      input: z.undefined(), output: z.unknown(),
      run: async (_query, _input, context) => {
        const component = context.url.pathParams.component ?? ''
        const [credentials, bindings] = await Promise.all([
          management().listCredentials(),
          management().listBindings(),
        ])
        const owned = bindings.filter((binding) => binding.componentId === component)
        const references = new Set(owned.map((binding) => binding.reference))
        return {
          component,
          credentials: credentials.filter((credential) => references.has(credential.reference)),
          bindings: owned,
        }
      },
    }),
    defineOperation({
      id: 'locus.credentials.get', method: 'GET', scheme: 'locus', authority: 'credentials', path: '/:component/:slot/:key', auth: 'root',
      input: z.undefined(), output: z.object({ binding: z.unknown(), credential: z.unknown() }),
      run: async (_query, _input, context) => {
        const componentId = context.url.pathParams.component ?? ''
        const slot = context.url.pathParams.slot ?? ''
        const resourceKey = context.url.pathParams.key ?? ''
        const bindings = await management().listBindings()
        const binding = bindings.find((item) => (
          item.componentId === componentId && item.slot === slot && item.resourceKey === resourceKey
        ))
        if (binding === undefined) throw new InvocationFailure('not-found', `没有凭据绑定：${componentId}/${slot}/${resourceKey}`)
        const credentials = await management().listCredentials()
        const credential = credentials.find((item) => item.reference === binding.reference)
        if (credential === undefined) throw new InvocationFailure('not-found', `找不到凭据元数据：${binding.reference}`)
        return { binding, credential }
      },
    }),
    defineOperation({
      id: 'locus.credentials.remove', method: 'DELETE', scheme: 'locus', authority: 'credentials', path: '/:component/:slot/:key', auth: 'root',
      input: z.undefined(), output: z.object({ reference: z.string(), removed: z.literal(true) }),
      run: async (_query, _input, context) => {
        const componentId = context.url.pathParams.component ?? ''
        const slot = context.url.pathParams.slot ?? ''
        const resourceKey = context.url.pathParams.key ?? ''
        const bindings = await management().listBindings()
        const binding = bindings.find((item) => (
          item.componentId === componentId && item.slot === slot && item.resourceKey === resourceKey
        ))
        if (binding === undefined) throw new InvocationFailure('not-found', `没有凭据绑定：${componentId}/${slot}/${resourceKey}`)
        await management().deleteCredential(binding.reference)
        return { reference: binding.reference, removed: true as const }
      },
    }),
    defineOperation({
      id: 'locus.credentials.cleanup', method: 'POST', scheme: 'locus', authority: 'credentials', path: '/actions/cleanup', auth: 'root',
      input: credentialCleanupInput, output: z.unknown(),
      run: (_query, input) => management().cleanupCredentialOrphans(input.apply === true),
    }),
    defineOperation({
      id: 'locus.credentials.status', method: 'POST', scheme: 'locus', authority: 'credentials', path: '/actions/status', auth: 'root',
      input: credentialStatusInput, output: z.unknown(),
      run: (_query, input) => management().credentialStatus(input.reference as `credential:${string}`),
    }),

    defineOperation({
      id: 'locus.events.list', method: 'GET', scheme: 'locus', authority: 'events', path: '', auth: 'user',
      query: eventsQuery, input: z.undefined(), output: z.unknown(),
      run: (query) => deps.events.list({
        ...(query.type === undefined ? {} : { type: query.type }),
        ...(query.subject === undefined ? {} : { subject: query.subject }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      }),
    }),
  ]
}

/** Core 自有资源不是可登记组件；只进入安全定义与路由，不写入 components 目录。 */
export function createLocusComponent(deps: LocusOperationDependencies): DefinedComponent {
  return defineComponent({
    id: 'locus',
    version: '1',
    name: 'Locus Core',
    summary: 'Core 自有 Workspace、组件、安全、凭据与事件资源',
    kind: 'locus',
    operations: createOperations(deps),
  })
}
