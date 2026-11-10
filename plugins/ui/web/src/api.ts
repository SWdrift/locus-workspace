import type {
  OperationAvailability,
  OperationDefinition,
  OperationInvocationResult,
  Workspace,
  WorkspaceOverview,
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
  headers.set('x-locus-ui', '1')
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

export async function listWorkspaces(): Promise<readonly Workspace[]> {
  const data = await request<{ workspaces: readonly Workspace[] }>('/api/workspaces')
  return data.workspaces
}

export async function loadOverview(workspaceId: string, observe: boolean): Promise<WorkspaceOverview> {
  const data = await request<{ overview: WorkspaceOverview }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/overview?observe=${observe ? '1' : '0'}`,
  )
  return data.overview
}

export async function listOperations(): Promise<readonly OperationDefinition[]> {
  const data = await request<{ definitions: readonly OperationDefinition[] }>('/api/operations')
  return data.definitions
}

export async function checkAvailability(
  operationId: string,
  workspaceId?: string,
): Promise<OperationAvailability> {
  const query = workspaceId === undefined ? '' : `?workspaceId=${encodeURIComponent(workspaceId)}`
  const data = await request<{ availability: OperationAvailability }>(
    `/api/operations/${encodeURIComponent(operationId)}/availability${query}`,
  )
  return data.availability
}

export async function invokeOperation(
  operationId: string,
  input: unknown,
  workspaceId: string | undefined,
  confirm: boolean,
): Promise<OperationInvocationResult> {
  const data = await request<{ result: OperationInvocationResult }>(
    `/api/operations/${encodeURIComponent(operationId)}/invoke`,
    {
      method: 'POST',
      body: JSON.stringify({
        input,
        ...(workspaceId === undefined ? {} : { workspaceId }),
        ...(confirm ? { confirm: true } : {}),
      }),
    },
  )
  return data.result
}
