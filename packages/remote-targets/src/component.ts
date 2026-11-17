import { join } from 'node:path'
import {
  defineComponent, defineCredential, defineOperation, InvocationFailure,
} from '@locus/core'
import type {
  CredentialDefinition,
  OperationContext,
  OperationDefinition,
} from '@locus/core'
import { z } from 'zod'
import { targetBinding } from './config.ts'
import { createRemoteTargetsService } from './service.ts'
import type { RemoteCredentialMaterial, RemoteCredentialSlot, RemoteTarget } from './types.ts'

const privateKey = defineCredential({
  id: 'ssh-private-key',
  fields: [
    { name: 'targetBinding', secret: false, required: true },
    { name: 'privateKey', secret: true, required: true },
    { name: 'passphrase', secret: true, required: false },
  ],
})
const password = defineCredential({
  id: 'ssh-password',
  fields: [
    { name: 'targetBinding', secret: false, required: true },
    { name: 'password', secret: true, required: true },
  ],
})

const registerFields = Object.freeze({
  privateKey: Object.freeze({ secret: true, tty: true }),
  password: Object.freeze({ secret: true, tty: true }),
})

const secretInput = z.object({
  privateKey: z.string().optional(),
  password: z.string().optional(),
})

function serviceOf(context: OperationContext) {
  return createRemoteTargetsService({
    root: join(context.dataDirectory, 'remote-targets'),
    components: {
      get(id: string) {
        const found = context.components.get(id)
        return found === undefined ? undefined : { id: found.id, kind: found.kind, state: found.state }
      },
    },
  })
}

function slotOf(target: RemoteTarget): RemoteCredentialSlot {
  if (target.identity.auth.method === 'key' || target.identity.auth.path !== undefined) {
    throw new InvocationFailure('unavailable', `目标 ${target.id} 仍使用旧文件认证；需要显式迁移`)
  }
  return target.identity.auth.method === 'password' ? 'ssh-password' : 'ssh-private-key'
}

function credentialOf(slot: RemoteCredentialSlot): CredentialDefinition {
  return slot === 'ssh-password' ? password : privateKey
}

function secretOf(
  input: { readonly privateKey?: string | undefined; readonly password?: string | undefined },
  slot: RemoteCredentialSlot,
): string {
  const secret = slot === 'ssh-password' ? input.password : input.privateKey
  if (secret === undefined || secret.length === 0) {
    throw new InvocationFailure('invalid-argument', `缺少 ${slot} 输入；秘密只能经可信 Host 收集`)
  }
  return secret
}

/** 读取当前目标的凭据材料；缺失在调用 handler 前失败。 */
async function materialOf(context: OperationContext, target: RemoteTarget): Promise<RemoteCredentialMaterial> {
  const slot = slotOf(target)
  const values = await context.credential.read(credentialOf(slot), target.id, (input) => input)
  return { slot, values }
}

async function writeCredential(
  context: OperationContext,
  target: RemoteTarget,
  slot: RemoteCredentialSlot,
  secret: string,
): Promise<void> {
  await context.credential.write(credentialOf(slot), target.id, {
    targetBinding: targetBinding(target),
    ...(slot === 'ssh-password' ? { password: secret } : { privateKey: secret }),
  })
}

const registerInput = z.object({ spec: z.string(), ...secretInput.shape })

const list = defineOperation({
  id: 'rt.targets.list', method: 'GET', scheme: 'rt', authority: 'targets', path: '', auth: 'user',
  input: z.undefined(), output: z.unknown(),
  run(_query, _input, context) {
    const service = serviceOf(context)
    try {
      return service.list()
    } finally {
      service.dispose()
    }
  },
})

const get = defineOperation({
  id: 'rt.target.get', method: 'GET', scheme: 'rt', authority: 'targets', path: '/:id', auth: 'user',
  input: z.undefined(), output: z.unknown(),
  run(_query, _input, context) {
    const service = serviceOf(context)
    try {
      return service.show(context.url.pathParams.id ?? '')
    } finally {
      service.dispose()
    }
  },
})

const register = defineOperation({
  id: 'rt.target.register', method: 'PUT', scheme: 'rt', authority: 'targets', path: '/:id', auth: 'root',
  input: registerInput, output: z.unknown(), fields: registerFields,
  async run(_query, input, context) {
    const service = serviceOf(context)
    try {
      const id = context.url.pathParams.id ?? ''
      const preview = service.addFromText(id, input.spec, { dryRun: true })
      const slot = slotOf(preview)
      await writeCredential(context, preview, slot, secretOf(input, slot))
      const created = service.addFromText(id, input.spec)
      context.emit('locus.rt.target.registered', { target: created.id })
      return created
    } finally {
      service.dispose()
    }
  },
})

const remove = defineOperation({
  id: 'rt.target.remove', method: 'DELETE', scheme: 'rt', authority: 'targets', path: '/:id', auth: 'root',
  input: z.undefined(), output: z.object({ target: z.string(), removed: z.literal(true) }),
  run(_query, _input, context) {
    const service = serviceOf(context)
    try {
      const target = service.show(context.url.pathParams.id ?? '')
      service.remove(target.id)
      context.emit('locus.rt.target.removed', { target: target.id })
      return { target: target.id, removed: true as const }
    } finally {
      service.dispose()
    }
  },
})

const credentialUpdateInput = z.object({
  method: z.enum(['private-key', 'password']),
  ...secretInput.shape,
})

