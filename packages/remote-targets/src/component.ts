import { defineComponent } from '@locus/core/components'
import { i18n } from './i18n.ts'
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
  name: i18n.t('component.name'),
  summary: i18n.t('component.summary'),
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
  info: { text: i18n.t('component.info') },
})

export const component = remoteTargets.component
export const operations = remoteTargets.operations
