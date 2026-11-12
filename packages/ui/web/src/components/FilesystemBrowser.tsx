import { useCallback, useEffect, useState } from 'react'
import { Button } from '../dsh/primitives/Button'
import { Tag } from '../dsh/primitives/Tag'
import { Tooltip } from '../dsh/primitives/Tooltip'
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
  onNotify,
}: {
  readonly workspaceId: string
  readonly location: FilesystemLocation
  readonly onChanged: () => Promise<void>
  readonly onNotify: (text: string) => void
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
      onNotify('已确认长期关系')
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)))
    }
  }

  const parts = relative === undefined ? [] : relative.split('/').filter(Boolean)
  return (
    <Panel
      title={`浏览：${location.path}`}
      meta={<Tag tone="neutral">{`${discovery?.entries.length ?? 0} 项`}</Tag>}
      description="单层发现，不递归、不跟随符号链接。"
    >
      <div className={styles.breadcrumb} aria-label="路径">
        <Button variant="ghost" size="sm" onClick={() => void load(undefined)}>根目录</Button>
        {parts.map((part, index) => (
          <Button
            key={`${part}-${index}`}
            variant="ghost"
            size="sm"
            onClick={() => void load(parts.slice(0, index + 1).join('/'))}
          >
            {part}
          </Button>
        ))}
        <Tooltip label="把当前目录保存为长期成员" delayMs={300}>
          <Button
            variant="outline"
            size="sm"
            className={styles.crumbAction}
            onClick={() => void confirm(relative, 'member')}
          >
            确认当前目录
          </Button>
        </Tooltip>
      </div>
      {error === undefined ? null : <ErrorPanel error={error} onRetry={() => void load(relative)} />}
      {loading ? <Loading>读取位置…</Loading> : null}
      {!loading && discovery !== undefined && discovery.root.state !== 'accessible' ? (
        <p className={styles.problem}>
          <Tag tone="danger">{discovery.root.state}</Tag>
          {discovery.root.error === undefined ? null : <span>{discovery.root.error}</span>}
        </p>
      ) : null}
      {!loading && discovery !== undefined && discovery.root.state === 'accessible' ? (
        <ul className={styles.entries}>
          {discovery.entries.map((entry) => {
            const name = entryName(entry.path)
            const target = childRelative(relative, name)
            return (
              <li key={entry.path}>
                <Tag tone="neutral">{entry.kind}</Tag>
                <Tooltip label={name} onlyWhenClipped portal maxWidth={360}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={styles.name}
                    onClick={() => void openEntry(entry.kind, target)}
                  >
                    {name}
                  </Button>
                </Tooltip>
                {entry.state === 'accessible' ? (
                  <Tooltip label="把当前可访问引用保存为长期成员" delayMs={300}>
                    <Button variant="outline" size="sm" onClick={() => void confirm(target, 'member')}>
                      确认成员
                    </Button>
                  </Tooltip>
                ) : <Tag tone="danger">{entry.state}</Tag>}
              </li>
            )
          })}
        </ul>
      ) : null}
      {discovery?.truncated === true ? <p className={styles.note}>结果已截断。</p> : null}
      {read === undefined ? null : (
        <div className={styles.reader}>
          <div className={styles.readerHead}>
            <Tooltip label={read.resource.path} onlyWhenClipped portal maxWidth={560}>
              <span className={styles.readerPath}>{read.resource.path}</span>
            </Tooltip>
            {read.truncated ? <Tag tone="warning">已截断</Tag> : null}
          </div>
          <CodeBlock>{read.text}</CodeBlock>
        </div>
      )}
    </Panel>
  )
}
