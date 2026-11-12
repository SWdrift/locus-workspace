import styles from './primitives.module.css'

export default function CodeBlock({ children }: { readonly children: string }) {
  return <pre className={styles.code}>{children}</pre>
}
