/** CloudEvents 1.0 子集；只用于观察与排障，不作为完整审计或重放来源。 */
export const EVENTS_SCHEMA = `
  CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (length(type) > 0),
    source TEXT NOT NULL CHECK (length(source) > 0),
    subject TEXT,
    time TEXT NOT NULL,
    data TEXT NOT NULL
  ) STRICT;
`
