import { useCallback, useEffect, useState } from 'react'
import {
  confirmResource,
  discoverLocation,
  readLocation,
} from '../api'
import Panel from '../primitives/Panel'
import CodeBlock from '../primitives/CodeBlock'
import { ErrorPanel, Loading } from '../primitives/States'
import type {
  FilesystemDiscovery,
  FilesystemLocation,
  FilesystemRead,
} from '../types'
import styles from './FilesystemBrowser.module.css'

function entryName(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0)
  return parts.at(-1) ?? path
}

function childRelative(base: string | undefined, name: string): string {
  return base === undefined || base === '' ? name : `${base}/${name}`
}

export default function FilesystemBrowser({
  workspaceId,
  location,
  onChanged,
}: {
  readonly workspaceId: string
  readonly location: FilesystemLocation
  readonly onChanged: () => Promise<void>
}) {
  const [relative, setRelative] = useState<string | undefined>(undefined)
  const [discovery, setDiscovery] = useState<FilesystemDiscovery | undefined>(undefined)
  const [read, setRead] = useState<FilesystemRead | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | undefined>(undefined)

  const load = useCallback(async (target: string | undefined) => {
    setLoading(true)
    setError(undefined)
    setRead(undefined)
    try {
      const result = await discoverLocation(workspaceId, location.id, target)
      setDiscovery(result)
      setRelative(target)
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)))
    } finally {
      setLoading(false)
    }
  }, [location.id, workspaceId])

  useEffect(() => {
    void load(undefined)
  }, [load])

  async function openEntry(kind: string, target: string): Promise<void> {
    if (kind === 'directory') {
      await load(target)
      return
    }
    try {
      setError(undefined)
      setRead(await readLocation(workspaceId, location.id, target))
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)))
    }
  }

  async function confirm(target: string | undefined, kind: 'member' | 'association'): Promise<void> {
    try {
      setError(undefined)
      await confirmResource(workspaceId, location.id, target, kind)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)))
    }
  }

  const parts = relative === undefined ? [] : relative.split('/').filter(Boolean)
  return (
    <Panel
      title={`浏览：${location.path}`}
      meta={<span className={styles.count}>{discovery?.entries.length ?? 0} 项</span>}
    >
      <div className={styles.breadcrumb} aria-label="路径">
        <button type="button" className={styles.crumb} onClick={() => void load(undefined)}>根目录</button>
        {parts.map((part, index) => (
          <button
            key={`${part}-${index}`}
            type="button"
            className={styles.crumb}
            onClick={() => void load(parts.slice(0, index + 1).join('/'))}
          >
            {part}
          </button>
        ))}
        <button type="button" className={styles.crumbAction} onClick={() => void confirm(relative, 'member')}>
          确认当前目录
        </button>
      </div>
      {error === undefined ? null : <ErrorPanel error={error} onRetry={() => void load(relative)} />}
      {loading ? <Loading>读取位置…</Loading> : null}
      {!loading && discovery !== undefined && discovery.root.state !== 'accessible' ? (
        <p className={styles.problem}>{discovery.root.state}{discovery.root.error === undefined ? '' : `：${discovery.root.error}`}</p>
      ) : null}
      {!loading && discovery !== undefined && discovery.root.state === 'accessible' ? (
        <ul className={styles.entries}>
          {discovery.entries.map((entry) => {
            const name = entryName(entry.path)
            const target = childRelative(relative, name)
            return (
              <li key={entry.path}>
                <span className={styles.kind}>{entry.kind}</span>
                <button type="button" className={styles.name} onClick={() => void openEntry(entry.kind, target)}>
                  {name}
                </button>
                {entry.state === 'accessible' ? (
                  <button type="button" className={styles.action} onClick={() => void confirm(target, 'member')}>
                    确认成员
                  </button>
                ) : <span className={styles.problem}>{entry.state}</span>}
              </li>
            )
          })}
        </ul>
      ) : null}
      {discovery?.truncated === true ? <p className={styles.note}>结果已截断。</p> : null}
      {read === undefined ? null : (
        <div className={styles.reader}>
          <div className={styles.readerHead}>
            <span className={styles.readerPath}>{read.resource.path}</span>
            {read.truncated ? <span className={styles.count}>已截断</span> : null}
          </div>
          <CodeBlock>{read.text}</CodeBlock>
        </div>
      )}
    </Panel>
  )
}
