import { z } from 'zod'
import { defineOperation } from '../invocation/operation.ts'
import { InvocationFailure } from '../invocation/errors.ts'
import type { OperationDefinition } from '../invocation/types.ts'
import { assertBindingInput, isCredentialRef, isResourceKey } from './policy.ts'
import type {
  ComponentCredentials,
  CredentialBindingView,
  CredentialList,
  CredentialRef,
  SecurityHost,
  SecurityService,
} from './types.ts'

export interface SecurityOperationDependencies {
  readonly security: () => SecurityService
  readonly host: () => SecurityHost
}

const credentialReference = z.custom<CredentialRef>(isCredentialRef)
const securityLevel = z.enum(['user', 'root'])
const credentialMetadata = z.object({
  reference: credentialReference,
  profile: z.string(),
  owner: z.string(),
  providerId: z.string(),
  fields: z.record(z.string(), z.string()).readonly(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})
const credentialBinding = z.object({
  profile: z.string(),
  componentId: z.string(),
  slot: z.string(),
  resourceKey: z.string().refine(isResourceKey),
  reference: credentialReference,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})
const credentialList = z.object({
  credentials: z.array(credentialMetadata).readonly(),
  bindings: z.array(credentialBinding).readonly(),
})
const operationAuthority = z.object({
  componentId: z.string(),
  operation: z.string(),
  defaultAuthLevel: securityLevel,
  effectiveAuthLevel: securityLevel,
  source: z.enum(['override', 'operation', 'default']),
})
const securityStatus = z.object({
  initialized: z.boolean(),
  profile: z.string(),
  installationId: z.string().optional(),
  identities: z.array(z.object({ id: z.enum(['root', 'user']), level: securityLevel })).readonly(),
})
const providerStatus = z.object({
  id: z.string(),
  backend: z.string(),
  state: z.enum(['ready', 'unverified', 'unavailable']),
  nativeBinding: z.enum(['not-applicable', 'not-loaded', 'loaded']),
})
const securityPasswordInput = z.object({ password: z.string(), confirmation: z.string() })
const resetInput = z.object({ password: z.string(), confirmation: z.string(), confirm: z.string() })
const ttyFields = Object.freeze({
  password: Object.freeze({ secret: true, tty: true }),
  confirmation: Object.freeze({ secret: true, tty: true }),
})
const resetFields = Object.freeze({ ...ttyFields, confirm: Object.freeze({ secret: true, tty: true }) })

/** 安全与凭据的协议投影独立于 Runtime；Host 只由可信组合根显式提供。 */
export function createSecurityOperations(
  deps: SecurityOperationDependencies,
): readonly OperationDefinition<any, any, any>[] {
  const management = () => deps.host().management()

  return [
    defineOperation({
      id: 'locus.security.status',
      method: 'GET',
      scheme: 'locus',
      authority: 'security',
      path: '',
      auth: 'user',
      input: z.undefined(),
      output: securityStatus,
      run: () => deps.security().status(),
    }),
    defineOperation({
      id: 'locus.security.provider',
      method: 'GET',
      scheme: 'locus',
      authority: 'security',
      path: '/provider',
      auth: 'user',
      input: z.undefined(),
      output: providerStatus,
      run: () => deps.security().providerStatus(),
    }),
    defineOperation({
      id: 'locus.security.initialize',
      method: 'POST',
      scheme: 'locus',
      authority: 'security',
      path: '/actions/init',
      auth: 'none',
      input: securityPasswordInput,
      output: z.object({ initialized: z.literal(true) }),
      fields: ttyFields,
      run: async (_query, input) => {
        if ((await deps.security().status()).initialized)
          throw new InvocationFailure('conflict', 'Root 安全身份已初始化')
        await deps.host().initializeRoot(input.password, input.confirmation)
        return { initialized: true as const }
      },
    }),
    defineOperation({
      id: 'locus.security.reset-root',
      method: 'POST',
      scheme: 'locus',
      authority: 'security',
      path: '/actions/reset-root',
      auth: 'user',
      input: resetInput,
      output: z.object({ reset: z.literal(true) }),
      fields: resetFields,
      run: async (_query, input) => {
        if (input.confirm !== 'RESET ROOT') throw new InvocationFailure('forbidden', '重置 Root 需要显式本机接管确认')
        await deps.host().resetRoot(input.password, input.confirmation)
        return { reset: true as const }
      },
    }),
    defineOperation({
      id: 'locus.security.change-root-password',
      method: 'POST',
      scheme: 'locus',
      authority: 'security',
      path: '/actions/change-root-password',
      auth: 'root',
      input: securityPasswordInput,
      output: z.object({ changed: z.literal(true) }),
      fields: ttyFields,
      run: async (_query, input) => {
        await management().changeRootPassword(input.password, input.confirmation)
        return { changed: true as const }
      },
    }),
    defineOperation({
      id: 'locus.security.operations.list',
      method: 'GET',
      scheme: 'locus',
      authority: 'security',
      path: '/operations',
      auth: 'root',
      input: z.undefined(),
      output: z.array(operationAuthority).readonly(),
      run: () => management().listOperationAuthorities(),
    }),
    defineOperation({
      id: 'locus.security.operations.set',
      method: 'PUT',
      scheme: 'locus',
      authority: 'security',
      path: '/operations/:component/:operation',
      auth: 'root',
      input: z.object({ level: securityLevel }),
      output: operationAuthority,
      run: (_query, input, context) =>
        management().setOperationLevel({
          componentId: context.url.pathParams.component ?? '',
          operation: context.url.pathParams.operation ?? '',
          level: input.level,
        }),
    }),
    defineOperation({
      id: 'locus.security.operations.reset',
      method: 'DELETE',
      scheme: 'locus',
      authority: 'security',
      path: '/operations/:component/:operation',
      auth: 'root',
      input: z.undefined(),
      output: operationAuthority,
      run: (_query, _input, context) =>
        management().clearOperationLevel({
          componentId: context.url.pathParams.component ?? '',
          operation: context.url.pathParams.operation ?? '',
        }),
    }),
    defineOperation({
      id: 'locus.credentials.list',
      method: 'GET',
      scheme: 'locus',
      authority: 'credentials',
      path: '',
      auth: 'root',
      input: z.undefined(),
      output: credentialList,
      run: async (): Promise<CredentialList> => {
        const [credentials, bindings] = await Promise.all([management().listCredentials(), management().listBindings()])
        return { credentials, bindings }
      },
    }),
    defineOperation({
      id: 'locus.credentials.component',
      method: 'GET',
      scheme: 'locus',
      authority: 'credentials',
      path: '/:component',
      auth: 'root',
      input: z.undefined(),
      output: credentialList.extend({ component: z.string() }),
      run: async (_query, _input, context): Promise<ComponentCredentials> => {
        const component = context.url.pathParams.component ?? ''
        const [credentials, bindings] = await Promise.all([management().listCredentials(), management().listBindings()])
        const owned = bindings.filter(binding => binding.componentId === component)
        const references = new Set(owned.map(binding => binding.reference))
        return {
          component,
          credentials: credentials.filter(credential => references.has(credential.reference)),
          bindings: owned,
        }
      },
    }),
    defineOperation({
      id: 'locus.credentials.get',
      method: 'GET',
      scheme: 'locus',
      authority: 'credentials',
      path: '/:component/:slot/:key',
      auth: 'root',
      input: z.undefined(),
      output: z.object({ binding: credentialBinding, credential: credentialMetadata }),
      run: async (_query, _input, context): Promise<CredentialBindingView> => {
        const componentId = context.url.pathParams.component ?? ''
        const slot = context.url.pathParams.slot ?? ''
        const resourceKey = context.url.pathParams.key ?? ''
        assertBindingInput(componentId, slot, resourceKey)
        const binding = (await management().listBindings()).find(
          item => item.componentId === componentId && item.slot === slot && item.resourceKey === resourceKey,
        )
        if (binding === undefined)
          throw new InvocationFailure('not-found', `没有凭据绑定：${componentId}/${slot}/${resourceKey}`)
        const credential = (await management().listCredentials()).find(item => item.reference === binding.reference)
        if (credential === undefined) throw new InvocationFailure('not-found', `找不到凭据元数据：${binding.reference}`)
        return { binding, credential }
      },
    }),
    defineOperation({
      id: 'locus.credentials.remove',
      method: 'DELETE',
      scheme: 'locus',
      authority: 'credentials',
      path: '/:component/:slot/:key',
      auth: 'root',
      input: z.undefined(),
      output: z.object({ reference: credentialReference, removed: z.literal(true) }),
      run: async (_query, _input, context) => {
        const componentId = context.url.pathParams.component ?? ''
        const slot = context.url.pathParams.slot ?? ''
        const resourceKey = context.url.pathParams.key ?? ''
        assertBindingInput(componentId, slot, resourceKey)
        const binding = (await management().listBindings()).find(
          item => item.componentId === componentId && item.slot === slot && item.resourceKey === resourceKey,
        )
        if (binding === undefined)
          throw new InvocationFailure('not-found', `没有凭据绑定：${componentId}/${slot}/${resourceKey}`)
        await management().deleteCredential(binding.reference)
        return { reference: binding.reference, removed: true as const }
      },
    }),
    defineOperation({
      id: 'locus.credentials.cleanup',
      method: 'POST',
      scheme: 'locus',
      authority: 'credentials',
      path: '/actions/cleanup',
      auth: 'root',
      input: z.object({ apply: z.boolean().optional() }),
      output: z.object({
        service: z.string(),
        orphans: z.array(z.string()).readonly(),
        removed: z.number().int().nonnegative(),
        remaining: z.number().int().nonnegative(),
      }),
      run: (_query, input) => management().cleanupCredentialOrphans(input.apply === true),
    }),
    defineOperation({
      id: 'locus.credentials.status',
      method: 'POST',
      scheme: 'locus',
      authority: 'credentials',
      path: '/actions/status',
      auth: 'root',
      input: z.object({ reference: credentialReference }),
      output: z.object({ metadata: credentialMetadata, present: z.boolean() }),
      run: (_query, input) => management().credentialStatus(input.reference),
    }),
  ]
}
