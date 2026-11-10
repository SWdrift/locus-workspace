import { useOperations, useOverview } from '../hooks'
import CodeBlock from '../primitives/CodeBlock'
import DisclosureRow from '../primitives/DisclosureRow'
import StateBadge from '../primitives/StateBadge'
import { EmptyState, ErrorPanel, Loading } from '../primitives/States'
import OperationPanel from './OperationPanel'
import {
  AttentionPanel,
  ConnectivityPanel,
  FilesystemPanel,
  GiteaPanel,
  GitPanel,
  MachinesPanel,
  OtherRelationsPanel,
  ProviderChips,
  SessionsPanel,
} from './panels/DomainPanels'
import styles from './WorkspaceOverviewPage.module.css'

export default function WorkspaceOverviewPage({ workspaceId }: { readonly workspaceId: string }) {
  const { data, loading, error, observe, setObserve, reload } = useOverview(workspaceId)
  const operations = useOperations()

  if (loading && data === undefined) return <Loading>组合 Workspace Overview…</Loading>
  if (error !== undefined && data === undefined) return <ErrorPanel error={error} onRetry={() => void reload()} />
  if (data === undefined) {
    return <EmptyState title="Workspace 不存在">请返回列表并重新选择 Workspace。</EmptyState>
  }

  return (
    <div className={styles.page}>
      <section className={styles.head}>
        <div>
          <a className={styles.back} href="#/">← Workspaces</a>
          <h1 className={styles.title}>{data.workspace.name}</h1>
          <div className={styles.mono}>{data.workspace.id}</div>
          <div className={styles.summaryLine}>
            <StateBadge value={data.mode === 'observed' ? 'observed' : 'not-observed'} />
            <span className={styles.muted}>
              {data.mode === 'observed' ? '包含本次只读观察' : '仅长期关系与本地配置，未执行实时观察'}
            </span>
          </div>
        </div>
        <div className={styles.controls}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={observe}
              onChange={(event) => setObserve(event.target.checked)}
            />
            刷新时包含只读观察
          </label>
          <button type="button" className={styles.primary} onClick={() => void reload()} disabled={loading}>
            {loading ? '刷新中…' : '刷新 Overview'}
          </button>
          <div className={styles.mutedSmall}>生成于 {data.generatedAt} · {data.durationMs}ms</div>
        </div>
      </section>

      {error === undefined ? null : <ErrorPanel error={error} onRetry={() => void reload()} />}
      <ProviderChips providers={data.providers} />
      <AttentionPanel items={data.attention} />
      <FilesystemPanel value={data.filesystem} />
      <GitPanel value={data.git} />
      <GiteaPanel value={data.gitea} />
      <SessionsPanel value={data.sessions} />
      <MachinesPanel value={data.machines} />
      <ConnectivityPanel value={data.connectivity} />
      <OtherRelationsPanel relations={data.otherRelations} />
      <OperationPanel
        workspaceId={data.workspace.id}
        definitions={operations.data}
        loading={operations.loading}
        error={operations.error}
      />
      {data.next.length === 0 ? null : (
        <DisclosureRow summary="CLI 下一步提示">
          <CodeBlock>{data.next.join('\n')}</CodeBlock>
        </DisclosureRow>
      )}
    </div>
  )
}
