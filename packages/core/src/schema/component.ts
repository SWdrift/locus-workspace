/** 组件的外部状态与部署状态。 */
export const COMPONENT_SCHEMA = `
  CREATE TABLE component_states (
    component_id TEXT PRIMARY KEY CHECK (length(trim(component_id)) > 0),
    external_state TEXT CHECK (
      external_state IS NULL OR external_state IN ('healthy', 'stopped', 'abnormal', 'absent')
    ),
    external_detail TEXT NOT NULL DEFAULT '',
    external_checked_at TEXT,
    deploy_state TEXT CHECK (
      deploy_state IS NULL OR deploy_state IN ('deployed', 'failed', 'not-deployed', 'not-deployable')
    ),
    deploy_detail TEXT NOT NULL DEFAULT '',
    deploy_checked_at TEXT
  ) STRICT;
`
