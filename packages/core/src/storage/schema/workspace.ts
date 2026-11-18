/** Workspace、关系与挂载。 */
export const WORKSPACE_SCHEMA = `
  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE relations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    kind TEXT NOT NULL CHECK (kind IN ('member', 'association')),
    target_namespace TEXT NOT NULL CHECK (length(trim(target_namespace)) > 0),
    target_id TEXT NOT NULL CHECK (length(trim(target_id)) > 0),
    source_kind TEXT NOT NULL CHECK (source_kind IN ('manual', 'discovery')),
    source_detail TEXT NOT NULL CHECK (length(trim(source_detail)) > 0),
    created_at TEXT NOT NULL,
    UNIQUE (workspace_id, kind, target_namespace, target_id)
  ) STRICT;
  CREATE TABLE mounts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    name_key TEXT NOT NULL CHECK (length(trim(name_key)) > 0),
    path TEXT NOT NULL CHECK (length(trim(path)) > 0),
    path_key TEXT NOT NULL CHECK (length(trim(path_key)) > 0),
    created_at TEXT NOT NULL,
    UNIQUE (workspace_id, name_key),
    UNIQUE (workspace_id, path_key)
  ) STRICT;
`
