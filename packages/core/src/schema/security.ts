/** 安装身份、Root 验证材料、Profile、凭据字段、operation 等级与组件绑定。 */
export const SECURITY_SCHEMA = `
  CREATE TABLE security_installation (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    installation_id TEXT NOT NULL UNIQUE CHECK (length(installation_id) = 36)
  ) STRICT;
  CREATE TABLE security_root_authentication (
    singleton INTEGER PRIMARY KEY REFERENCES security_installation(singleton) CHECK (singleton = 1),
    generation INTEGER NOT NULL CHECK (generation >= 1),
    verifier_version INTEGER NOT NULL CHECK (verifier_version = 1),
    algorithm TEXT NOT NULL CHECK (algorithm = 'scrypt'),
    scrypt_n INTEGER NOT NULL CHECK (scrypt_n = 32768),
    scrypt_r INTEGER NOT NULL CHECK (scrypt_r = 8),
    scrypt_p INTEGER NOT NULL CHECK (scrypt_p = 1),
    scrypt_maxmem INTEGER NOT NULL CHECK (scrypt_maxmem = 67108864),
    salt TEXT NOT NULL CHECK (length(salt) = 32),
    derived_key TEXT NOT NULL CHECK (length(derived_key) = 64),
    failed_attempts INTEGER NOT NULL CHECK (failed_attempts BETWEEN 0 AND 5),
    locked_until INTEGER CHECK (locked_until IS NULL OR locked_until >= 0),
    attempt_id TEXT,
    attempt_expires_at INTEGER CHECK (attempt_expires_at IS NULL OR attempt_expires_at >= 0),
    CHECK ((failed_attempts = 5) = (locked_until IS NOT NULL)),
    CHECK ((attempt_id IS NULL) = (attempt_expires_at IS NULL)),
    CHECK (attempt_id IS NULL OR failed_attempts > 0)
  ) STRICT;
  CREATE TABLE security_profiles (
    name TEXT PRIMARY KEY CHECK (length(name) BETWEEN 1 AND 64),
    installation_id TEXT NOT NULL REFERENCES security_installation(installation_id)
  ) STRICT;
  CREATE TABLE security_credentials (
    profile TEXT NOT NULL REFERENCES security_profiles(name),
    reference TEXT NOT NULL CHECK (length(reference) > 11),
    provider_id TEXT NOT NULL CHECK (length(trim(provider_id)) > 0),
    fields TEXT NOT NULL,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    owner_component TEXT NOT NULL CHECK (length(trim(owner_component)) > 0),
    PRIMARY KEY (profile, reference)
  ) STRICT;
  CREATE TABLE security_credential_bindings (
    profile TEXT NOT NULL REFERENCES security_profiles(name),
    component_id TEXT NOT NULL CHECK (length(trim(component_id)) > 0),
    slot TEXT NOT NULL CHECK (length(trim(slot)) > 0),
    resource_key TEXT NOT NULL CHECK (length(resource_key) > 0),
    reference TEXT NOT NULL,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    PRIMARY KEY (profile, component_id, slot, resource_key),
    FOREIGN KEY (profile, reference) REFERENCES security_credentials(profile, reference) ON DELETE CASCADE
  ) STRICT;
  CREATE TABLE security_operation_levels (
    profile TEXT NOT NULL REFERENCES security_profiles(name),
    component_id TEXT NOT NULL CHECK (length(trim(component_id)) > 0),
    operation TEXT NOT NULL CHECK (length(trim(operation)) > 0),
    level TEXT NOT NULL CHECK (level IN ('user', 'root')),
    updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
    PRIMARY KEY (profile, component_id, operation)
  ) STRICT;
`
