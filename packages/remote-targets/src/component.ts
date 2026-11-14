import { defineComponent } from '@locus/core'

/** 远程目标组件依赖 OpenSSH；首次访问组件服务时物化到数据目录。 */
export const component = defineComponent({
  id: 'remote-targets',
  version: '1',
  name: '远程目标',
  summary: '登记并通过 SSH 访问远程目标',
  kind: 'locus',
  requires: ['openssh'],
  config: 'remote-targets/',
  info: {
    text: [
      'locus remote-targets add <id> --spec <file|->',
      'locus remote-targets list',
      'locus remote-targets show <target>',
      'locus remote-targets probe <target>',
      'locus remote-targets exec <target> -- <command...>',
      'locus remote-targets shell <target>',
      '',
      '密钥认证需要 openssh 组件为 healthy；密码认证需要 plink 组件。',
      '目标与凭据位于数据目录的 remote-targets/ 下。',
    ].join('\n'),
  },
})
