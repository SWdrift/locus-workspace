import type {
  OverviewAttention,
  OverviewConnectivity,
  OverviewFilesystem,
  OverviewGitea,
  OverviewGit,
  OverviewMachines,
  OverviewProviderStatus,
  OverviewRelation,
  OverviewSessions,
} from '@locus/application'
import clsx from 'clsx'
import DisclosureRow from '../../primitives/DisclosureRow'
import DefinitionList from '../../primitives/DefinitionList'
import Panel from '../../primitives/Panel'
import StateBadge from '../../primitives/StateBadge'
import styles from './DomainPanels.module.css'

function referenceName(reference: OverviewRelation['reference']): string {
  return `${reference.namespace}:${reference.id}`
}

export function RelationGroup({ relations }: { readonly relations: readonly OverviewRelation[] }) {
  if (relations.length === 0) return <p className={styles.muted}>无已确认关系。</p>
  return (
    <div className={styles.relations}>
      {relations.map((relation) => (
        <div className={styles.relation} key={relation.relationId}>
          <div className={styles.relationHead}>
            <span className={styles.mono}>{relation.relationId}</span>
            <StateBadge value={relation.kind} />
            <span className={styles.tag}>已确认</span>
          </div>
          <div className={clsx(styles.mono, styles.small)}>{referenceName(relation.reference)}</div>
          <div className={clsx(styles.muted, styles.small)}>
            来源 {relation.source.kind}：{relation.source.detail}
          </div>
        </div>
      ))}
    </div>
  )
}

export function ProviderChips({ providers }: { readonly providers: readonly OverviewProviderStatus[] }) {
  return (
    <div className={styles.chips}>
      {providers.map((provider) => {
        const availability = provider.available === null ? '未检查' : provider.available ? '可用' : '不可用'
        return (
          <span className={styles.chip} title={provider.error ?? ''} key={provider.id}>
            <span className={styles.mono}>{provider.id.replace(/^locus\./, '')}</span>
            <span className={clsx(styles.muted, styles.small)}>
              选择 {provider.selected ? '是' : '否'} · 加载 {provider.loaded ? '是' : '否'} · {availability}
            </span>
          </span>
        )
      })}
    </div>
  )
}

