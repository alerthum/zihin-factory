CREATE TABLE IF NOT EXISTS FACTORY_LESSONS (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  defect_code TEXT NOT NULL,
  lesson_text TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  occurrences INTEGER NOT NULL DEFAULT 1,
  resolved_successes INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_resolved_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scope_type, scope_key, defect_code)
);
CREATE INDEX IF NOT EXISTS IX_FACTORY_LESSONS_ACTIVE ON FACTORY_LESSONS(scope_type,scope_key,active,occurrences DESC);

CREATE TABLE IF NOT EXISTS QUALITY_DEFECTS (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  run_id TEXT,
  producer_role TEXT,
  defect_code TEXT NOT NULL,
  detail TEXT,
  attempt_no INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS IX_QUALITY_DEFECTS_ROLE ON QUALITY_DEFECTS(producer_role,defect_code,created_at DESC);

CREATE TABLE IF NOT EXISTS PROVIDER_MODEL_STATS (
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  successes INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  timeout_failures INTEGER NOT NULL DEFAULT 0,
  empty_failures INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  total_latency_ms INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_failure_at TEXT,
  last_error TEXT,
  cooldown_until TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(purpose,model)
);
CREATE INDEX IF NOT EXISTS IX_PROVIDER_MODEL_STATS_ROUTE ON PROVIDER_MODEL_STATS(purpose,cooldown_until,successes DESC,failures ASC);

CREATE TABLE IF NOT EXISTS NOTIFICATION_STATE (
  notification_key TEXT PRIMARY KEY,
  last_sent_at TEXT,
  suppressed_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO FACTORY_META(key,value) VALUES ('factory_version','0.8.0')
ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO FACTORY_META(key,value) VALUES ('schema_version','10')
ON CONFLICT(key) DO UPDATE SET value=excluded.value;
