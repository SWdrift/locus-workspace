import type { ReactNode } from 'react'
import { StateDot } from '../dsh/primitives/StateDot.tsx'
import styles from './primitives.module.css'

export function ApiErrorLike(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function Loading({ children = '加载中…' }: { readonly children?: ReactNode }) {
  return (
    <div className={styles.loading} role="status">
      <StateDot state="ongoing" />
      <span>{children}</span>
    </div>
  )
}

export function ErrorPanel({
  error,
  onRetry,
}: {
  readonly error: unknown
  readonly onRetry?: () => void
}) {
  return (
    <div className={styles.errorPanel} role="alert">
      <div>
        <strong>请求失败</strong>
        <p>{ApiErrorLike(error)}</p>
      </div>
      {onRetry === undefined ? null : (
        <button type="button" className={styles.button} onClick={onRetry}>重试</button>
      )}
    </div>
  )
}

export function EmptyState({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <div className={styles.emptyState}>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  )
}
