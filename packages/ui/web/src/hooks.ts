import { useCallback, useEffect, useState } from 'react'
import { loadHealth, listWorkspaces } from './api'
import type { Health, Route, Workspace } from './types'

export function useHashRoute(): Route {
  const read = (): Route => {
    const raw = window.location.hash.replace(/^#/, '') || '/'
    const match = /^\/w\/([^/]+)$/.exec(raw)
    return match === null
      ? { view: 'welcome' }
      : { view: 'workspace', workspaceId: decodeURIComponent(match[1]!) }
  }
  const [route, setRoute] = useState<Route>(read)
  useEffect(() => {
    const update = (): void => setRoute(read())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}

export interface ShellState {
  readonly workspaces: readonly Workspace[]
  readonly health: Health | undefined
  readonly loading: boolean
  readonly error: Error | undefined
}

export function useWorkspaceList(): ShellState & { reload(): Promise<void> } {
  const [state, setState] = useState<ShellState>({
    workspaces: [],
    health: undefined,
    loading: true,
    error: undefined,
  })
  const reload = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: undefined }))
    try {
      const [workspaces, health] = await Promise.all([listWorkspaces(), loadHealth()])
      setState({ workspaces, health, loading: false, error: undefined })
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error : new Error(String(error)),
      }))
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])
  return { ...state, reload }
}
