import clsx from 'clsx'
import styles from './primitives.module.css'

const TONE: Readonly<Record<string, 'good' | 'warn' | 'bad' | 'muted'>> = {
  observed: 'good',
  available: 'good',
  repository: 'good',
  ready: 'good',
  connected: 'good',
  accessible: 'good',
  ok: 'good',
  matched: 'good',
  listening: 'good',
  'not-observed': 'warn',
  empty: 'warn',
  warning: 'warn',
  unknown: 'warn',
  pending: 'warn',
  running: 'warn',
  'config-error': 'warn',
  error: 'bad',
  denied: 'bad',
  unreachable: 'bad',
  'target-unavailable': 'bad',
  unavailable: 'bad',
  missing: 'bad',
  'host-key': 'bad',
  forbidden: 'bad',
  'invalid-response': 'bad',
  'no-local-git': 'bad',
  unmatched: 'bad',
  ambiguous: 'bad',
  'no-commit': 'bad',
  'actions-disabled': 'bad',
  unsupported: 'bad',
}

export default function StateBadge({ value }: { readonly value: string | null | undefined }) {
  if (value === null || value === undefined) return null
  const tone = TONE[value] ?? 'muted'
  return <span className={clsx(styles.badge, styles[tone])}>{value}</span>
}
