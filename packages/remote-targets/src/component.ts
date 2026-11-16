import { defineComponent, parseCredentialRef } from '@locus/core'
import type { CapabilityHandler, CredentialRef } from '@locus/core'
import { createRemoteTargetsService } from './service.ts'
import { RemoteTargetsFailure } from './types.ts'

export interface RemoteRegisterPrivateKeyInput {
  readonly credential: CredentialRef
  readonly targetBinding: string
  readonly privateKey: string
  readonly passphrase?: string
}

export interface RemoteRegisterPasswordInput {
  readonly credential: CredentialRef
  readonly targetBinding: string
  readonly password: string
}

export interface RemoteAccessInput {
  readonly root: string
  readonly target: string
  readonly operation: 'probe' | 'exec' | 'shell'
  readonly command?: readonly string[]
}

const registerPrivateKey: CapabilityHandler<RemoteRegisterPrivateKeyInput, { readonly registered: true }> = async (context, input) => {
  const reference = parseCredentialRef(input.credential)
  await context.registerCredential('ssh-private-key', reference, {
    targetBinding: input.targetBinding,
    privateKey: input.privateKey,
    ...(input.passphrase === undefined ? {} : { passphrase: input.passphrase }),
  })
  return { registered: true }
}

const registerPassword: CapabilityHandler<RemoteRegisterPasswordInput, { readonly registered: true }> = async (context, input) => {
  const reference = parseCredentialRef(input.credential)
  await context.registerCredential('ssh-password', reference, {
    targetBinding: input.targetBinding,
    password: input.password,
  })
  return { registered: true }
}

function access(slot: 'ssh-private-key' | 'ssh-password'): CapabilityHandler<RemoteAccessInput, unknown> {
  return async (context, input) => {
    const service = createRemoteTargetsService({
      root: input.root,
      security: {
        withCredential: (targetId, requestedSlot, credential, expectedBinding, consume) => {
          if (targetId !== input.target) {
            return Promise.reject(new RemoteTargetsFailure(
              'invalid-spec',
              `目标身份不一致：${targetId} != ${input.target}`,
            ))
          }
          if (requestedSlot !== slot) {
            return Promise.reject(new RemoteTargetsFailure(
              'invalid-spec',
              `目标认证方式与能力不匹配：需要 ${slot}，实际 ${requestedSlot}`,
            ))
          }
          return context.withCredential(slot, credential, (values) => {
            if (values.targetBinding !== expectedBinding) {
              return Promise.reject(new RemoteTargetsFailure(
                'target-config-mismatch',
                `目标 ${input.target} 配置已变化；需要 Root 重新登记或确认`,
              ))
            }
            return consume(values)
          })
        },
      },
    })
    try {
      if (input.operation === 'probe') return await service.probe(input.target)
      if (input.operation === 'exec') {
        return await service.exec(input.target, input.command ?? [])
      }
      return await service.shell(input.target)
    } finally {
      service.dispose()
    }
  }
}

export const remoteTargets = defineComponent({
  id: 'remote-targets',
  version: '4',
  name: '远程目标',
  summary: '登记并通过 SSH 访问远程目标',
  kind: 'locus',
  requires: ['openssh'],
  config: 'remote-targets/',
  capabilities: [
    {
      id: 'register-private-key',
      resourceType: 'remote-target',
      defaultAuthLevel: 'root',
      secrets: [{ slot: 'ssh-private-key', access: 'write' }],
      run: registerPrivateKey,
    },
    {
      id: 'register-password',
      resourceType: 'remote-target',
      defaultAuthLevel: 'root',
      secrets: [{ slot: 'ssh-password', access: 'write' }],
      run: registerPassword,
    },
    {
      id: 'private-key-access',
      resourceType: 'remote-target',
      defaultAuthLevel: 'user',
      secrets: [{ slot: 'ssh-private-key', access: 'read' }],
      run: access('ssh-private-key'),
    },
    {
      id: 'password-access',
      resourceType: 'remote-target',
      defaultAuthLevel: 'user',
      secrets: [{ slot: 'ssh-password', access: 'read' }],
      run: access('ssh-password'),
    },
  ],
  credentials: [
    {
      id: 'ssh-private-key',
      fields: [
        { name: 'targetBinding', secret: false, required: true },
        { name: 'privateKey', secret: true, required: true },
        { name: 'passphrase', secret: true, required: false },
      ],
    },
    {
      id: 'ssh-password',
      fields: [
        { name: 'targetBinding', secret: false, required: true },
        { name: 'password', secret: true, required: true },
      ],
    },
  ],
  info: {
    text: [
      '通过系统 OpenSSH/Plink 访问已登记目标。',
      '私钥与密码分别登记到独立字段槽；目标配置只保存 credential:<id>。',
      '密钥认证需要 openssh 组件为 healthy；密码认证需要 plink 组件。',
    ].join('\n'),
  },
})

export const component = remoteTargets.component
export const api = remoteTargets.api
