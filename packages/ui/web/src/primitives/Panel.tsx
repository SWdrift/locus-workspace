import type { ReactNode } from 'react'
import clsx from 'clsx'
import StateBadge from './StateBadge'
import styles from './primitives.module.css'

interface PanelProps {
  readonly title: string
  readonly state?: string
  readonly meta?: ReactNode
  readonly description?: string
  readonly error?: string
  readonly tone?: 'default' | 'attention'
  readonly children: ReactNode
}

export default function Panel({ title, state, meta, description, error, tone = 'default', children }: PanelProps) {
  return (
    <section className={clsx(styles.panel, tone === 'attention' && styles.panelAttention)}>
      <header className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{title}</h2>
        <div className={styles.panelMeta}>
          <StateBadge value={state} />
          {meta}
        </div>
      </header>
      {description === undefined ? null : <p className={styles.muted}>{description}</p>}
      {error === undefined ? null : <p className={styles.errorText}>{error}</p>}
      {children}
    </section>
  )
}
