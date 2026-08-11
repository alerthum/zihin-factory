import { ensureSchema } from "./schema";
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

type QueueJobMessage = {
  jobId: string;
  source: "api" | "recovery-cron" | "manual-recovery";
};

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

async function markFactoryPhase(db: D1Database): Promise<void> {
  await db.prepare(
    `INSERT INTO PROJECT_STATE(key,value,updated_at)
     VALUES ('factory_phase','queue-scheduler',CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET
       value=excluded.value,
       updated_at=CURRENT_TIMESTAMP`
  ).run();
}

async function jobDetail(db: D1Database, jobId: string) {
  const job = await db.prepare(
    `SELECT * FROM WORK_QUEUE WHERE id=?`
  ).bind(jobId).first();

  if (!job) return null;

  const artifacts = await db.prepare(
    `SELECT id,kind,name,metadata_json,created_at
     FROM ARTIFACTS WHERE job_id=? ORDER BY created_at`
  ).bind(jobId).all();

  const runs = await db.prepare(
    `SELECT id,status,started_at,completed_at,result_json,error_text
     FROM RUNS WHERE job_id=? ORDER BY started_at`
  ).bind(jobId).all();

  return { job, artifacts: artifacts.results, runs: runs.results };
}

async function enqueueJob(
  env: Env,
  jobId: string,
  source: QueueJobMessage["source"]
): Promise<void> {
  await env.JOB_QUEUE.send({ jobId, source } satisfies QueueJobMessage);
}

async function recoverStrandedJobs(
  env: Env,
  source: "recovery-cron" | "manual-recovery"
): Promise<{ scanned: number; enqueued: number }> {
  const rows = await env.DB.prepare(
    `SELECT id
     FROM WORK_QUEUE
     WHERE status='queued'
       AND workflow_instance_id IS NULL
     ORDER BY priority ASC, created_at ASC
     LIMIT 25`
  ).all<{ id: string }>();

  let enqueued = 0;

  for (const row of rows.results) {
    await enqueueJob(env, row.id, source);
    enqueued++;
  }

  if (enqueued > 0) {
    await env.DB.prepare(
      `INSERT INTO METRICS(metric_name,metric_value,metric_text,scope)
       VALUES ('recovery_enqueued',?,?, 'factory')`
    ).bind(enqueued, source).run();
  }

  return { scanned: rows.results.length, enqueued };
}

