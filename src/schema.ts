export const SCHEMA_STATEMENTS = [
`CREATE TABLE IF NOT EXISTS FACTORY_META (key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS PROJECT_STATE (key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS WORK_QUEUE (id TEXT PRIMARY KEY,job_type TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',priority INTEGER NOT NULL DEFAULT 100,payload_json TEXT NOT NULL DEFAULT '{}',result_json TEXT,attempts INTEGER NOT NULL DEFAULT 0,workflow_instance_id TEXT,error_text TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,started_at TEXT,completed_at TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE INDEX IF NOT EXISTS IX_WORK_QUEUE_STATUS_PRIORITY ON WORK_QUEUE(status,priority,created_at)`,
`CREATE TABLE IF NOT EXISTS RUNS (id TEXT PRIMARY KEY,job_id TEXT,status TEXT NOT NULL,started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,completed_at TEXT,result_json TEXT,error_text TEXT)`,
`CREATE TABLE IF NOT EXISTS RUN_EVENTS (id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,event_type TEXT NOT NULL,message TEXT,data_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS AGENTS (id TEXT PRIMARY KEY,role TEXT NOT NULL,provider TEXT,model TEXT,enabled INTEGER NOT NULL DEFAULT 1,config_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS ARTIFACTS (id TEXT PRIMARY KEY,job_id TEXT,kind TEXT NOT NULL,name TEXT NOT NULL,uri TEXT,sha256 TEXT,metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS BLOCKERS (id TEXT PRIMARY KEY,scope TEXT NOT NULL,severity TEXT NOT NULL,status TEXT NOT NULL,summary TEXT NOT NULL,details TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS METRICS (id INTEGER PRIMARY KEY AUTOINCREMENT,metric_name TEXT NOT NULL,metric_value REAL,metric_text TEXT,scope TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS FACTORY_LOCKS (lock_name TEXT PRIMARY KEY,owner TEXT NOT NULL,expires_at TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`
] as const;

export async function ensureSchema(db: D1Database): Promise<void> {
  for (const sql of SCHEMA_STATEMENTS) await db.prepare(sql).run();

  for (const [key,value] of [["schema_version","1"],["factory_version","0.1.0"]]) {
    await db.prepare(`INSERT INTO FACTORY_META(key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO NOTHING`).bind(key,value).run();
  }

  const state = [
    ["project","Kuzenler Yarışıyor / Zihin Arenası AE Engine V2"],
    ["g8_turkish_research","10/10"],
    ["g8_turkish_verified_integration","7/10"],
    ["g8_turkish_live","blocked"],
    ["factory_phase","bootstrap"]
  ];
  for (const [key,value] of state) {
    await db.prepare(`INSERT INTO PROJECT_STATE(key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO NOTHING`).bind(key,value).run();
  }
}
