import { defineCredential, defineOperation, InvocationFailure } from '@locus/core/invocation'
import type { CredentialDefinition, OperationContext } from '@locus/core/invocation'
import { targetBinding } from '../config.ts'
import { assertUnencryptedPrivateKey } from '../credentials.ts'
import { credentialUpdateInputSchema, credentialUpdateResultSchema, remoteTargetSchema } from '../schemas.ts'
import type { RemoteCredentialMaterial, RemoteCredentialSlot, RemoteTarget } from '../types.ts'
import { RemoteTargetsFailure } from '../types.ts'
import { withService } from './context.ts'

export const privateKey = defineCredential({
  id: 'ssh-private-key',
  fields: [
    { name: 'targetBinding', secret: false, required: true },
    { name: 'privateKey', secret: true, required: true },
    { name: 'passphrase', secret: true, required: false },
  ],
})

export const password = defineCredential({
  id: 'ssh-password',
  fields: [
    { name: 'targetBinding', secret: false, required: true },
    { name: 'password', secret: true, required: true },
  ],
})

export const credentialFields = Object.freeze({
  privateKey: Object.freeze({ secret: true, tty: true }),
  password: Object.freeze({ secret: true, tty: true }),
})

export function slotOf(target: RemoteTarget): RemoteCredentialSlot {
  if (target.identity.auth.method === 'key' || target.identity.auth.path !== undefined) {
    throw new RemoteTargetsFailure('migration-required', `目标 ${target.id} 仍使用旧文件认证；需要显式迁移`)
  }
  return target.identity.auth.method === 'password' ? 'ssh-password' : 'ssh-private-key'
}

export function secretOf(
  input: { readonly privateKey?: string | undefined; readonly password?: string | undefined },
  slot: RemoteCredentialSlot,
): string {
  const secret = slot === 'ssh-password' ? input.password : input.privateKey
  if (secret === undefined || secret.length === 0) {
    throw new InvocationFailure('invalid-argument', `缺少 ${slot} 输入；秘密只能经可信 Host 收集`)
  }
  return secret
}

/** 缺失凭据在启动传输前失败；目标与凭据绑定由服务统一核对。 */
export async function materialOf(context: OperationContext, target: RemoteTarget): Promise<RemoteCredentialMaterial> {
  const slot = slotOf(target)
  const values = await context.credential.read(credentialOf(slot), target.id, input => input)
  return { slot, values }
}

/** 所有凭据写入共用预检，不能经直接 operation 调用绕过私钥约束。 */
export async function writeCredential(
  context: OperationContext,
  target: RemoteTarget,
  slot: RemoteCredentialSlot,
  secret: string,
): Promise<void> {
  if (slot === 'ssh-private-key') await assertUnencryptedPrivateKey(secret)
  await context.credential.write(credentialOf(slot), target.id, {
    targetBinding: targetBinding(target),
    ...(slot === 'ssh-password' ? { password: secret } : { privateKey: secret }),
  })
}

function credentialOf(slot: RemoteCredentialSlot): CredentialDefinition {
  return slot === 'ssh-password' ? password : privateKey
}

export const updateCredential = defineOperation({
  id: 'rt.target.credential.update',
  method: 'POST',
  scheme: 'rt',
  authority: 'targets',
  path: '/:id/actions/credential',
  auth: 'root',
  input: credentialUpdateInputSchema,
  output: credentialUpdateResultSchema,
  fields: credentialFields,
  run: (_query, input, context) =>
    withService(context, async service => {
      const target = service.show(context.url.pathParams.id ?? '')
      if (target.identity.auth.method !== input.method) {
        throw new InvocationFailure('invalid-argument', '目标认证方式与 method 不一致')
      }
      const slot = slotOf(target)
      await writeCredential(context, target, slot, secretOf(input, slot))
      context.emit('locus.rt.credential.updated', { target: target.id, method: input.method })
      return { target: target.id, method: input.method, updated: true as const }
    }),
})

export const migrate = defineOperation({
  id: 'rt.target.migrate',
  method: 'POST',
  scheme: 'rt',
  authority: 'targets',
  path: '/:id/actions/migrate',
  auth: 'root',
  input: credentialUpdateInputSchema,
  output: remoteTargetSchema,
  fields: credentialFields,
  run: (_query, input, context) =>
    withService(context, async service => {
      const legacy = service.credentialMigration(context.url.pathParams.id ?? '')
      const slot: RemoteCredentialSlot = input.method === 'password' ? 'ssh-password' : 'ssh-private-key'
      if ((legacy.method === 'key') !== (slot === 'ssh-private-key')) {
        throw new InvocationFailure('invalid-argument', '迁移 method 必须与旧认证方式一致')
      }
      const target = service.show(context.url.pathParams.id ?? '')
      await writeCredential(context, target, slot, secretOf(input, slot))
      const migrated = service.useCredential(target.id)
      context.emit('locus.rt.target.migrated', { target: migrated.id, method: input.method })
      return migrated
    }),
})