export function AttentionPanel({ items }: { readonly items: readonly OverviewAttention[] }) {
  if (items.length === 0) return null
  return (
    <Panel title="需要注意" tone="attention">
      <ul className={styles.attention}>
        {items.map((item) => (
          <li key={`${item.domain}:${item.code}`}>
            <span className={styles.tag}>{item.domain}</span>
            {item.message}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

export function FilesystemPanel({ value }: { readonly value: OverviewFilesystem }) {
  return (
    <Panel
      title="Filesystem"
      state={value.state}
      error={value.error}
      description="位置配置是长期事实；状态与观察只代表当前查询。"
    >
      <RelationGroup relations={value.relations} />
      {value.locations.length === 0 ? <p className={styles.muted}>没有登记位置。</p> : value.locations.map((item) => (
        <DisclosureRow
          key={item.location.id}
          defaultOpen={item.state !== 'not-observed'}
          summary={(
            <>
              <span className={styles.mono}>{item.location.path}</span>
              <StateBadge value={item.state} />
            </>
          )}
        >
          <DefinitionList items={[
            ['Location ID', item.location.id],
            ['引用', referenceName(item.location.reference)],
            ['本次观察', item.observation === undefined
              ? '未观察'
              : `${item.observation.state} / ${item.observation.kind} · ${item.observation.observedAt}`],
            ['观察错误', item.observation?.error],
            ['已确认关系', item.confirmedRelations.length === 0 ? '无' : item.confirmedRelations.join(', ')],
            ['建议下一步（CLI）', item.actions.join('；')],
          ]} />
          {item.error === undefined ? null : <p className={styles.errorText}>{item.error}</p>}
        </DisclosureRow>
      ))}
    </Panel>
  )
}

export function GitPanel({ value }: { readonly value: OverviewGit }) {
  return (
    <Panel
      title="Git"
      state={value.state}
      error={value.error}
      description="仓库、分支与提交来自原生 Git；未观察时不会伪造状态。"
    >
      <RelationGroup relations={value.relations} />
      {value.repositories.length === 0 ? <p className={styles.muted}>没有可用于 Git 观察的位置。</p> : value.repositories.map((item) => (
        <DisclosureRow
          key={item.locationId}
          defaultOpen={item.state !== 'not-observed'}
          summary={(
            <>
              <span className={styles.mono}>{item.locationPath}</span>
              <StateBadge value={item.state} />
            </>
          )}
        >
          <DefinitionList items={[
            ['Location ID', item.locationId],
            ['仓库根', item.observation?.root],
            ['分支', item.observation?.branch === null ? 'detached HEAD' : item.observation?.branch],
            ['提交', item.observation?.commit === null ? '尚无提交' : item.observation?.commit],
            ['工作树', item.observation?.dirty === undefined ? undefined : item.observation.dirty ? '有变化' : '干净'],
            ['Remote', item.observation?.remotes?.map((remote) => `${remote.name}: ${remote.url}`).join('；')],
            ['观察时间', item.observation?.observedAt],
            ['已确认关系', item.confirmedRelations.length === 0 ? '无' : item.confirmedRelations.join(', ')],
            ['建议下一步（CLI）', item.actions.join('；')],
          ]} />
          {item.error === undefined ? null : <p className={styles.errorText}>{item.error}</p>}
        </DisclosureRow>
      ))}
    </Panel>
  )
}

function runLine(run: { readonly runNumber: number; readonly outcome: string; readonly status: string; readonly conclusion: string | null; readonly headSha: string }): string {
  return `#${run.runNumber} ${run.outcome} · ${run.status}/${run.conclusion ?? '-'} · ${run.headSha.slice(0, 12)}`
}

export function GiteaPanel({ value }: { readonly value: OverviewGitea }) {
  return (
    <Panel
      title="Gitea"
      state={value.state}
      error={value.error}
      description="仓库与 Run 来自外部 Gitea；CI 成功不代表部署成功。"
    >
      {value.repositories.length === 0
        ? <p className={styles.muted}>没有已确认的 Gitea 仓库关系。</p>
        : value.repositories.map((item) => (
          <DisclosureRow
            key={item.relationId}
            summary={(
              <>
                <span className={styles.mono}>{item.reference.id}</span>
                <StateBadge value={item.state} />
              </>
            )}
          >
            <DefinitionList items={[
              ['关系 ID', item.relationId],
              ['实例', item.instance === undefined ? item.instanceId : `${item.instance.name} (${item.instance.baseUrl})`],
              ['仓库', item.repository?.fullName],
              ['默认分支', item.repository?.defaultBranch],
              ['Actions', item.repository === undefined ? undefined : item.repository.hasActions ? '已启用' : '未启用'],
              ['本次观察', item.observedAt],
              ['最近 Run', item.latestRun === undefined ? undefined : runLine(item.latestRun)],
              ['HEAD 对应', item.head === undefined
                ? undefined
                : `${item.head.state}${item.head.runsState === undefined ? '' : ` / ${item.head.runsState}`} · ${item.head.note}`],
              ['HEAD Commit', item.head?.commit],
              ['Run 列表', item.head?.runs.length === 0 ? undefined : item.head?.runs.map(runLine).join('；')],
              ['错误', item.error],
              ['建议下一步（CLI）', item.actions.join('；')],
            ]} />
          </DisclosureRow>
        ))}
      {value.suggestions.length === 0 ? null : (
        <>
          <h3 className={styles.subhead}>未确认建议</h3>
          <p className={styles.muted}>由本地 Git Remote 生成；未写入 Workspace 关系。</p>
          {value.suggestions.map((item) => (
            <DisclosureRow
              key={`${item.instanceId}:${item.fullName}:${item.remoteName}`}
              summary={(
                <>
                  <span className={styles.mono}>{item.fullName}</span>
                  <span className={clsx(styles.tag, styles.suggested)}>未确认建议</span>
                </>
              )}
            >
              <DefinitionList items={[
                ['Remote', `${item.remoteName}: ${item.remoteUrl}`],
                ['实例', `${item.instanceName} (${item.instanceId})`],
                ['匹配方式', item.matchedBy],
                ['本地位置', item.locationPath],
                ['分支', item.branch],
                ['提交', item.commit],
                ['建议下一步（CLI）', item.actions.join('；')],
              ]} />
            </DisclosureRow>
          ))}
        </>
      )}
    </Panel>
  )
}

export function SessionsPanel({ value }: { readonly value: OverviewSessions }) {
  return (
    <Panel
      title="Session"
      state={value.state}
      error={value.error}
      description="Session 标题与执行状态仍由 DSH 拥有；persisted 不代表 Agent 正在工作。"
    >
      {value.links.length === 0
        ? <p className={styles.muted}>没有已确认的 Session 关联。</p>
        : value.links.map((item) => (
          <DisclosureRow
            key={item.relationId}
            summary={(
              <>
                <span className={styles.mono}>{item.reference.id}</span>
                <StateBadge value={item.state} />
              </>
            )}
          >
            <DefinitionList items={[
              ['关系 ID', item.relationId],
              ['来源', `${item.sourceLabel ?? '未知'} (${item.sourceId})`],
              ['摘要状态', item.summary === undefined
                ? '未观察'
                : `${item.summary.state}${item.summary.live ? ' · live' : ''}${item.summary.persisted ? ' · persisted' : ''}`],
              ['标题', item.summary?.title],
              ['原始错误', item.summary?.error ?? item.error],
              ['建议下一步（CLI）', item.actions.join('；')],
            ]} />
          </DisclosureRow>
        ))}
    </Panel>
  )
}

export function MachinesPanel({ value }: { readonly value: OverviewMachines }) {
  return (
    <Panel
      title="Remote Machine"
      state={value.state}
      error={value.error}
      description="登记不要求机器在线；观察只针对单个 SSH 地址。"
    >
      {value.items.length === 0
        ? <p className={styles.muted}>没有已确认的机器关联。</p>
        : value.items.map((item) => (
          <DisclosureRow
            key={item.relationId}
            summary={(
              <>
                <span className={styles.mono}>{item.machine?.name ?? item.machineId}</span>
                <StateBadge value={item.state} />
              </>
            )}
          >
            <DefinitionList items={[
              ['关系 ID', item.relationId],
              ['Machine ID', item.machineId],
              ['描述', item.machine?.description],
              ['地址', item.machine?.addresses
                .map((address) => `${address.kind}:${address.value}${address.port === undefined ? '' : `:${address.port}`}`)
                .join('；')],
              ['Connection Profile', item.profileCount === null ? '未检查' : item.profileCount],
              ['错误', item.error],
              ['建议下一步（CLI）', item.actions.join('；')],
            ]} />
          </DisclosureRow>
        ))}
    </Panel>
  )
}

export function ConnectivityPanel({ value }: { readonly value: OverviewConnectivity }) {
  return (
    <Panel
      title="Connectivity"
      state={value.state}
      error={value.error}
      description="Profile 只保存连接约定；配置不证明连接成功，UI 不显示身份文件路径。"
    >
      {value.profiles.length === 0
        ? <p className={styles.muted}>关联机器没有 Connection Profile。</p>
        : value.profiles.map((item) => (
          <DisclosureRow
            key={item.profile.id}
            summary={(
              <>
                <span className={styles.mono}>{item.profile.name}</span>
                <StateBadge value={item.state} />
              </>
            )}
          >
            <DefinitionList items={[
              ['Profile ID', item.profile.id],
              ['Machine ID', item.profile.machineId],
              ['Transport', item.profile.transport],
              ['目标', `${item.profile.target}${item.profile.port === undefined ? '' : `:${item.profile.port}`}${item.profile.user === undefined ? '' : ` · ${item.profile.user}`}`],
              ['ProxyJump', item.profile.proxyJump],
              ['身份文件', item.profile.identityConfigured ? '已配置（未显示路径）' : 'OpenSSH 默认'],
              ['known_hosts', item.profile.knownHostsConfigured ? '已配置（未显示路径）' : 'OpenSSH 默认'],
              ['SSH 配置', item.profile.sshConfigConfigured ? '已配置（未显示路径）' : 'OpenSSH 默认'],
              ['检查状态', item.inspection?.state],
              ['有效目标', item.inspection?.resolved === undefined
                ? undefined
                : `${item.inspection.resolved.hostname}:${item.inspection.resolved.port} · ${item.inspection.resolved.user}`],
              ['检查项', item.inspection?.checks.map((check) => `[${check.state}] ${check.code}: ${check.message}`).join('\n')],
              ['错误', item.error],
              ['建议下一步（CLI）', item.actions.join('；')],
            ]} />
          </DisclosureRow>
        ))}
    </Panel>
  )
}

export function OtherRelationsPanel({ relations }: { readonly relations: readonly OverviewRelation[] }) {
  if (relations.length === 0) return null
  return (
    <Panel title="其他长期关系">
      <RelationGroup relations={relations} />
    </Panel>
  )
}
