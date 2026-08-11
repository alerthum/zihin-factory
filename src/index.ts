import { ensureSchema } from "./schema";
export { FactoryWorkflow } from "./workflow";

type Env = {
  DB: D1Database;
  FACTORY_WORKFLOW: Workflow;
  FACTORY_ADMIN_TOKEN: string;
  NVIDIA_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    await ensureSchema(env.DB);
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      const meta = await env.DB.prepare(
        `SELECT key,value FROM FACTORY_META ORDER BY key`
      ).all();

      return json({
        ok: true,
        service: "zihin-factory-governor",
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
      return json({ ok: true, state: state.results, queue: queue.results });
    }

    if (request.method === "GET" && url.pathname === "/jobs") {
      const jobs = await env.DB.prepare(
        `SELECT id,job_type,status,priority,attempts,created_at,
                started_at,completed_at,updated_at,error_text
         FROM WORK_QUEUE ORDER BY created_at DESC LIMIT 50`
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

    if (request.method === "POST" && url.pathname === "/jobs") {
      let body: { jobType?: string; priority?: number; payload?: unknown };
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "invalid_json" }, { status: 400 });
      }

      const jobId = crypto.randomUUID();
      const jobType = body.jobType?.trim() || "factory.bootstrap";
      const priority = Number.isFinite(body.priority) ? Number(body.priority) : 100;

      await env.DB.prepare(
        `INSERT INTO WORK_QUEUE(id,job_type,status,priority,payload_json)
         VALUES (?,?,'queued',?,?)`
      ).bind(jobId, jobType, priority, JSON.stringify(body.payload ?? {})).run();

      const instance = await env.FACTORY_WORKFLOW.create({ params: { jobId } });

      await env.DB.prepare(
        `UPDATE WORK_QUEUE
         SET workflow_instance_id=?,updated_at=CURRENT_TIMESTAMP
         WHERE id=?`
      ).bind(instance.id, jobId).run();

      return json({
        ok: true,
        jobId,
        workflowInstanceId: instance.id,
        status: "queued"
      }, { status: 202 });
    }

    return json({
      ok: true,
      service: "zihin-factory-governor",
      routes: [
        "GET /health (public)",
        "GET /status (Bearer token)",
        "GET /jobs (Bearer token)",
        "GET /jobs/:id (Bearer token)",
        "POST /jobs (Bearer token)"
      ]
    });
  }
};
