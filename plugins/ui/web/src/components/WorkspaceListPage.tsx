import { useWorkspaces } from '../hooks'
import { EmptyState, ErrorPanel, Loading } from '../primitives/States'
import styles from './WorkspaceListPage.module.css'

export default function WorkspaceListPage() {
  const { data, loading, error, reload } = useWorkspaces()

  if (loading && data === undefined) {
    return <Loading>读取 Workspace…</Loading>
  }
  if (error !== undefined && data === undefined) {
    return <ErrorPanel error={error} onRetry={() => void reload()} />
  }

  const workspaces = data ?? []
  return (
    <>
      <div className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>长期语境</p>
          <h1 className={styles.title}>Workspaces</h1>
          <p className={styles.subtitle}>名称用于显示，Identity 用于稳定引用。</p>
        </div>
        <div className={styles.actions}>
          <span className={styles.count}>{workspaces.length}</span>
          <button type="button" className={styles.button} onClick={() => void reload()} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>

      {error === undefined ? null : <ErrorPanel error={error} onRetry={() => void reload()} />}

      {workspaces.length === 0 ? (
        <EmptyState title="还没有 Workspace">
          在 CLI 中执行 <code>workspace create &lt;name&gt;</code> 创建长期工作语境。Workspace 不依赖本地目录存在。
        </EmptyState>
      ) : (
        <div className={styles.list}>
          {workspaces.map((workspace) => (
            <a className={styles.card} href={`#/workspace/${encodeURIComponent(workspace.id)}`} key={workspace.id}>
              <div className={styles.cardMain}>
                <h2>{workspace.name}</h2>
                <div className={styles.mono}>{workspace.id}</div>
              </div>
              <div className={styles.cardMeta}>
                <span className={styles.tag}>{workspace.relations.length} 条长期关系</span>
                <span className={styles.tag}>{workspace.capabilities.length} 项能力选择</span>
                <span className={styles.created}>创建于 {workspace.createdAt}</span>
              </div>
              <span className={styles.chevron} aria-hidden="true">→</span>
            </a>
          ))}
        </div>
      )}
    </>
  )
}
