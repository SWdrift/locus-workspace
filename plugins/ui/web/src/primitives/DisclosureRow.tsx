import type { ReactNode } from 'react'
import clsx from 'clsx'
import styles from './primitives.module.css'

interface DisclosureRowProps {
  readonly summary: ReactNode
  readonly children: ReactNode
  readonly defaultOpen?: boolean
  readonly className?: string
}

export default function DisclosureRow({ summary, children, defaultOpen = false, className }: DisclosureRowProps) {
  return (
    <details className={clsx(styles.disclosure, className)} open={defaultOpen}>
      <summary className={styles.disclosureSummary}>{summary}</summary>
      <div className={styles.disclosureBody}>{children}</div>
    </details>
  )
}
