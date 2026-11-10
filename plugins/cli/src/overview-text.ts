import type {
  OverviewGiteaHead,
  OverviewGitRepository,
  OverviewProviderStatus,
  WorkspaceOverview,
} from '@locus/application'
import type { FilesystemObservation, GiteaRun } from '@locus/contracts'

function quoteArgument(value: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`
}

function command(parts: readonly string[]): string {
  return parts.map(quoteArgument).join(' ')
}

function providerText(provider: OverviewProviderStatus): string {
  const available = provider.available === null
    ? '未检查'
    : provider.available ? '是' : '否'
  return `${provider.id.replace(/^locus\./, '')}=选择${provider.selected ? '是' : '否'}/加载${provider.loaded ? '是' : '否'}/可用${available}`
}

function observationLine(prefix: string, value: FilesystemObservation): string {
  return `${prefix}${value.state} ${value.kind}${value.error === undefined ? '' : ` (${value.error})`}`
}

function gitLine(item: OverviewGitRepository): string {
  if (item.observation === undefined) return `${item.locationPath}  [未观察]`
  const value = item.observation
  if (value.state !== 'repository') {
    return `${item.locationPath}  ${value.state}${value.error === undefined ? '' : ` (${value.error})`}  [本次观察]`
  }
  return `${value.root ?? item.locationPath}  ${value.branch ?? 'detached HEAD'}  ${value.commit === null || value.commit === undefined ? '尚无提交' : value.commit.slice(0, 12)}  ${value.dirty ? '工作树有变化' : '工作树干净'}  [本次观察]`
}

function runLine(value: GiteaRun): string {
  return `#${value.runNumber} ${value.outcome} ${value.status}/${value.conclusion ?? '-'} ${value.headSha.slice(0, 12)}`
}

function giteaHeadLine(head: OverviewGiteaHead): string {
  const state = head.runsState === undefined ? head.state : `${head.state}/${head.runsState}`
  return `本地 HEAD ${head.commit === undefined ? '-' : head.commit.slice(0, 12)} -> ${state}${head.runs.length === 0 ? '' : `：${head.runs.map(runLine).join('；')}`}${head.error === undefined ? '' : ` (${head.error})`}`
}

function actionsLine(actions: readonly string[]): string[] {
  return actions.length === 0 ? [] : [`    下一步: ${actions.join('；')}`]
}

