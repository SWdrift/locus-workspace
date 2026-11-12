import type {
  FilesystemDiscovery,
  FilesystemLocation,
  FilesystemRead,
  Health,
  Workspace,
  WorkspaceDetail,
  WorkspaceRelation,
} from './types'

const token = document.querySelector<HTMLMetaElement>('meta[name="locus-ui-token"]')?.content ?? ''

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('x-locus-ui-token', token)
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  const response = await fetch(path, { ...init, headers })
  const text = await response.text()
  let body: unknown
  try {
    body = text.length === 0 ? undefined : JSON.parse(text)
  } catch {
    throw new ApiError(`接口返回了非 JSON 内容（HTTP ${response.status}）。`, response.status, 'invalid-response')
  }
  if (!response.ok) {
    const error = body as { error?: { code?: string; message?: string } } | undefined
    throw new ApiError(
      error?.error?.message ?? `请求失败（HTTP ${response.status}）。`,
      response.status,
      error?.error?.code ?? 'http-error',
    )
  }
  return body as T
}

export async function loadHealth(): Promise<Health> {
  return request<Health>('/api/health')
}

export async function listWorkspaces(): Promise<readonly Workspace[]> {
  return (await request<{ workspaces: readonly Workspace[] }>('/api/workspaces')).workspaces
}

export async function createWorkspace(name: string): Promise<Workspace> {
  return (await request<{ workspace: Workspace }>('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })).workspace
}

export async function loadWorkspace(workspaceId: string): Promise<WorkspaceDetail> {
  return request<WorkspaceDetail>(`/api/workspaces/${encodeURIComponent(workspaceId)}`)
}

export async function renameWorkspace(workspaceId: string, name: string): Promise<Workspace> {
  return (await request<{ workspace: Workspace }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/rename`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })).workspace
}

export async function removeRelation(workspaceId: string, relationId: string): Promise<void> {
  await request<{ removedRelationId: string }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/relations/${encodeURIComponent(relationId)}`,
    { method: 'DELETE' },
  )
}

export async function registerLocation(workspaceId: string, path: string): Promise<FilesystemLocation> {
  return (await request<{ location: FilesystemLocation }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/locations`,
    { method: 'POST', body: JSON.stringify({ path }) },
  )).location
}

export async function unregisterLocation(workspaceId: string, locationId: string): Promise<void> {
  await request<{ removedLocationId: string }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/locations/${encodeURIComponent(locationId)}`,
    { method: 'DELETE' },
  )
}

export async function discoverLocation(
  workspaceId: string,
  locationId: string,
  relative: string | undefined,
): Promise<FilesystemDiscovery> {
  const query = relative === undefined ? '' : `?relative=${encodeURIComponent(relative)}`
  return (await request<{ discovery: FilesystemDiscovery }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/locations/${encodeURIComponent(locationId)}/discover${query}`,
  )).discovery
}

export async function readLocation(
  workspaceId: string,
  locationId: string,
  relative: string,
): Promise<FilesystemRead> {
  return (await request<{ read: FilesystemRead }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/locations/${encodeURIComponent(locationId)}/read?relative=${encodeURIComponent(relative)}`,
  )).read
}

export async function confirmResource(
  workspaceId: string,
  locationId: string,
  relative: string | undefined,
  kind: 'member' | 'association',
): Promise<WorkspaceRelation> {
  return (await request<{ relation: WorkspaceRelation }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/locations/${encodeURIComponent(locationId)}/confirm`,
    { method: 'POST', body: JSON.stringify({ relative, kind }) },
  )).relation
}
