import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  loadWorkspace,
  registerLocation,
  removeRelation,
  renameWorkspace,
  unregisterLocation,
} from '../api'
import Panel from '../primitives/Panel'
import { EmptyState, ErrorPanel, Loading } from '../primitives/States'
import type { WorkspaceDetail } from '../types'
import FilesystemBrowser from './FilesystemBrowser'
import styles from './WorkspacePage.module.css'

export default function WorkspacePage({
  workspaceId,
  onChanged,
}: {
  readonly workspaceId: string
  readonly onChanged: () => Promise<void>
}) {
  const [detail, setDetail] = useState<WorkspaceDetail | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [browseId, setBrowseId] = useState<string | undefined>(undefined)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const next = await loadWorkspace(workspaceId)
      setDetail(next)
      setName(next.workspace.name)
      setBrowseId((current) => next.locations.some((location) => location.id === current) ? current : undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void reload()
  }, [reload])

  const changed = useCallback(async () => {
    await reload()
    await onChanged()
  }, [onChanged, reload])

  async function submitRename(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (detail === undefined) return
    try {
      setError(undefined)
      await renameWorkspace(workspaceId, name)
      await changed()
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)))
    }
  }

  async function submitLocation(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (path.trim().length === 0) return
    try {
      setError(undefined)
      await registerLocation(workspaceId, path)
      setPath('')
      await changed()
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)))
    }
  }

  if (loading && detail === undefined) return <Loading>读取 Workspace…</Loading>
  if (error !== undefined && detail === undefined) {
    return <ErrorPanel error={error} onRetry={() => void reload()} />
  }
  if (detail === undefined) return <EmptyState title="Workspace 不存在">可能已被删除或服务已重载。</EmptyState>

  const workspace = detail.workspace
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>长期语境</p>
          <h1 className={styles.title}>{workspace.name}</h1>
          <p className={styles.mono}>{workspace.id}</p>
        </div>
        <form className={styles.rename} onSubmit={(event) => void submitRename(event)}>
          <input value={name} onChange={(event) => setName(event.target.value)} required />
          <button type="submit" className={styles.button}>改名</button>
        </form>
      </header>

      {error === undefined ? null : <ErrorPanel error={error} onRetry={() => void reload()} />}

      <Panel title="长期关系" meta={<span className={styles.count}>{workspace.relations.length}</span>}>
        {workspace.relations.length === 0 ? (
          <p className={styles.muted}>尚无成员或关联。在下方浏览位置后确认，或使用 CLI 显式关联。</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>种类</th>
                <th>命名空间</th>
                <th>引用</th>
                <th>来源</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {workspace.relations.map((relation) => (
                <tr key={relation.id}>
                  <td><span className={styles.kind}>{relation.kind}</span></td>
                  <td className={styles.mono}>{relation.target.namespace}</td>
                  <td className={styles.mono}>{relation.target.id}</td>
                  <td className={styles.source}>{relation.source.kind}: {relation.source.detail}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.danger}
                      onClick={() => {
                        if (!window.confirm('仅解除这条关系，不删除外部资源。继续？')) return
                        void (async () => {
                          try {
                            setError(undefined)
                            await removeRelation(workspaceId, relation.id)
                            await changed()
                          } catch (cause) {
                            setError(cause instanceof Error ? cause : new Error(String(cause)))
                          }
                        })()
                      }}
                    >
                      解除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="位置"
        meta={<span className={styles.count}>{detail.locations.length}</span>}
        description="登记只建立发现入口；浏览与确认是后续显式动作。"
      >
        {detail.filesystemAvailable ? (
          <form className={styles.register} onSubmit={(event) => void submitLocation(event)}>
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="要登记的本机绝对路径"
              required
            />
            <button type="submit" className={styles.button}>登记位置</button>
          </form>
        ) : (
          <p className={styles.muted}>当前 profile 未加载 Filesystem；已保存的 Workspace 与关系仍可查看。</p>
        )}
        {detail.locations.length === 0 ? (
          <p className={styles.muted}>尚未登记位置。</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>路径</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {detail.locations.map((location) => (
                <tr key={location.id}>
                  <td className={styles.mono}>{location.path}</td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.button}
                        onClick={() => setBrowseId(location.id)}
                      >
                        浏览
                      </button>
                      <button
                        type="button"
                        className={styles.danger}
                        onClick={() => {
                          if (!window.confirm('取消位置登记？文件与已确认关系不会被删除。')) return
                          void (async () => {
                            try {
                              setError(undefined)
                              await unregisterLocation(workspaceId, location.id)
                              if (browseId === location.id) setBrowseId(undefined)
                              await changed()
                            } catch (cause) {
                              setError(cause instanceof Error ? cause : new Error(String(cause)))
                            }
                          })()
                        }}
                      >
                        取消登记
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {detail.locations.filter((location) => location.id === browseId).map((location) => (
        <FilesystemBrowser
          key={location.id}
          workspaceId={workspaceId}
          location={location}
          onChanged={changed}
        />
      ))}
    </div>
  )
}
