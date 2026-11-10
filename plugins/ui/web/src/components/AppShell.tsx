import type { ReactNode } from 'react'
import styles from './AppShell.module.css'

export default function AppShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <a className={styles.brand} href="#/">
          <span className={styles.mark}>L</span>
          <span>Locus <strong>Workspace</strong></span>
        </a>
        <span className={styles.note}>本机 loopback · DSH 宿主</span>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  )
}