const credentialUpdate = defineOperation({
  id: 'rt.target.credential.update', method: 'POST', scheme: 'rt', authority: 'targets', path: '/:id/actions/credential', auth: 'root',
  input: credentialUpdateInput, output: z.unknown(), fields: registerFields,
  async run(_query, input, context) {
    const service = serviceOf(context)
    try {
      const target = service.show(context.url.pathParams.id ?? '')
      if (target.identity.auth.method !== input.method) {
        throw new InvocationFailure('invalid-argument', '目标认证方式与 method 不一致')
      }
      await writeCredential(context, target, slotOf(target), secretOf(input, slotOf(target)))
      context.emit('locus.rt.credential.updated', { target: target.id, method: input.method })
      return { target: target.id, method: input.method, updated: true as const }
    } finally {
      service.dispose()
    }
  },
})

const migrate = defineOperation({
  id: 'rt.target.migrate', method: 'POST', scheme: 'rt', authority: 'targets', path: '/:id/actions/migrate', auth: 'root',
  input: credentialUpdateInput, output: z.unknown(), fields: registerFields,
  async run(_query, input, context) {
    const service = serviceOf(context)
    try {
      const legacy = service.credentialMigration(context.url.pathParams.id ?? '')
      const slot: RemoteCredentialSlot = input.method === 'password' ? 'ssh-password' : 'ssh-private-key'
      if (legacy.method === 'key' && slot !== 'ssh-private-key') {
        throw new InvocationFailure('invalid-argument', '旧 key 认证只能迁移为 private-key')
      }
      if (legacy.method === 'password' && slot !== 'ssh-password') {
        throw new InvocationFailure('invalid-argument', '旧 password 认证只能迁移为 password')
      }
      const target = service.show(context.url.pathParams.id ?? '')
      await writeCredential(context, target, slot, secretOf(input, slot))
      const migrated = service.useCredential(target.id)
      context.emit('locus.rt.target.migrated', { target: migrated.id, method: input.method })
      return migrated
    } finally {
      service.dispose()
    }
  },
})

const system = defineOperation({
  id: 'rt.system.read', method: 'GET', scheme: 'rt', authority: 'targets', path: '/:id/system', auth: 'user',
  input: z.undefined(), output: z.unknown(),
  async run(_query, _input, context) {
    const service = serviceOf(context)
    try {
      const target = service.show(context.url.pathParams.id ?? '')
      return await service.system(target.id, await materialOf(context, target))
    } finally {
      service.dispose()
    }
  },
})

const services = defineOperation({
  id: 'rt.services.list', method: 'GET', scheme: 'rt', authority: 'targets', path: '/:id/services', auth: 'user',
  input: z.undefined(), output: z.unknown(),
  async run(_query, _input, context) {
    const service = serviceOf(context)
    try {
      const target = service.show(context.url.pathParams.id ?? '')
      return await service.services(target.id, await materialOf(context, target))
    } finally {
      service.dispose()
    }
  },
})

const restart = defineOperation({
  id: 'rt.service.restart', method: 'POST', scheme: 'rt', authority: 'targets', path: '/:id/services/:name/actions/restart', auth: 'user',
  input: z.undefined(), output: z.unknown(),
  async run(_query, _input, context) {
    const service = serviceOf(context)
    try {
      const target = service.show(context.url.pathParams.id ?? '')
      const result = await service.restartService(
        target.id,
        context.url.pathParams.name ?? '',
        await materialOf(context, target),
      )
      context.emit('locus.rt.service.restart.completed', {
        target: target.id,
        service: result.name,
        status: result.status,
      })
      return result
    } finally {
      service.dispose()
    }
  },
})

const jobInput = z.object({
  command: z.array(z.string()).optional(),
  interactive: z.boolean().optional(),
})

const job = defineOperation({
  id: 'rt.job.run', method: 'POST', scheme: 'rt', authority: 'targets', path: '/:id/jobs', auth: 'user',
  input: jobInput, output: z.unknown(),
  async run(_query, input, context) {
    const service = serviceOf(context)
    try {
      const target = service.show(context.url.pathParams.id ?? '')
      const material = await materialOf(context, target)
      if (input.interactive === true) {
        const exitCode = await service.shell(target.id, material)
        context.emit('locus.rt.job.completed', { target: target.id, exitCode, interactive: true })
        return { exitCode }
      }
      const result = await service.exec(target.id, input.command ?? [], material)
      context.emit('locus.rt.job.completed', { target: target.id, exitCode: result.exitCode })
      return result
    } finally {
      service.dispose()
    }
  },
})

const operationList: readonly OperationDefinition<any, any, any>[] = [
  list, get, register, remove, credentialUpdate, migrate, system, services, restart, job,
]

export const remoteTargets = defineComponent({
  id: 'remote-targets',
  version: '5',
  name: '远程目标',
  summary: '登记并通过 SSH 访问远程目标',
  kind: 'locus',
  requires: ['openssh'],
  config: 'remote-targets/',
  operations: operationList,
  credentials: [privateKey, password],
  info: {
    text: [
      '通过系统 OpenSSH/Plink 访问已登记目标。',
      '私钥与密码分别登记到独立字段槽；凭据按 component + slot + target id 绑定。',
      '密钥认证需要 openssh 组件为 healthy；密码认证需要 plink 组件。',
    ].join('\n'),
  },
})

export const component = remoteTargets.component
export const operations = remoteTargets.operations
export { targetBinding }
export type { CredentialDefinition }
