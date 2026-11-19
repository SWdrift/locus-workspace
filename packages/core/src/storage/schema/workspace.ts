/** Workspace、关系与挂载；v9 追加 name_key、description 与挂载 primary。 */
export const WORKSPACE_SCHEMA = `
  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    created_at TEXT NOT NULL,
    name_key TEXT NOT NULL CHECK (length(trim(name_key)) > 0),
    description TEXT,
    UNIQUE (name_key)
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
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
    UNIQUE (workspace_id, name_key),
    UNIQUE (workspace_id, path_key)
  ) STRICT;
  CREATE UNIQUE INDEX mounts_primary_unique ON mounts(workspace_id) WHERE is_primary = 1;
`
