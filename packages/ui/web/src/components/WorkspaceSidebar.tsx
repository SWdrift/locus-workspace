import { useState, type FormEvent } from 'react'
import { Button } from '../dsh/primitives/Button'
import { Input } from '../dsh/primitives/Input'
import { Tooltip } from '../dsh/primitives/Tooltip.tsx'
import type { Health, Workspace } from '../types'
import styles from './WorkspaceSidebar.module.css'

export default function WorkspaceSidebar({
  workspaces,
  currentId,
  health,
  onCreate,
}: {
  readonly workspaces: readonly Workspace[]
  readonly currentId: string | undefined
  readonly health: Health | undefined
  readonly onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (name.trim().length === 0) {
      setError('请输入 Workspace 名称。')
      return
    }
    if (creating) return
    setError(undefined)
    setCreating(true)
    try {
      await onCreate(name)
      setName('')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className={styles.sidebar}>
      <div className={styles.sectionHead}>
        <h1 className={styles.title}>Workspaces</h1>
        <span className={styles.version}>{health?.version ?? '…'}</span>
      </div>
      <form className={styles.create} noValidate onSubmit={(event) => void submit(event)}>
        <Input
          className={error === undefined ? undefined : styles.invalidInput}
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            if (error !== undefined) setError(undefined)
          }}
          placeholder="新 Workspace 名称"
          autoComplete="off"
          required
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : 'create-workspace-error'}
        />
        {error === undefined ? null : <p id="create-workspace-error" className={styles.fieldError}>{error}</p>}
        <Button type="submit" variant="primary" size="sm" disabled={creating}>
          {creating ? '创建中…' : '创建'}
        </Button>
      </form>
      <nav className={styles.list} aria-label="Workspace 列表">
        {workspaces.map((workspace) => (
          <a
            key={workspace.id}
            href={`#/w/${encodeURIComponent(workspace.id)}`}
            className={workspace.id === currentId ? styles.itemCurrent : styles.item}
            aria-current={workspace.id === currentId ? 'true' : 'false'}
          >
            <Tooltip label={workspace.name} onlyWhenClipped portal maxWidth={260}>
              <span className={styles.itemName}>{workspace.name}</span>
            </Tooltip>
            <span className={styles.itemMeta}>{workspace.relations.length} 条关系</span>
          </a>
        ))}
        {workspaces.length === 0 ? <p className={styles.muted}>还没有 Workspace。</p> : null}
      </nav>
      <p className={styles.status}>
        {health === undefined
          ? '连接中…'
          : health.filesystemAvailable
            ? 'Filesystem 已加载'
            : 'Filesystem 未加载'}
      </p>
    </div>
  )
}
