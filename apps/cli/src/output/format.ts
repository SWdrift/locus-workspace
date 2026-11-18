import type { ComponentView } from '@locus/core/components'
import type { Workspace, WorkspaceRelation } from '@locus/core/workspaces'
import type { RemoteTarget } from '@locus/remote-targets'

export function workspaceText(workspace: Workspace): string {
  return [
    `Workspace: ${workspace.name}`,
    `Identity: ${workspace.id}`,
    `创建时间: ${workspace.createdAt}`,
    '挂载:',
    ...(workspace.mounts.length === 0 ? ['  无'] : workspace.mounts.map(mount => `  ${mountText(mount)}`)),
    '长期关系:',
    ...(workspace.relations.length === 0
      ? ['  无']
      : workspace.relations.map(relation => `  ${relationText(relation)}`)),
  ].join('\n')
}

export function componentText(view: ComponentView): string {
  const version = view.needsUpgrade ? `${view.version}（代码版本 ${view.codeVersion}，需要升级）` : view.version
  return [
    `组件：${view.id}`,
    `名称：${view.name}`,
    `种类：${view.kind}  来源：${view.source}`,
    `版本：${version}`,
    `依赖：${view.requires.length === 0 ? '无' : view.requires.join(', ')}`,
    `operation：${view.operations === undefined || view.operations.length === 0 ? '无' : view.operations.map(operation => operation.id).join(', ')}`,
    `凭据槽：${view.credentials === undefined || view.credentials.length === 0 ? '无' : view.credentials.map(credential => credential.id).join(', ')}`,
    `外部状态：${view.external === undefined ? '不适用' : (view.external.state ?? '未探查')}`,
    `部署状态：${view.deploy.state}  ${view.deploy.detail}`,
    `定义：${view.definitionPath}`,
  ].join('\n')
}

export function componentLine(view: ComponentView): string {
  const external = view.external === undefined ? '-' : (view.external.state ?? (view.external.detail || '未探查'))
  return `${view.id}  ${view.source}  ${view.kind}  ${view.version}  ${external}  ${view.deploy.state}`
}

export function relationText(relation: WorkspaceRelation): string {
  return `${relation.id}  ${relation.kind}  ${relation.target.namespace}  ${relation.target.id}  [${relation.source.kind}: ${relation.source.detail}]`
}

export function mountText(mount: Workspace['mounts'][number]): string {
  return `${mount.id}  ${mount.name}  ${mount.path}`
}

export function remoteTargetLine(target: RemoteTarget): string {
  return `${target.id}  ${target.connectivity.transport}  ${target.connectivity.via}  ${target.connectivity.host}:${target.connectivity.port}  ${target.identity.login}  ${target.identity.auth.method}`
}
