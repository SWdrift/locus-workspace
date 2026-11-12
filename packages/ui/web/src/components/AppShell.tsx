import type { ReactNode } from 'react'
import styles from './AppShell.module.css'

export default function AppShell({
  sidebar,
  children,
}: {
  readonly sidebar: ReactNode
  readonly children: ReactNode
}) {
  return (
    <div className={styles.frame}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="#/">
          <span className={styles.mark}>L</span>
          <span>Locus <strong>Workspace</strong></span>
        </a>
        <div className={styles.sidebarBody}>{sidebar}</div>
        <p className={styles.hostNote}>本机 loopback · DSH 宿主</p>
      </aside>
      <main className={styles.center}>{children}</main>
    </div>
  )
}
