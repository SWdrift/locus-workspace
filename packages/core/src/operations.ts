import { z } from 'zod'
import { defineComponent } from './components/definition.ts'
import { createComponentOperations } from './components/operations.ts'
import type { ComponentsService, DefinedComponent } from './components/types.ts'
import { createEventOperations } from './events/operations.ts'
import type { EventBus } from './events/types.ts'
import { defineOperation } from './invocation/operation.ts'
import type { OperationMetadata } from './invocation/types.ts'
import { createSecurityOperations } from './security/operations.ts'
import type { SecurityHost, SecurityService } from './security/types.ts'
import type { LocusInfo } from './types.ts'
import { createWorkspaceOperations } from './workspaces/operations.ts'
import type { MountService, WorkspaceService } from './workspaces/types.ts'

interface CoreOperationDependencies {
  readonly info: LocusInfo
  readonly workspaces: WorkspaceService
  readonly mounts: MountService
  readonly components: () => ComponentsService
  readonly security: () => SecurityService
  readonly host: () => SecurityHost
  readonly events: EventBus
  readonly operations: () => readonly { readonly namespace: string; readonly operation: OperationMetadata }[]
}

/** Core 自有资源统一装配；领域路由和用例仍由所属模块维护。 */
export function createLocusComponent(deps: CoreOperationDependencies): DefinedComponent {
  const info = defineOperation({
    id: 'locus.info.get',
    method: 'GET',
    scheme: 'locus',
    authority: 'info',
    path: '',
    auth: 'user',
    input: z.undefined(),
    output: z.object({ version: z.string() }),
    run: () => deps.info,
  })
  const operations = defineOperation({
    id: 'locus.operations.list',
    method: 'GET',
    scheme: 'locus',
    authority: 'operations',
    path: '',
    auth: 'user',
    input: z.undefined(),
    output: z.array(
      z.object({
        component: z.string(),
        id: z.string(),
        method: z.string(),
        scheme: z.string(),
        authority: z.string(),
        path: z.string(),
        auth: z.string(),
      }),
    ),
    run: () =>
      deps.operations().map(({ namespace, operation }) => ({
        component: namespace,
        id: operation.id,
        method: operation.method,
        scheme: operation.scheme,
        authority: operation.authority,
        path: operation.path,
        auth: operation.auth,
      })),
  })
  return defineComponent({
    id: 'locus',
    version: '1',
    name: 'Locus Core',
    summary: 'Core 自有 Workspace、组件、安全、凭据与事件资源',
    kind: 'locus',
    operations: [
      info,
      operations,
      ...createWorkspaceOperations({ workspaces: deps.workspaces, mounts: deps.mounts }),
      ...createComponentOperations(deps.components),
      ...createSecurityOperations({ security: deps.security, host: deps.host }),
      ...createEventOperations(deps.events),
    ],
  })
}
