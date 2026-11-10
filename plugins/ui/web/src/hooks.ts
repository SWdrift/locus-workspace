import { useCallback, useEffect, useState } from 'react'
import { ApiError, listOperations, listWorkspaces, loadOverview } from './api'
import type {
  OperationDefinition,
  Route,
  Workspace,
  WorkspaceOverview,
} from './types'

export function useHashRoute(): Route {
  const read = (): Route => {
    const raw = window.location.hash.replace(/^#/, '') || '/'
    const match = /^\/workspace\/([^/]+)$/.exec(raw)
    return match === null
      ? { view: 'list' }
      : { view: 'overview', workspaceId: decodeURIComponent(match[1]!) }
  }
  const [route, setRoute] = useState<Route>(read)
  useEffect(() => {
    const update = (): void => setRoute(read())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}

export interface AsyncState<T> {
  readonly data: T | undefined
  readonly loading: boolean
  readonly error: Error | undefined
}

export function useWorkspaces(): AsyncState<readonly Workspace[]> & { reload(): Promise<void> } {
  const [state, setState] = useState<AsyncState<readonly Workspace[]>>({
    data: undefined,
    loading: true,
    error: undefined,
  })
  const reload = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: undefined }))
    try {
      const data = await listWorkspaces()
      setState({ data, loading: false, error: undefined })
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error : new ApiError(String(error), 0, 'unknown'),
      }))
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])
  return { ...state, reload }
}

export function useOverview(workspaceId: string): AsyncState<WorkspaceOverview> & {
  observe: boolean
  setObserve(value: boolean): void
  reload(): Promise<void>
} {
  const [observe, setObserve] = useState(false)
  const [state, setState] = useState<AsyncState<WorkspaceOverview>>({
    data: undefined,
    loading: true,
    error: undefined,
  })
  const reload = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: undefined }))
    try {
      const data = await loadOverview(workspaceId, observe)
      setState({ data, loading: false, error: undefined })
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error : new ApiError(String(error), 0, 'unknown'),
      }))
    }
  }, [observe, workspaceId])
  useEffect(() => {
    setState({ data: undefined, loading: true, error: undefined })
    void reload()
    // 仅在 Workspace 切换时重置；observe 由显式刷新触发，避免切换确认框时卸载表单。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])
  return { ...state, observe, setObserve, reload }
}

export function useOperations(): AsyncState<readonly OperationDefinition[]> {
  const [state, setState] = useState<AsyncState<readonly OperationDefinition[]>>({
    data: undefined,
    loading: true,
    error: undefined,
  })
  useEffect(() => {
    let active = true
    void listOperations()
      .then((data) => {
        if (active) setState({ data, loading: false, error: undefined })
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            data: undefined,
            loading: false,
            error: error instanceof Error ? error : new ApiError(String(error), 0, 'unknown'),
          })
        }
      })
    return () => {
      active = false
    }
  }, [])
  return state
}
