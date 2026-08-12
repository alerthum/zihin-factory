import { ensureSchema } from "./schema";
import { governorCycle, seedRoadmap, setContinuous, recoverStaleJobs } from "./governor";
export { FactoryWorkflow } from "./workflow";

type Env = {
  DB: D1Database;
  FACTORY_WORKFLOW: Workflow;
  JOB_QUEUE: Queue;
  FACTORY_ADMIN_TOKEN: string;
  NVIDIA_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
};

type QueueMessage =
  | { kind: "job"; jobId: string; source: string }
  | { kind: "governor"; source: string };

type JobRow = {
  id: string;
  status: string;
  workflow_instance_id: string | null;
};

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data, null, 2), { ...init, headers });
}

function authorized(request: Request, env: Env): boolean {
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${env.FACTORY_ADMIN_TOKEN}`;
}

async function markPhase(db: D1Database): Promise<void> {
  await db.prepare(
    `INSERT INTO PROJECT_STATE(key,value,updated_at)
     VALUES ('factory_phase','autonomous-qa-resilient',CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`
  ).run();
}

async function jobDetail(db: D1Database, jobId: string) {
  const job = await db.prepare(`SELECT * FROM WORK_QUEUE WHERE id=?`).bind(jobId).first();
  if (!job) return null;

  const artifacts = await db.prepare(
    `SELECT id,kind,name,metadata_json,created_at FROM ARTIFACTS WHERE job_id=? ORDER BY created_at`
  ).bind(jobId).all();
  const runs = await db.prepare(
    `SELECT id,status,started_at,completed_at,result_json,error_text FROM RUNS WHERE job_id=? ORDER BY started_at`
  ).bind(jobId).all();
  const reviews = await db.prepare(
    `SELECT id,reviewer_role,producer_model,reviewer_model,attempt_no,decision,score,reasons_json,revision_instructions,deterministic_issues_json,created_at
     FROM QUALITY_REVIEWS WHERE job_id=? ORDER BY attempt_no,created_at`
  ).bind(jobId).all();

  return { job, artifacts: artifacts.results, runs: runs.results, reviews: reviews.results };
}

async function dispatchJobMessage(env: Env, message: Message<unknown>, body: QueueMessage): Promise<void> {
  if (body.kind !== "job" || !body.jobId) {
    message.ack();
    return;
  }

  const row = await env.DB.prepare(
    `SELECT id,status,workflow_instance_id FROM WORK_QUEUE WHERE id=?`
  ).bind(body.jobId).first<JobRow>();

  if (!row) {
    message.ack();
    return;
  }

  if (["completed","failed","blocked","quarantine"].includes(row.status)) {
    message.ack();
    return;
  }

  if (row.workflow_instance_id) {
    message.ack();
    return;
  }

  const workflowInstanceId = `job-${body.jobId}`;
  await env.FACTORY_WORKFLOW.createBatch([{ id: workflowInstanceId, params: { jobId: body.jobId } }]);
  await env.DB.prepare(
    `UPDATE WORK_QUEUE SET workflow_instance_id=?,updated_at=CURRENT_TIMESTAMP
     WHERE id=? AND workflow_instance_id IS NULL`
  ).bind(workflowInstanceId, body.jobId).run();
  message.ack();
}

async function factorySnapshot(db: D1Database) {
  const state = await db.prepare(`SELECT key,value,updated_at FROM PROJECT_STATE ORDER BY key`).all();
  const queue = await db.prepare(
    `SELECT status,COUNT(*) AS count FROM WORK_QUEUE GROUP BY status ORDER BY status`
  ).all();
  const roadmap = await db.prepare(
    `SELECT id,sequence_no,title,agent_role,status,work_queue_id,result_summary,updated_at
     FROM FACTORY_ROADMAP ORDER BY sequence_no`
  ).all();
  const recentReviews = await db.prepare(
    `SELECT job_id,reviewer_model,attempt_no,decision,score,created_at
     FROM QUALITY_REVIEWS ORDER BY created_at DESC LIMIT 20`
  ).all();
  const blockers = await db.prepare(
    `SELECT id,severity,status,summary,details,created_at,updated_at
     FROM BLOCKERS WHERE status='open' ORDER BY created_at DESC LIMIT 20`
  ).all();
  const activeJobs = await db.prepare(
    `SELECT id,job_type,status,workflow_instance_id,started_at,updated_at,error_text
     FROM WORK_QUEUE WHERE status IN ('running','verify') ORDER BY updated_at ASC LIMIT 10`
  ).all();
  const recentEvents = await db.prepare(
    `SELECT re.run_id,re.event_type,re.message,re.created_at,r.job_id
     FROM RUN_EVENTS re LEFT JOIN RUNS r ON r.id=re.run_id
     ORDER BY re.created_at DESC LIMIT 30`
  ).all();

  return {
    state: state.results,
    queue: queue.results,
    roadmap: roadmap.results,
    recentReviews: recentReviews.results,
    blockers: blockers.results,
    activeJobs: activeJobs.results,
    recentEvents: recentEvents.results
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    await ensureSchema(env.DB);
    await markPhase(env.DB);
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      const meta = await env.DB.prepare(`SELECT key,value FROM FACTORY_META ORDER BY key`).all();
      return json({
        ok: true,
        service: "zihin-factory-governor",
        phase: "autonomous-qa-resilient",
        time: new Date().toISOString(),
        meta: meta.results
      });
    }

    if (!authorized(request, env)) {
      return json({ ok:false,error:"unauthorized" }, { status:401 });
    }

    if (request.method === "GET" && url.pathname === "/status") {
      const snapshot = await factorySnapshot(env.DB);
      return json({ ok:true,...snapshot });
    }

    if (request.method === "GET" && url.pathname === "/factory") {
      const snapshot = await factorySnapshot(env.DB);
      return json({ ok:true,phase:"autonomous-qa-resilient",...snapshot });
    }

    if (request.method === "GET" && url.pathname === "/jobs") {
      const jobs = await env.DB.prepare(
        `SELECT id,job_type,status,priority,attempts,workflow_instance_id,created_at,started_at,completed_at,updated_at,error_text
         FROM WORK_QUEUE ORDER BY created_at DESC LIMIT 50`
      ).all();
      return json({ ok:true,jobs:jobs.results });
    }

    const detailMatch = url.pathname.match(/^\/jobs\/([0-9a-f-]+)$/i);
    if (request.method === "GET" && detailMatch) {
      const detail = await jobDetail(env.DB, detailMatch[1]);
      return detail ? json({ ok:true,...detail }) : json({ ok:false,error:"job_not_found" }, { status:404 });
    }

    if (request.method === "POST" && url.pathname === "/admin/seed-roadmap") {
      const seeded = await seedRoadmap(env.DB);
      return json({ ok:true,...seeded });
    }

    if (request.method === "POST" && url.pathname === "/admin/start") {
      const seeded = await seedRoadmap(env.DB);
      await setContinuous(env.DB,true);
      const cycle = await governorCycle(env);
      return json({ ok:true,continuous:true,seeded,cycle });
    }

    if (request.method === "POST" && url.pathname === "/admin/pause") {
      await setContinuous(env.DB,false);
      return json({ ok:true,continuous:false });
    }

    if (request.method === "POST" && url.pathname === "/admin/recover-stale") {
      const recovery = await recoverStaleJobs(env,2);
      const cycle = await governorCycle(env);
      return json({ ok:true,recovery,cycle });
    }

    if (request.method === "POST" && url.pathname === "/admin/cycle") {
      const cycle = await governorCycle(env);
      return json({ ok:true,cycle });
    }

    if (request.method === "POST" && url.pathname === "/jobs") {
      let body: { jobType?: string; priority?: number; payload?: unknown };
      try { body = await request.json(); }
      catch { return json({ ok:false,error:"invalid_json" }, { status:400 }); }

      const jobId = crypto.randomUUID();
      const jobType = body.jobType?.trim() || "factory.autonomous-task";
      const priority = Number.isFinite(body.priority) ? Number(body.priority) : 100;

      await env.DB.prepare(
        `INSERT INTO WORK_QUEUE(id,job_type,status,priority,payload_json) VALUES (?,?,'queued',?,?)`
      ).bind(jobId,jobType,priority,JSON.stringify(body.payload ?? {})).run();

      await env.JOB_QUEUE.send({ kind:"job",jobId,source:"api" } satisfies QueueMessage);
      return json({ ok:true,jobId,status:"queued" }, { status:202 });
    }

    return json({
      ok:true,
      service:"zihin-factory-governor",
      phase:"autonomous-qa-resilient",
      routes:[
        "GET /health (public)",
        "GET /factory (Bearer token)",
        "GET /status (Bearer token)",
        "GET /jobs (Bearer token)",
        "GET /jobs/:id (Bearer token)",
        "POST /jobs (Bearer token)",
        "POST /admin/seed-roadmap (Bearer token)",
        "POST /admin/start (Bearer token)",
        "POST /admin/pause (Bearer token)",
        "POST /admin/recover-stale (Bearer token)",
        "POST /admin/cycle (Bearer token)"
      ]
    });
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    await ensureSchema(env.DB);
    await markPhase(env.DB);

    for (const message of batch.messages) {
      try {
        const body = message.body as QueueMessage;
        if (body?.kind === "governor") {
          await governorCycle(env);
          message.ack();
        } else {
          await dispatchJobMessage(env,message,body);
        }
      } catch (error) {
        const delaySeconds = Math.min(300,Math.max(10,10*Math.pow(2,Math.max(0,message.attempts-1))));
        message.retry({ delaySeconds });
        const text = error instanceof Error ? error.message : String(error);
        await env.DB.prepare(
          `INSERT INTO METRICS(metric_name,metric_text,scope) VALUES ('queue_consumer_retry',?,'factory')`
        ).bind(text.slice(0,1000)).run();
      }
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await ensureSchema(env.DB);
    await markPhase(env.DB);
    await governorCycle(env);
  }
};