async function dispatchQueueMessage(
  env: Env,
  message: Message<unknown>
): Promise<void> {
  const body = message.body as Partial<QueueJobMessage>;
  const jobId = typeof body?.jobId === "string" ? body.jobId : "";

  if (!jobId) {
    message.ack();
    return;
  }

  const row = await env.DB.prepare(
    `SELECT id,status,workflow_instance_id
     FROM WORK_QUEUE WHERE id=?`
  ).bind(jobId).first<JobRow>();

  if (!row) {
    message.ack();
    return;
  }

  if (row.status === "completed" || row.status === "failed") {
    message.ack();
    return;
  }

  if (row.workflow_instance_id) {
    message.ack();
    return;
  }

  // Deterministic Workflow IDs make queue delivery idempotent.
  // createBatch() skips an already-existing instance with the same ID.
  const workflowInstanceId = `job-${jobId}`;

  await env.FACTORY_WORKFLOW.createBatch([
    {
      id: workflowInstanceId,
      params: { jobId }
    }
  ]);

  await env.DB.prepare(
    `UPDATE WORK_QUEUE
     SET workflow_instance_id=?,
         updated_at=CURRENT_TIMESTAMP
     WHERE id=?
       AND workflow_instance_id IS NULL`
  ).bind(workflowInstanceId, jobId).run();

  message.ack();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    await ensureSchema(env.DB);
    await markFactoryPhase(env.DB);

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      const meta = await env.DB.prepare(
        `SELECT key,value FROM FACTORY_META ORDER BY key`
      ).all();

      return json({
        ok: true,
        service: "zihin-factory-governor",
        phase: "queue-scheduler",
        time: new Date().toISOString(),
        meta: meta.results
      });
    }

    if (!authorized(request, env)) {
      return json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    if (request.method === "GET" && url.pathname === "/status") {
      const state = await env.DB.prepare(
        `SELECT key,value,updated_at FROM PROJECT_STATE ORDER BY key`
      ).all();

      const queue = await env.DB.prepare(
        `SELECT status,COUNT(*) AS count
         FROM WORK_QUEUE GROUP BY status ORDER BY status`
      ).all();

      return json({
        ok: true,
        state: state.results,
        queue: queue.results
      });
    }

    if (request.method === "GET" && url.pathname === "/jobs") {
      const jobs = await env.DB.prepare(
        `SELECT id,job_type,status,priority,attempts,workflow_instance_id,
                created_at,started_at,completed_at,updated_at,error_text
         FROM WORK_QUEUE
         ORDER BY created_at DESC
         LIMIT 50`
      ).all();

      return json({ ok: true, jobs: jobs.results });
    }

    const detailMatch = url.pathname.match(/^\/jobs\/([0-9a-f-]+)$/i);
    if (request.method === "GET" && detailMatch) {
      const detail = await jobDetail(env.DB, detailMatch[1]);

      return detail
        ? json({ ok: true, ...detail })
        : json({ ok: false, error: "job_not_found" }, { status: 404 });
    }

    if (request.method === "POST" && url.pathname === "/admin/recover") {
      const recovered = await recoverStrandedJobs(env, "manual-recovery");
      return json({ ok: true, ...recovered });
    }

    if (request.method === "POST" && url.pathname === "/jobs") {
      let body: {
        jobType?: string;
        priority?: number;
        payload?: unknown;
        dispatchMode?: "queue" | "scheduler";
      };

      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "invalid_json" }, { status: 400 });
      }

      const jobId = crypto.randomUUID();
      const jobType = body.jobType?.trim() || "factory.bootstrap";
      const priority = Number.isFinite(body.priority) ? Number(body.priority) : 100;
      const dispatchMode = body.dispatchMode === "scheduler" ? "scheduler" : "queue";

      await env.DB.prepare(
        `INSERT INTO WORK_QUEUE(id,job_type,status,priority,payload_json)
         VALUES (?,?,'queued',?,?)`
      ).bind(
        jobId,
        jobType,
        priority,
        JSON.stringify(body.payload ?? {})
      ).run();

      if (dispatchMode === "queue") {
        try {
          await enqueueJob(env, jobId, "api");
        } catch (error) {
          // The job remains queued. The minute recovery scheduler can pick it up.
          const message = error instanceof Error ? error.message : String(error);

          await env.DB.prepare(
            `INSERT INTO METRICS(metric_name,metric_text,scope)
             VALUES ('queue_send_warning',?,'factory')`
          ).bind(message.slice(0, 1000)).run();
        }
      }

      return json({
        ok: true,
        jobId,
        status: "queued",
        dispatchMode
      }, { status: 202 });
    }

    return json({
      ok: true,
      service: "zihin-factory-governor",
      phase: "queue-scheduler",
      routes: [
        "GET /health (public)",
        "GET /status (Bearer token)",
        "GET /jobs (Bearer token)",
        "GET /jobs/:id (Bearer token)",
        "POST /jobs (Bearer token)",
        "POST /admin/recover (Bearer token)"
      ]
    });
  },

  async queue(
    batch: MessageBatch<unknown>,
    env: Env
  ): Promise<void> {
    await ensureSchema(env.DB);
    await markFactoryPhase(env.DB);

    for (const message of batch.messages) {
      try {
        await dispatchQueueMessage(env, message);
      } catch (error) {
        const delaySeconds = Math.min(
          300,
          Math.max(10, 10 * Math.pow(2, Math.max(0, message.attempts - 1)))
        );

        message.retry({ delaySeconds });

        const text = error instanceof Error ? error.message : String(error);
        await env.DB.prepare(
          `INSERT INTO METRICS(metric_name,metric_text,scope)
           VALUES ('queue_consumer_retry',?,'factory')`
        ).bind(text.slice(0, 1000)).run();
      }
    }
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    await ensureSchema(env.DB);
    await markFactoryPhase(env.DB);
    await recoverStrandedJobs(env, "recovery-cron");
  }
};
