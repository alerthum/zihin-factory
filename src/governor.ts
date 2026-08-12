export type GovernorEnv = {
  DB: D1Database;
  JOB_QUEUE: Queue;
  FACTORY_WORKFLOW?: Workflow;
};

export type GovernorCycleResult = {
  enabled: boolean;
  materialized: number;
  enqueued: number;
  active: number;
  action: string;
  reconciled?: number;
};

type RoadmapRow = {
  id: string;
  sequence_no: number;
  title: string;
  job_type: string;
  agent_role: string;
  objective: string;
  acceptance_json: string;
  depends_on_json: string;
  payload_json: string;
  status: string;
};

async function stateValue(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(`SELECT value FROM PROJECT_STATE WHERE key=?`).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setState(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(
    `INSERT INTO PROJECT_STATE(key,value,updated_at)
     VALUES (?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`
  ).bind(key, value).run();
}

async function acquireLock(db: D1Database, owner: string): Promise<boolean> {
  const existing = await db.prepare(
    `SELECT owner,expires_at FROM FACTORY_LOCKS WHERE lock_name='governor'`
  ).first<{ owner: string; expires_at: string }>();

  if (existing && new Date(existing.expires_at + "Z").getTime() > Date.now()) return false;

  const expires = new Date(Date.now() + 45_000).toISOString().replace("T", " ").replace("Z", "");
  await db.prepare(
    `INSERT INTO FACTORY_LOCKS(lock_name,owner,expires_at,updated_at)
     VALUES ('governor',?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(lock_name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at,updated_at=CURRENT_TIMESTAMP`
  ).bind(owner, expires).run();
  return true;
}

async function releaseLock(db: D1Database, owner: string): Promise<void> {
  await db.prepare(`DELETE FROM FACTORY_LOCKS WHERE lock_name='governor' AND owner=?`).bind(owner).run();
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function dependenciesDone(db: D1Database, ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  for (const id of ids) {
    const row = await db.prepare(`SELECT status FROM FACTORY_ROADMAP WHERE id=?`).bind(id).first<{ status: string }>();
    if (!row || row.status !== "done") return false;
  }
  return true;
}

function isTransientProviderError(value: string | null): boolean {
  return /NVIDIA|HTTP[_ ]?(?:429|5\d\d)|524|timeout|stream_idle|stream_total|provider exhausted/i.test(value ?? "");
}

async function reconcileDispatchedRoadmap(db: D1Database): Promise<number> {
  const rows = await db.prepare(
    `SELECT r.id AS roadmap_id,r.work_queue_id,w.status AS job_status,w.error_text,w.result_json
     FROM FACTORY_ROADMAP r
     LEFT JOIN WORK_QUEUE w ON w.id=r.work_queue_id
     WHERE r.status='dispatched'
       AND (w.id IS NULL OR w.status IN ('failed','abandoned','blocked','quarantine','completed'))
     ORDER BY r.sequence_no
     LIMIT 20`
  ).all<{
    roadmap_id: string;
    work_queue_id: string | null;
    job_status: string | null;
    error_text: string | null;
    result_json: string | null;
  }>();

  let changed = 0;
  for (const row of rows.results) {
    if (row.job_status === "completed") {
      await db.prepare(
        `UPDATE FACTORY_ROADMAP SET status='done',result_summary=COALESCE(result_summary,'Recovered completed job state'),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='dispatched'`
      ).bind(row.roadmap_id).run();
      changed++;
      continue;
    }

    if (row.job_status === "blocked") {
      await db.prepare(
        `UPDATE FACTORY_ROADMAP SET status='blocked',result_summary=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='dispatched'`
      ).bind((row.error_text ?? "Job blocked").slice(0,1000),row.roadmap_id).run();
      changed++;
      continue;
    }

    if (row.job_status === "quarantine") {
      await db.prepare(
        `UPDATE FACTORY_ROADMAP SET status='quarantine',result_summary=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='dispatched'`
      ).bind((row.error_text ?? "Job quarantined").slice(0,1000),row.roadmap_id).run();
      changed++;
      continue;
    }

    if (row.job_status === null || row.job_status === "abandoned" || isTransientProviderError(row.error_text)) {
      await db.batch([
        db.prepare(
          `UPDATE FACTORY_ROADMAP SET status='ready',work_queue_id=NULL,result_summary=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='dispatched'`
        ).bind(
          row.job_status === null
            ? "Recovered orphaned dispatched roadmap item"
            : `Recovered retryable execution: ${(row.error_text ?? row.job_status).slice(0,800)}`,
          row.roadmap_id
        ),
        db.prepare(
          `INSERT INTO METRICS(metric_name,metric_value,metric_text,scope) VALUES ('roadmap_reconciled',1,?,'factory')`
        ).bind(JSON.stringify({ roadmapId: row.roadmap_id, previousJobId: row.work_queue_id, previousStatus: row.job_status }))
      ]);
      changed++;
      continue;
    }

    await db.prepare(
      `UPDATE FACTORY_ROADMAP SET status='blocked',result_summary=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='dispatched'`
    ).bind(`Non-retryable execution failure: ${(row.error_text ?? "unknown").slice(0,850)}`,row.roadmap_id).run();
    changed++;
  }
  return changed;
}

async function providerCooldownRemainingMs(db: D1Database): Promise<number> {
  const value = await stateValue(db,"provider_retry_not_before");
  if (!value) return 0;
  const until = Date.parse(value);
  if (!Number.isFinite(until)) return 0;
  return Math.max(0,until-Date.now());
}

async function materializeNextRoadmapJob(db: D1Database): Promise<number> {
  const candidates = await db.prepare(
    `SELECT id,sequence_no,title,job_type,agent_role,objective,acceptance_json,depends_on_json,payload_json,status
     FROM FACTORY_ROADMAP
     WHERE status='ready'
     ORDER BY sequence_no ASC
     LIMIT 20`
  ).all<RoadmapRow>();

  for (const item of candidates.results) {
    const deps = parseStringArray(item.depends_on_json);
    if (!(await dependenciesDone(db, deps))) continue;

    const jobId = crypto.randomUUID();
    let extraPayload: Record<string, unknown> = {};
    try { extraPayload = JSON.parse(item.payload_json || "{}"); } catch { extraPayload = {}; }

    const payload = {
      ...extraPayload,
      roadmapId: item.id,
      roadmapTitle: item.title,
      agentRole: item.agent_role,
      objective: item.objective,
      acceptanceCriteria: parseStringArray(item.acceptance_json),
      maxRevisionAttempts: 2
    };

    await db.batch([
      db.prepare(
        `INSERT INTO WORK_QUEUE(id,job_type,status,priority,payload_json)
         VALUES (?,?,'queued',10,?)`
      ).bind(jobId, item.job_type, JSON.stringify(payload)),
      db.prepare(
        `UPDATE FACTORY_ROADMAP
         SET status='dispatched',work_queue_id=?,updated_at=CURRENT_TIMESTAMP
         WHERE id=? AND status='ready'`
      ).bind(jobId, item.id),
      db.prepare(
        `INSERT INTO JOB_DECISIONS(job_id,decision_type,actor_role,data_json)
         VALUES (?,'MATERIALIZE','Governor',?)`
      ).bind(jobId, JSON.stringify({ roadmapId: item.id, title: item.title }))
    ]);
    return 1;
  }

  return 0;
}

async function enqueueQueuedJobs(env: GovernorEnv, limit = 3): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT id FROM WORK_QUEUE
     WHERE status='queued' AND workflow_instance_id IS NULL
     ORDER BY priority ASC,created_at ASC
     LIMIT ?`
  ).bind(limit).all<{ id: string }>();

  let count = 0;
  for (const row of rows.results) {
    await env.JOB_QUEUE.send({ kind: "job", jobId: row.id, source: "governor" });
    count++;
  }
  return count;
}

export async function seedRoadmap(db: D1Database): Promise<{ inserted: number }> {
  const items = [
    {
      id: "G8TR-NATIVE-GAP-001",
      sequence: 10,
      title: "8. sınıf Türkçe kalan 3/10 native integration gap closure specification",
      role: "Factory Designer",
      objective: "Mevcut doğrulanmış 7/10 native integration durumundan kalan 3/10 yapıyı production-native hale getirmek için implementation-ready gap closure specification üret. Bilinen durumu aşan kod değişikliği yapılmış gibi davranma; eksik repo erişimini açık blocker olarak ayır. Interface, factory contracts, tests, mutation gates ve rollout sırasını somutlaştır.",
      acceptance: [
        "Kalan 3/10 için ayrı ayrı implementasyon hedefi ve kabul kapısı tanımlanmalı.",
        "Static question bank yaklaşımına dönülmemeli; parametric factory yaklaşımı korunmalı.",
        "Solver/oracle, distractor, hint ve game-adapter sözleşmeleri belirtilmeli.",
        "Repo erişimi gerektiren adımlar ile mevcut bilgiyle tamamlanabilen adımlar ayrılmalı.",
        "En az bir regression ve bir mutation test planı bulunmalı."
      ],
      deps: []
    },
    {
      id: "G8TR-NATIVE-QA-002",
      sequence: 20,
      title: "8. sınıf Türkçe native integration independent quality gate",
      role: "Release Manager",
      objective: "G8TR-NATIVE-GAP-001 çıktısının üretim kalite kapısını tasarla. Deterministic gates, semantic QA, child-language review, option/distractor quality, copyright checks ve fail-closed release kararlarını executable test contract seviyesinde tanımla.",
      acceptance: [
        "PASS/RETRY/QUARANTINE/BLOCKED karar koşulları açık olmalı.",
        "Üreten ajan ile onaylayan ajanın ayrılığı korunmalı.",
        "Cevap sızıntısı, anlamsız çeldirici, ambiguity ve semantic-repeat kontrolleri yer almalı.",
        "Gerçek öğrenci verisi olmadan IRT/BKT kalibrasyonu uydurulmamalı."
      ],
      deps: ["G8TR-NATIVE-GAP-001"]
    },
    {
      id: "GITHUB-WRITER-CONTRACT-003",
      sequence: 30,
      title: "Factory GitHub project worker production contract",
      role: "Codex Engineer",
      objective: "Cloudflare factory'nin zihin-factory ve ana Kuzenler_Yarisiyor reposunda kontrollü branch/commit/PR oluşturabilmesi için minimum-yetkili GitHub write worker contract üret. Secret modeli, branch policy, PR-only write, CI gate, rollback ve audit eventlerini tanımla. Token/secret değerlerini isteme veya çıktı içine yazma.",
      acceptance: [
        "Main branch'e doğrudan keyfi push yasaklanmalı; branch + PR akışı olmalı.",
        "Minimum repository permission set açıkça tanımlanmalı.",
        "Secrets D1/artifact/log içine yazılmamalı.",
        "CI başarısızsa merge/release engellenmeli.",
        "Rollback ve audit trail bulunmalı."
      ],
      deps: ["G8TR-NATIVE-QA-002"]
    }
  ];

  let inserted = 0;
  for (const item of items) {
    const result = await db.prepare(
      `INSERT OR IGNORE INTO FACTORY_ROADMAP
       (id,sequence_no,title,job_type,agent_role,objective,acceptance_json,depends_on_json,payload_json,status)
       VALUES (?,?,?,'factory.autonomous-task',?,?,?,?,?,'ready')`
    ).bind(
      item.id,
      item.sequence,
      item.title,
      item.role,
      item.objective,
      JSON.stringify(item.acceptance),
      JSON.stringify(item.deps),
      JSON.stringify({ taskKind: item.id })
    ).run();
    if ((result.meta?.changes ?? 0) > 0) inserted++;
  }
  return { inserted };
}

export async function governorCycle(env: GovernorEnv): Promise<GovernorCycleResult> {
  const enabled = (await stateValue(env.DB, "continuous_enabled")) === "1";
  if (!enabled) {
    return { enabled: false, materialized: 0, enqueued: 0, active: 0, action: "paused" };
  }

  const owner = crypto.randomUUID();
  if (!(await acquireLock(env.DB, owner))) {
    return { enabled: true, materialized: 0, enqueued: 0, active: 0, action: "lock-busy" };
  }

  try {
    if (env.FACTORY_WORKFLOW) {
      await recoverStaleJobs(env as GovernorEnv & { FACTORY_WORKFLOW: Workflow },5);
    }

    const reconciled = await reconcileDispatchedRoadmap(env.DB);

    const activeRow = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM WORK_QUEUE WHERE status IN ('running','verify')`
    ).first<{ count: number }>();
    const active = Number(activeRow?.count ?? 0);

    const cooldownMs = await providerCooldownRemainingMs(env.DB);
    if (active === 0 && cooldownMs > 0) {
      const action = `provider-cooldown-${Math.ceil(cooldownMs/1000)}s`;
      await setState(env.DB,"last_governor_action",action);
      await setState(env.DB,"last_governor_at",new Date().toISOString());
      return { enabled:true,materialized:0,enqueued:0,active:0,action,reconciled };
    }

    let materialized = 0;
    if (active === 0) {
      const queuedRow = await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM WORK_QUEUE WHERE status='queued'`
      ).first<{ count: number }>();
      if (Number(queuedRow?.count ?? 0) === 0) {
        materialized = await materializeNextRoadmapJob(env.DB);
      }
    }

    const enqueued = await enqueueQueuedJobs(env, Math.max(1, 2 - active));
    const action = materialized > 0
      ? "materialized-and-enqueued"
      : enqueued > 0
        ? "enqueued-existing"
        : active > 0
          ? "waiting-active"
          : "idle";

    await setState(env.DB, "last_governor_action", action);
    await setState(env.DB, "last_governor_at", new Date().toISOString());
    await env.DB.prepare(
      `INSERT INTO METRICS(metric_name,metric_value,metric_text,scope)
       VALUES ('governor_cycle',?,?, 'factory')`
    ).bind(materialized + enqueued, action).run();

    return { enabled: true, materialized, enqueued, active, action, reconciled };
  } finally {
    await releaseLock(env.DB, owner);
  }
}

export async function setContinuous(db: D1Database, enabled: boolean): Promise<void> {
  await setState(db, "continuous_enabled", enabled ? "1" : "0");
}

export type StaleRecoveryResult = {
  scanned: number;
  recovered: number;
  terminated: number;
  errors: string[];
};

export async function recoverStaleJobs(
  env: GovernorEnv & { FACTORY_WORKFLOW: Workflow },
  staleMinutes = 4
): Promise<StaleRecoveryResult> {
  const rows = await env.DB.prepare(
    `SELECT id,workflow_instance_id,updated_at
     FROM WORK_QUEUE
     WHERE status='running'
       AND datetime(updated_at) <= datetime('now', ?)
     ORDER BY updated_at ASC
     LIMIT 10`
  ).bind(`-${Math.max(2, Math.min(30, staleMinutes))} minutes`).all<{
    id: string;
    workflow_instance_id: string | null;
    updated_at: string;
  }>();

  let recovered = 0;
  let terminated = 0;
  const errors: string[] = [];

  for (const row of rows.results) {
    if (row.workflow_instance_id) {
      try {
        const instance = await env.FACTORY_WORKFLOW.get(row.workflow_instance_id);
        const details = await instance.status();
        if (["queued","running","waiting","paused","waitingForPause"].includes(details.status)) {
          await instance.terminate();
          terminated++;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Missing/already-terminal instances must not prevent D1 recovery.
        errors.push(`${row.id}:${message.slice(0, 400)}`);
      }
    }

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE WORK_QUEUE
         SET status='abandoned',error_text='stale_workflow_recovered',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
         WHERE id=? AND status='running'`
      ).bind(row.id),
      env.DB.prepare(
        `UPDATE RUNS
         SET status='abandoned',error_text='stale_workflow_recovered',completed_at=CURRENT_TIMESTAMP
         WHERE job_id=? AND status='running'`
      ).bind(row.id),
      env.DB.prepare(
        `UPDATE FACTORY_ROADMAP
         SET status='ready',work_queue_id=NULL,result_summary='Recovered after stale workflow timeout',updated_at=CURRENT_TIMESTAMP
         WHERE work_queue_id=? AND status='dispatched'`
      ).bind(row.id),
      env.DB.prepare(
        `INSERT INTO JOB_DECISIONS(job_id,decision_type,actor_role,data_json)
         VALUES (?,'STALE_RECOVER','Governor',?)`
      ).bind(row.id,JSON.stringify({ previousUpdatedAt: row.updated_at, workflowInstanceId: row.workflow_instance_id }))
    ]);
    recovered++;
  }

  if (recovered > 0) {
    await env.DB.prepare(
      `INSERT INTO METRICS(metric_name,metric_value,metric_text,scope)
       VALUES ('stale_jobs_recovered',?,?,'factory')`
    ).bind(recovered,JSON.stringify({ terminated, errors: errors.slice(0, 5) })).run();
  }

  return { scanned: rows.results.length, recovered, terminated, errors };
}
