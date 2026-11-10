import AppShell from './components/AppShell'
import WorkspaceOverviewPage from './components/WorkspaceOverviewPage'
import WorkspaceListPage from './components/WorkspaceListPage'
import { useHashRoute } from './hooks'

export default function App() {
  const route = useHashRoute()
  return (
    <AppShell>
      {route.view === 'list'
        ? <WorkspaceListPage />
        : <WorkspaceOverviewPage key={route.workspaceId} workspaceId={route.workspaceId} />}
    </AppShell>
  )
}
