export const SCHEMA_STATEMENTS = [
`CREATE TABLE IF NOT EXISTS FACTORY_META (key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS PROJECT_STATE (key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS WORK_QUEUE (id TEXT PRIMARY KEY,job_type TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',priority INTEGER NOT NULL DEFAULT 100,payload_json TEXT NOT NULL DEFAULT '{}',result_json TEXT,attempts INTEGER NOT NULL DEFAULT 0,workflow_instance_id TEXT,error_text TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,started_at TEXT,completed_at TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE INDEX IF NOT EXISTS IX_WORK_QUEUE_STATUS_PRIORITY ON WORK_QUEUE(status,priority,created_at)`,
`CREATE INDEX IF NOT EXISTS IX_WORK_QUEUE_STATUS_UPDATED ON WORK_QUEUE(status,updated_at)`,
`CREATE TABLE IF NOT EXISTS RUNS (id TEXT PRIMARY KEY,job_id TEXT,status TEXT NOT NULL,started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,completed_at TEXT,result_json TEXT,error_text TEXT)`,
`CREATE INDEX IF NOT EXISTS IX_RUNS_JOB_STATUS ON RUNS(job_id,status)`,
`CREATE TABLE IF NOT EXISTS RUN_EVENTS (id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,event_type TEXT NOT NULL,message TEXT,data_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS AGENTS (id TEXT PRIMARY KEY,role TEXT NOT NULL,provider TEXT,model TEXT,enabled INTEGER NOT NULL DEFAULT 1,config_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS ARTIFACTS (id TEXT PRIMARY KEY,job_id TEXT,kind TEXT NOT NULL,name TEXT NOT NULL,uri TEXT,sha256 TEXT,metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS BLOCKERS (id TEXT PRIMARY KEY,scope TEXT NOT NULL,severity TEXT NOT NULL,status TEXT NOT NULL,summary TEXT NOT NULL,details TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS METRICS (id INTEGER PRIMARY KEY AUTOINCREMENT,metric_name TEXT NOT NULL,metric_value REAL,metric_text TEXT,scope TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS FACTORY_LOCKS (lock_name TEXT PRIMARY KEY,owner TEXT NOT NULL,expires_at TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS FACTORY_ROADMAP (id TEXT PRIMARY KEY,sequence_no INTEGER NOT NULL,title TEXT NOT NULL,job_type TEXT NOT NULL,agent_role TEXT NOT NULL,objective TEXT NOT NULL,acceptance_json TEXT NOT NULL DEFAULT '[]',depends_on_json TEXT NOT NULL DEFAULT '[]',payload_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'ready',work_queue_id TEXT,result_summary TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE INDEX IF NOT EXISTS IX_FACTORY_ROADMAP_STATUS_SEQUENCE ON FACTORY_ROADMAP(status,sequence_no)`,
`CREATE TABLE IF NOT EXISTS QUALITY_REVIEWS (id TEXT PRIMARY KEY,job_id TEXT NOT NULL,run_id TEXT NOT NULL,reviewer_role TEXT NOT NULL,producer_model TEXT,reviewer_model TEXT,attempt_no INTEGER NOT NULL,decision TEXT NOT NULL,score REAL NOT NULL,reasons_json TEXT NOT NULL DEFAULT '[]',revision_instructions TEXT,deterministic_issues_json TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE INDEX IF NOT EXISTS IX_QUALITY_REVIEWS_JOB ON QUALITY_REVIEWS(job_id,created_at)`,
`CREATE TABLE IF NOT EXISTS JOB_DECISIONS (id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL,decision_type TEXT NOT NULL,actor_role TEXT NOT NULL,data_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`
] as const;

const AGENT_ROLES = [
  "Research Scout","Source Auditor","Structure Miner","Curriculum Mapper","Factory Designer","Generator","Solver","Distractor Engineer","Tutor Designer","Child Reviewer","Fairness Reviewer","IP/Security Reviewer","Psychometrician","Game Planner","Codex Engineer","QA Supervisor","Release Manager"
] as const;

export async function ensureSchema(db: D1Database): Promise<void> {
  for (const sql of SCHEMA_STATEMENTS) await db.prepare(sql).run();

  for (const [key,value] of [["schema_version","3"],["factory_version","0.4.1"]]) {
    await db.prepare(
      `INSERT INTO FACTORY_META(key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`
    ).bind(key,value).run();
  }

  const state = [
    ["project","Kuzenler Yarışıyor / Zihin Arenası AE Engine V2"],
    ["g8_turkish_research","10/10"],
    ["g8_turkish_verified_integration","7/10"],
    ["g8_turkish_live","blocked"],
    ["factory_phase","autonomous-governor"],
    ["continuous_enabled","0"]
  ];

  for (const [key,value] of state) {
    await db.prepare(
      `INSERT INTO PROJECT_STATE(key,value,updated_at)
       VALUES (?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO NOTHING`
    ).bind(key,value).run();
  }

  for (const role of AGENT_ROLES) {
    await db.prepare(
      `INSERT INTO AGENTS(id,role,provider,model,enabled,config_json,updated_at)
       VALUES (?,?, 'nvidia-nim', NULL,1,'{}',CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET role=excluded.role,provider=excluded.provider,enabled=1,updated_at=CURRENT_TIMESTAMP`
    ).bind(role.toLowerCase().replace(/[^a-z0-9]+/g,"-"), role).run();
  }
}
