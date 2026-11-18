import type { ComponentSpec } from '../components/types.ts'
import { deny } from './errors.ts'
import { bindTrustedComponent, requiredLevel } from './policy.ts'
import type { BoundComponent } from './policy.ts'
import type {
  ClearOperationLevelInput,
  HostSecurity,
  OperationAuthority,
  SecurityLevel,
  SecurityRequest,
  SecurityStore,
  SetOperationLevelInput,
} from './types.ts'

interface AuthorizationDependencies {
  readonly profile: string
  readonly definitions: readonly ComponentSpec[]
  readonly clock: () => number
  readonly transaction: SecurityStore['transaction']
}

export interface Authorization extends Pick<
  HostSecurity,
  'setOperationLevel' | 'clearOperationLevel' | 'listOperationAuthorities'
> {
  bind(componentId: string): BoundComponent
  evaluate(
    component: BoundComponent,
    request: SecurityRequest,
  ): {
    readonly level: SecurityLevel
    readonly generation: number
  }
}

const COMPONENT_ID = /^[a-z][a-z0-9-]{0,63}$/
const OPERATION = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/

/** 只判定可信声明和 Root 等级覆盖，不持有 Session、Challenge 或 Grant。 */
export function createAuthorization(deps: AuthorizationDependencies): Authorization {
  const definitions = new Map<string, ComponentSpec>()
  for (const definition of deps.definitions) {
    if (definitions.has(definition.id)) deny('invalid-request')
    definitions.set(definition.id, definition)
  }

  function definition(componentId: string): ComponentSpec {
    if (typeof componentId !== 'string' || !COMPONENT_ID.test(componentId)) deny('invalid-request')
    const component = definitions.get(componentId)
    if (component === undefined) deny('untrusted-component')
    return component
  }

  function operationDefinition(componentId: string, operation: string): ComponentSpec {
    if (typeof operation !== 'string' || !OPERATION.test(operation)) deny('invalid-request')
    const component = definition(componentId)
    const found = (component.operations ?? []).find(value => value.id === operation)
    if (found === undefined || found.auth === 'none') deny('unsupported-operation')
    return component
  }

  function authority(
    component: ComponentSpec,
    operation: string,
    override: SecurityLevel | undefined,
  ): OperationAuthority {
    const declaration = (component.operations ?? []).find(value => value.id === operation)
    if (declaration === undefined || declaration.auth === 'none') deny('unsupported-operation')
    return Object.freeze({
      componentId: component.id,
      operation,
      defaultAuthLevel: declaration.auth,
      effectiveAuthLevel: override ?? declaration.auth,
      source: override !== undefined ? 'override' : 'operation',
    })
  }

  return Object.freeze({
    bind(componentId: string): BoundComponent {
      return bindTrustedComponent(definition(componentId))
    },
    evaluate(
      component: BoundComponent,
      request: SecurityRequest,
    ): { readonly level: SecurityLevel; readonly generation: number } {
      const { root, override } = deps.transaction(transaction => ({
        root: transaction.getRoot(),
        override: transaction.getOperationLevel(deps.profile, component.componentId, request.operation),
      }))
      return { level: requiredLevel(component, request, override), generation: root?.generation ?? 0 }
    },
    async setOperationLevel(input: SetOperationLevelInput): Promise<OperationAuthority> {
      const component = operationDefinition(input.componentId, input.operation)
      if (input.level !== 'user' && input.level !== 'root') deny('invalid-request')
      return deps.transaction(transaction => {
        transaction.setOperationLevel({
          profile: deps.profile,
          componentId: input.componentId,
          operation: input.operation,
          level: input.level,
          updatedAt: deps.clock(),
        })
        return authority(component, input.operation, input.level)
      })
    },
    async clearOperationLevel(input: ClearOperationLevelInput): Promise<OperationAuthority> {
      const component = operationDefinition(input.componentId, input.operation)
      return deps.transaction(transaction => {
        transaction.deleteOperationLevel(deps.profile, input.componentId, input.operation)
        return authority(component, input.operation, undefined)
      })
    },
    async listOperationAuthorities(): Promise<readonly OperationAuthority[]> {
      return deps.transaction(transaction => {
        const overrides = new Map(
          transaction
            .listOperationLevels(deps.profile)
            .map(record => [JSON.stringify([record.componentId, record.operation]), record.level]),
        )
        const authorities: OperationAuthority[] = []
        for (const component of definitions.values()) {
          for (const operation of component.operations ?? []) {
            if (operation.auth === 'none') continue
            authorities.push(
              authority(component, operation.id, overrides.get(JSON.stringify([component.id, operation.id]))),
            )
          }
        }
        return Object.freeze(
          authorities.sort((left, right) =>
            JSON.stringify([left.componentId, left.operation]).localeCompare(
              JSON.stringify([right.componentId, right.operation]),
            ),
          ),
        )
      })
    },
  })
}
