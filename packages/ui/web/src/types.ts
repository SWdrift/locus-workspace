export interface ResourceReference {
  readonly namespace: string
  readonly id: string
}

export interface RelationSource {
  readonly kind: 'manual' | 'discovery'
  readonly detail: string
}

export interface WorkspaceRelation {
  readonly id: string
  readonly kind: 'member' | 'association'
  readonly target: ResourceReference
  readonly source: RelationSource
  readonly createdAt: string
}

export interface Workspace {
  readonly id: string
  readonly name: string
  readonly createdAt: string
  readonly relations: readonly WorkspaceRelation[]
}

export interface FilesystemLocation {
  readonly id: string
  readonly workspaceId: string
  readonly path: string
  readonly reference: ResourceReference
}

export interface FilesystemObservation {
  readonly path: string
  readonly reference: ResourceReference
  readonly state: 'accessible' | 'missing' | 'denied' | 'unavailable' | 'error'
  readonly kind: 'file' | 'directory' | 'symlink' | 'other' | 'unknown'
  readonly observedAt: string
  readonly error?: string
}

export interface FilesystemDiscovery {
  readonly root: FilesystemObservation
  readonly entries: readonly FilesystemObservation[]
  readonly truncated: boolean
}

export interface FilesystemRead {
  readonly resource: FilesystemObservation
  readonly text: string
  readonly truncated: boolean
}

export interface WorkspaceDetail {
  readonly workspace: Workspace
  readonly filesystemAvailable: boolean
  readonly locations: readonly FilesystemLocation[]
}

export interface Health {
  readonly ok: boolean
  readonly version: string
  readonly filesystemAvailable: boolean
}

export type Route = { readonly view: 'welcome' } | { readonly view: 'workspace'; readonly workspaceId: string }
