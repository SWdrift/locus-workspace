import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button } from '../dsh/primitives/Button.tsx'
import { Input } from '../dsh/primitives/Input.tsx'
import { RiskConfirmation } from '../dsh/primitives/RiskConfirmation.tsx'
import { Tag } from '../dsh/primitives/Tag.tsx'
import { Tooltip } from '../dsh/primitives/Tooltip.tsx'
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

interface PendingAction {
  readonly title: string
  readonly description: string
  readonly acknowledgeLabel: string
  readonly confirmLabel: string
  readonly action: () => Promise<void>
}

export default function WorkspacePage({
  workspaceId,
  onChanged,
  onNotify,
}: {
  readonly workspaceId: string
  readonly onChanged: () => Promise<void>
  readonly onNotify: (text: string) => void
}) {
  const [detail, setDetail] = useState<WorkspaceDetail | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [browseId, setBrowseId] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState<PendingAction | undefined>(undefined)
  const [acknowledged, setAcknowledged] = useState(false)
  const [renameError, setRenameError] = useState<string | undefined>(undefined)
  const [pathError, setPathError] = useState<string | undefined>(undefined)

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

  async function run(action: () => Promise<void>): Promise<void> {
    try {
      setError(undefined)
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)))
    }
  }

  function ask(action: PendingAction): void {
    setAcknowledged(false)
    setPending(action)
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
          <Tooltip label={workspace.id} onlyWhenClipped portal maxWidth={420}>
            <p className={styles.mono}>{workspace.id}</p>
          </Tooltip>
        </div>
        <form
          className={styles.rename}
          noValidate
          onSubmit={(event: FormEvent) => {
            event.preventDefault()
            if (name.trim().length === 0) {
              setRenameError('请输入 Workspace 名称。')
              return
            }
            setRenameError(undefined)
            void run(async () => {
              await renameWorkspace(workspaceId, name)
              onNotify(`已改名：${name}`)
              await changed()
            })
          }}
        >
          <Input
            className={renameError === undefined ? undefined : styles.invalidInput}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              if (renameError !== undefined) setRenameError(undefined)
            }}
            required
            aria-invalid={renameError === undefined ? undefined : true}
            aria-describedby={renameError === undefined ? undefined : 'rename-workspace-error'}
          />
          <Button type="submit" variant="outline" size="sm">改名</Button>
          {renameError === undefined ? null : <p id="rename-workspace-error" className={styles.fieldError}>{renameError}</p>}
        </form>
      </header>

      {error === undefined ? null : <ErrorPanel error={error} onRetry={() => void reload()} />}

      <Panel
        title="长期关系"
        meta={<Tag tone="neutral">{String(workspace.relations.length)}</Tag>}
        description="成员与关联是显式长期事实；解除关系不删除外部资源。"
      >
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
                  <td><Tag tone={relation.kind === 'member' ? 'info' : 'neutral'}>{relation.kind}</Tag></td>
                  <td className={styles.mono}>{relation.target.namespace}</td>
                  <td className={styles.mono}>{relation.target.id}</td>
                  <td className={styles.source}>{relation.source.kind}: {relation.source.detail}</td>
                  <td className={styles.actionCell}>
                    <Tooltip label="只解除关系，不删除外部资源" delayMs={300}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={styles.danger}
                        onClick={() => ask({
                        title: '解除长期关系',
                        description: '仅解除这条关系，不删除外部资源、其他 Workspace 的归属或原生文件。',
                        acknowledgeLabel: '我了解解除关系不会删除外部资源',
                        confirmLabel: '解除关系',
                        action: async () => {
                          await removeRelation(workspaceId, relation.id)
                          onNotify('已解除关系')
                          await changed()
                        },
                        })}
                      >
                        解除
                      </Button>
                    </Tooltip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="位置"
        meta={<Tag tone="neutral">{String(detail.locations.length)}</Tag>}
        description="登记只建立发现入口；浏览与确认是后续显式动作。"
      >
        {detail.filesystemAvailable ? (
          <form
            className={styles.register}
            noValidate
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              if (path.trim().length === 0) {
                setPathError('请输入要登记的本机绝对路径。')
                return
              }
              setPathError(undefined)
              void run(async () => {
                await registerLocation(workspaceId, path)
                setPath('')
                onNotify('已登记位置')
                await changed()
              })
            }}
          >
            <Input
              className={pathError === undefined ? styles.grow : `${styles.grow} ${styles.invalidInput}`}
              value={path}
              onChange={(event) => {
                setPath(event.target.value)
                if (pathError !== undefined) setPathError(undefined)
              }}
              placeholder="要登记的本机绝对路径"
              required
              aria-invalid={pathError === undefined ? undefined : true}
              aria-describedby={pathError === undefined ? undefined : 'register-location-error'}
            />
            <Tooltip label="只建立发现入口，不确认成员" delayMs={300}>
              <Button type="submit" variant="primary" size="sm">登记位置</Button>
            </Tooltip>
            {pathError === undefined ? null : <p id="register-location-error" className={styles.fieldError}>{pathError}</p>}
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
                  <td>
                    <Tooltip label={location.path} onlyWhenClipped portal maxWidth={560}>
                      <span className={styles.mono}>{location.path}</span>
                    </Tooltip>
                  </td>
                  <td className={styles.actionCell}>
                    <div className={styles.actions}>
                      <Tooltip label="查看该位置的一层内容" delayMs={300}>
                        <Button variant="outline" size="sm" onClick={() => setBrowseId(location.id)}>浏览</Button>
                      </Tooltip>
                      <Tooltip label="只取消发现入口，不删除文件或长期关系" delayMs={300}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={styles.danger}
                          onClick={() => ask({
                          title: '取消位置登记',
                          description: '取消发现入口，不删除文件、目录或此前已确认的长期关系。',
                          acknowledgeLabel: '我了解文件与长期关系不会被删除',
                          confirmLabel: '取消登记',
                          action: async () => {
                            await unregisterLocation(workspaceId, location.id)
                            if (browseId === location.id) setBrowseId(undefined)
                            onNotify('已取消位置登记')
                            await changed()
                          },
                          })}
                        >
                          取消登记
                        </Button>
                      </Tooltip>
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
          onNotify={onNotify}
        />
      ))}

      <RiskConfirmation
        open={pending !== undefined}
        title={pending?.title ?? ''}
        description={pending?.description ?? ''}
        acknowledgeLabel={pending?.acknowledgeLabel ?? ''}
        cancelLabel="取消"
        closeLabel="关闭"
        confirmLabel={pending?.confirmLabel ?? '确认'}
        acknowledged={acknowledged}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => setPending(undefined)}
        onConfirm={() => {
          const action = pending
          setPending(undefined)
          if (action !== undefined) void run(action.action)
        }}
      />
    </div>
  )
}
