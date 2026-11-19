import { z } from 'zod'
import { defineComponent } from './components/definition.ts'
import { createComponentOperations } from './components/operations.ts'
import type { ComponentsService, DefinedComponent } from './components/types.ts'
import { createEventOperations } from './events/operations.ts'
import type { EventBus } from './events/types.ts'
import { i18n } from './i18n/core.ts'
import { defineOperation, describeOperation, operationMetadataSchema } from './invocation/operation.ts'
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
    summary: i18n.t('operation.info.get'),
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
    summary: i18n.t('operation.operations.list'),
    method: 'GET',
    scheme: 'locus',
    authority: 'operations',
    path: '',
    auth: 'user',
    input: z.undefined(),
    output: z.array(operationMetadataSchema.extend({ component: z.string() })),
    run: () => deps.operations().map(({ namespace, operation }) => describeOperation(operation, namespace)),
  })
  return defineComponent({
    id: 'locus',
    version: '1',
    name: 'Locus Core',
    summary: i18n.t('component.locus-summary'),
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
