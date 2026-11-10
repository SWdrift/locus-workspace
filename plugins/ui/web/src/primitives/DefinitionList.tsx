import type { ReactNode } from 'react'
import clsx from 'clsx'
import styles from './primitives.module.css'

export type DefinitionItem = readonly [label: string, value: ReactNode]

export default function DefinitionList({
  items,
  className,
}: {
  readonly items: readonly DefinitionItem[]
  readonly className?: string
}) {
  const visible = items.filter(([, value]) => value !== undefined && value !== null && value !== '')
  if (visible.length === 0) return null
  return (
    <dl className={clsx(styles.definitions, className)}>
      {visible.map(([label, value]) => (
        <div className={styles.definitionRow} key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