export function overviewText(value: WorkspaceOverview): string {
  const lines: string[] = [
    `Workspace: ${value.workspace.name}`,
    `Identity: ${value.workspace.id}`,
    `创建时间: ${value.workspace.createdAt}`,
    `能力选择: ${value.workspace.capabilities.map((item) => `${item.id} (${item.provider})`).join(', ') || '无'}`,
    `提供方: ${value.providers.map(providerText).join('；')}`,
    `模式: ${value.mode === 'observed' ? '本次实时观察' : '长期关系与本地配置，未执行实时观察'}`,
    `耗时: ${value.durationMs}ms${value.mode === 'observed' ? '（各段只读查询可重叠）' : ''}`,
  ]

  const hasContent = (providerId: string, count: number): boolean =>
    count > 0 || value.providers.some((provider) => provider.id === providerId && provider.selected)

  if (hasContent('locus.filesystem', value.filesystem.locations.length + value.filesystem.relations.length)) {
    lines.push('', `Filesystem [${value.filesystem.state}]`)
    for (const relation of value.filesystem.relations) {
      lines.push(`  关联 ${relation.relationId}  ${relation.reference.id}  [已确认]`)
    }
    for (const item of value.filesystem.locations) {
      lines.push(`  位置 ${item.location.id}  ${item.location.path}  [配置]`)
      if (item.observation !== undefined) lines.push(`    ${observationLine('', item.observation)}  [本次观察]`)
      else lines.push('    未观察')
      for (const relationId of item.confirmedRelations) {
        lines.push(`    已确认关系 ${relationId}`)
      }
      if (item.observation?.state !== 'accessible' || item.error !== undefined) {
        lines.push(...actionsLine(item.actions))
      }
      if (item.error !== undefined) lines.push(`    错误: ${item.error}`)
    }
    if (value.filesystem.error !== undefined) lines.push(`  错误: ${value.filesystem.error}`)
  }

  if (hasContent('locus.git', value.git.repositories.length + value.git.relations.length)) {
    lines.push('', `Git [${value.git.state}]`)
    for (const relation of value.git.relations) {
      lines.push(`  关联 ${relation.relationId}  ${relation.reference.id}  [已确认]`)
    }
    for (const item of value.git.repositories) {
      lines.push(`  位置 ${item.locationId}  ${gitLine(item)}`)
      for (const relationId of item.confirmedRelations) {
        lines.push(`    已确认关系 ${relationId}`)
      }
      if (item.state === 'not-observed' || item.observation?.dirty === true || item.observation?.state === 'error' ||
        item.observation?.state === 'unavailable' || item.error !== undefined) {
        lines.push(...actionsLine(item.actions))
      }
    }
    if (value.git.error !== undefined) lines.push(`  错误: ${value.git.error}`)
  }

  if (hasContent('locus.gitea', value.gitea.repositories.length)) {
    lines.push('', `Gitea [${value.gitea.state}]`)
    for (const item of value.gitea.repositories) {
      lines.push(`  关联 ${item.relationId}  ${item.reference.id}  [已确认]`)
      if (item.repository !== undefined) {
        lines.push(`    仓库 ${item.repository.fullName}  ${item.instance?.name ?? item.repository.instanceId}  ${item.state}  [本次观察]`)
        if (item.latestRun !== undefined) lines.push(`    最近 Run ${runLine(item.latestRun)}`)
        if (item.head !== undefined) {
          lines.push(`    ${giteaHeadLine(item.head)}`)
          lines.push(`    ${item.head.note}`)
        }
      } else {
        lines.push(item.state === 'not-observed'
          ? '    未观察'
          : `    仓库不可用: ${item.state}${item.error === undefined ? '' : ` (${item.error})`}`)
      }
      lines.push(...actionsLine(item.actions))
    }
    if (value.gitea.error !== undefined) lines.push(`  错误: ${value.gitea.error}`)
  }

  if (hasContent('locus.session', value.sessions.links.length)) {
    lines.push('', `Session [${value.sessions.state}]`)
    if (value.sessions.links.length === 0) {
      lines.push(`  下一步: ${command(['session', 'list'])}`)
    }
    for (const item of value.sessions.links) {
      const summary = item.summary
      const detail = summary === undefined
        ? '未观察'
        : `${summary.state}  ${summary.live ? 'live' : ''}${summary.live && summary.persisted ? '/' : ''}${summary.persisted ? 'persisted' : ''}${summary.title === undefined ? '' : `  ${summary.title}`}`
      lines.push(`  关联 ${item.relationId}  ${item.reference.id}  来源 ${item.sourceLabel ?? item.sourceId}  [已确认]  ${detail}`)
      lines.push(...actionsLine(item.actions))
      if (item.error !== undefined) lines.push(`    ${item.error}`)
    }
    if (value.sessions.error !== undefined) lines.push(`  错误: ${value.sessions.error}`)
  }

  if (hasContent('locus.remote-machine', value.machines.items.length)) {
    lines.push('', `Remote Machine [${value.machines.state}]`)
    for (const item of value.machines.items) {
      if (item.machine === undefined) {
        lines.push(`  关联 ${item.relationId}  ${item.machineId}  unavailable${item.error === undefined ? '' : ` (${item.error})`}`)
        continue
      }
      const addresses = item.machine.addresses.map((address) =>
        `${address.kind}:${address.value}${address.port === undefined ? '' : `:${address.port}`}`).join(', ')
      lines.push(`  关联 ${item.relationId}  ${item.machine.name} (${item.machine.id})  ${addresses || '无地址'}  Profile=${item.profileCount === 0 ? '未配置' : item.profileCount ?? '未检查'}`)
      lines.push(...actionsLine(item.actions))
    }
    if (value.machines.error !== undefined) lines.push(`  错误: ${value.machines.error}`)
  }

  if (hasContent('locus.connectivity', value.connectivity.profiles.length)) {
    lines.push('', `Connectivity [${value.connectivity.state}]`)
    for (const item of value.connectivity.profiles) {
      const profile = item.profile
      const target = `${profile.target}${profile.port === undefined ? '' : `:${profile.port}`}`
      const detail = item.inspection === undefined
        ? '未检查'
        : `${item.inspection.state}${item.inspection.resolved === undefined ? '' : `  有效目标 ${item.inspection.resolved.hostname}:${item.inspection.resolved.port}`}`
      lines.push(`  Profile ${profile.id}  ${profile.name}  ${profile.transport}  ${target}  [配置]  ${detail}`)
      lines.push(...actionsLine(item.actions))
      if (item.error !== undefined) lines.push(`    ${item.error}`)
    }
    if (value.connectivity.error !== undefined) lines.push(`  错误: ${value.connectivity.error}`)
  }

  if (value.gitea.suggestions.length > 0) {
    lines.push('', '建议（未确认）')
    for (const item of value.gitea.suggestions) {
      lines.push(`  ${item.remoteName}  ${item.remoteUrl}  ->  ${item.instanceName}  ${item.fullName}  [${item.matchedBy}]  位置 ${item.locationId}`)
      lines.push(...actionsLine(item.actions))
    }
  }

  if (value.otherRelations.length > 0) {
    lines.push('', '其他长期关系')
    for (const relation of value.otherRelations) {
      lines.push(`  ${relation.relationId}  ${relation.kind}  ${relation.reference.namespace}  ${relation.reference.id}  [已确认]`)
    }
  }

  if (value.attention.length > 0) {
    lines.push('', '需要注意')
    for (const item of value.attention) lines.push(`  - [${item.domain}] ${item.message}`)
  }

  if (value.next.length > 0) {
    lines.push('', '继续操作')
    for (const item of value.next) lines.push(`  ${item}`)
  }

  lines.push('', '说明: 已确认关系来自 Core；[本次观察] 只代表本次查询；[建议] 尚未写入关系。CI 成功不代表部署成功，Connection Profile 配置不代表连接成功，Session persisted 不代表 Agent 当前正在工作。')
  return lines.join('\n')
}
