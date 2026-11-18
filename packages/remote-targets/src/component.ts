import { defineComponent } from '@locus/core/components'
import { migrate, password, privateKey, updateCredential } from './operations/credentials.ts'
import { runJob } from './operations/jobs.ts'
import { listServices, restartService } from './operations/services.ts'
import { readSystem } from './operations/system.ts'
import {
  getTarget,
  listTargets,
  migrationSource,
  previewTarget,
  registerTarget,
  removeTarget,
} from './operations/targets.ts'

const remoteTargets = defineComponent({
  id: 'remote-targets',
  version: '6',
  name: '远程目标',
  summary: '登记并通过 SSH 访问远程目标',
  kind: 'locus',
  requires: ['openssh'],
  config: 'remote-targets/',
  operations: [
    listTargets,
    getTarget,
    previewTarget,
    migrationSource,
    registerTarget,
    removeTarget,
    updateCredential,
    migrate,
    readSystem,
    listServices,
    restartService,
    runJob,
  ],
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
