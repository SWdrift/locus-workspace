import type { WorkspaceOverview } from '@locus/application'
import type {
  OperationAvailability,
  OperationDefinition,
  OperationInvocationResult,
  Workspace,
} from '@locus/contracts'

export type {
  OperationAvailability,
  OperationDefinition,
  OperationInvocationResult,
  Workspace,
  WorkspaceOverview,
}

export type Route =
  | { readonly view: 'list' }
  | { readonly view: 'overview'; readonly workspaceId: string }
