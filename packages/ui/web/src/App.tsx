import { useState } from 'react'
import { createWorkspace } from './api'
import { useHashRoute, useWorkspaceList } from './hooks'
import AppShell from './components/AppShell'
import WorkspaceSidebar from './components/WorkspaceSidebar'
import WorkspacePage from './components/WorkspacePage'
import { EmptyState, ErrorPanel, Loading } from './primitives/States'

export default function App() {
  const route = useHashRoute()
  const { workspaces, health, loading, error, reload } = useWorkspaceList()
  const [actionError, setActionError] = useState<Error | undefined>(undefined)

  async function create(name: string): Promise<void> {
    try {
      setActionError(undefined)
      const workspace = await createWorkspace(name)
      await reload()
      window.location.hash = `#/w/${encodeURIComponent(workspace.id)}`
    } catch (cause) {
      setActionError(cause instanceof Error ? cause : new Error(String(cause)))
    }
  }

  return (
    <AppShell
      sidebar={(
        <WorkspaceSidebar
          workspaces={workspaces}
          currentId={route.view === 'workspace' ? route.workspaceId : undefined}
          health={health}
          onCreate={create}
        />
      )}
    >
      {actionError === undefined ? null : <ErrorPanel error={actionError} />}
      {error === undefined ? null : <ErrorPanel error={error} onRetry={() => void reload()} />}
      {loading && workspaces.length === 0
        ? <Loading>读取 Workspace…</Loading>
        : route.view === 'welcome'
          ? (
            <EmptyState title="选择一个 Workspace">
              从左侧选择长期语境，或创建一个新的 Workspace。Workspace 不依赖本地目录存在。
              {health?.filesystemAvailable === false ? ' 当前 profile 未加载 Filesystem，位置浏览不可用。' : ''}
            </EmptyState>
          )
          : <WorkspacePage key={route.workspaceId} workspaceId={route.workspaceId} onChanged={reload} />}
    </AppShell>
  )
}
