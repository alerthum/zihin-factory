import { ensureSchema } from "./schema";
import { governorCycle, seedRoadmap, setContinuous, recoverStaleJobs, FACTORY_MAX_PARALLEL, laneForRole, laneLabel } from "./governor";
import { getRepo } from "./providers/github";
import { projectFeederCycle } from "./project/feeder";
import { dashboardHtml } from "./dashboard/html";
import { guidanceForError } from "./operations/guidance";
export { FactoryWorkflow } from "./workflow";

type Env = {
  DB: D1Database;
  FACTORY_WORKFLOW: Workflow;
  JOB_QUEUE: Queue;
  FACTORY_ADMIN_TOKEN: string;
  NVIDIA_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  GITHUB_TOKEN?: string;
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

let phaseMarked = false;

async function markPhase(db: D1Database): Promise<void> {
  if (phaseMarked) return;
  await db.prepare(
    `INSERT INTO PROJECT_STATE(key,value,updated_at)
     VALUES ('factory_phase','project-director-production-engine',CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`
  ).run();
  phaseMarked = true;
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

async function restartDispatchedRoadmapJob(env: Env, roadmapId: string): Promise<{ restarted:boolean; roadmapId:string; jobId?:string; terminated?:boolean; reason?:string }> {
  const roadmap = await env.DB.prepare(
    `SELECT id,status,work_queue_id FROM FACTORY_ROADMAP WHERE id=?`
  ).bind(roadmapId).first<{ id:string; status:string; work_queue_id:string|null }>();

  if (!roadmap) return { restarted:false,roadmapId,reason:"roadmap_not_found" };
  if (roadmap.status === "done") return { restarted:false,roadmapId,reason:"already_done" };
  if (roadmap.status === "ready") return { restarted:false,roadmapId,reason:"already_ready" };
  if (!["dispatched","quarantine","blocked"].includes(roadmap.status) || !roadmap.work_queue_id) {
    return { restarted:false,roadmapId,reason:`not_restartable:${roadmap.status}` };
  }

  const job = await env.DB.prepare(
    `SELECT id,status,workflow_instance_id FROM WORK_QUEUE WHERE id=?`
  ).bind(roadmap.work_queue_id).first<{ id:string; status:string; workflow_instance_id:string|null }>();

  if (!job) {
    await env.DB.prepare(`UPDATE FACTORY_ROADMAP SET status='ready',work_queue_id=NULL,result_summary='Restarted after QA contract patch',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(roadmapId).run();
    return { restarted:true,roadmapId,reason:"missing_job_reset_to_ready" };
  }
  if (job.status === "completed") {
    const closedProductPr = await env.DB.prepare(
      `SELECT id FROM PROJECT_IMPACT WHERE job_id=? AND status='closed-unmerged' LIMIT 1`
    ).bind(job.id).first<{id:string}>();
    if (roadmap.status === "quarantine" && closedProductPr) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE FACTORY_ROADMAP SET status='ready',work_queue_id=NULL,result_summary='Retry requested after product PR closed without merge',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(roadmapId),
        env.DB.prepare(`INSERT INTO JOB_DECISIONS(job_id,decision_type,actor_role,data_json) VALUES (?,'ADMIN_RETRY_CLOSED_PR','Governor',?)`).bind(job.id,JSON.stringify({roadmapId,impactId:closedProductPr.id}))
      ]);
      return {restarted:true,roadmapId,jobId:job.id,reason:"closed_product_pr_reset_to_ready"};
    }
    return { restarted:false,roadmapId,jobId:job.id,reason:"job_completed" };
  }

  let terminated = false;
  if (job.workflow_instance_id && ["running","queued","verify"].includes(job.status)) {
    try {
      const instance = await env.FACTORY_WORKFLOW.get(job.workflow_instance_id);
      const status = await instance.status();
      if (["queued","running","waiting","paused","waitingForPause"].includes(status.status)) {
        await instance.terminate();
        terminated = true;
      }
    } catch { /* D1 reset remains authoritative for restart */ }
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE WORK_QUEUE SET status='abandoned',error_text='admin_roadmap_restart',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status!='completed'`
    ).bind(job.id),
    env.DB.prepare(
      `UPDATE RUNS SET status='abandoned',error_text='admin_roadmap_restart',completed_at=CURRENT_TIMESTAMP WHERE job_id=? AND status='running'`
    ).bind(job.id),
    env.DB.prepare(
      `UPDATE FACTORY_ROADMAP SET status='ready',work_queue_id=NULL,result_summary='Restarted after QA contract patch',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('dispatched','quarantine','blocked')`
    ).bind(roadmapId),
    env.DB.prepare(
      `INSERT INTO JOB_DECISIONS(job_id,decision_type,actor_role,data_json) VALUES (?,'ADMIN_RESTART','Governor',?)`
    ).bind(job.id,JSON.stringify({ roadmapId,terminated }))
  ]);

  return { restarted:true,roadmapId,jobId:job.id,terminated };
}

async function factorySnapshot(db: D1Database) {
  const state = await db.prepare(`SELECT key,value,updated_at FROM PROJECT_STATE ORDER BY key`).all<{key:string;value:string;updated_at:string}>();
  const queue = await db.prepare(`SELECT status,COUNT(*) AS count FROM WORK_QUEUE GROUP BY status ORDER BY status`).all();
  const roadmap = await db.prepare(
    `SELECT id,sequence_no,title,job_type,agent_role,objective,status,work_queue_id,result_summary,depends_on_json,updated_at
     FROM FACTORY_ROADMAP ORDER BY sequence_no`
  ).all<Record<string,unknown>>();

  const roadmapStatus = new Map<string,string>();
  for (const row of roadmap.results) roadmapStatus.set(String(row.id),String(row.status));
  const roadmapView = roadmap.results.map(row => {
    let deps: string[] = [];
    try { const parsed = JSON.parse(String(row.depends_on_json ?? "[]")); if (Array.isArray(parsed)) deps = parsed.map(String); } catch { deps = []; }
    const blockedBy = deps.filter(id => roadmapStatus.get(id) !== "done").map(id => ({ id, status:roadmapStatus.get(id) ?? "missing" }));
    const eligible = String(row.status) === "ready" && blockedBy.length === 0;
    const lane = laneForRole(String(row.agent_role ?? ""));
    return { ...row, depends_on_json:undefined, dependencies:deps, blockedBy, eligible, lane, lane_label:laneLabel(lane) };
  });
  const eligibleRoadmap = roadmapView.filter(x => x.eligible);
  const blockedReadyRoadmap = roadmapView.filter((x:any) => String(x.status) === "ready" && !x.eligible);
  const recentReviews = await db.prepare(
    `SELECT q.job_id,q.reviewer_model,q.attempt_no,q.decision,q.score,q.created_at,r.title AS roadmap_title
     FROM QUALITY_REVIEWS q LEFT JOIN FACTORY_ROADMAP r ON r.work_queue_id=q.job_id
     ORDER BY q.created_at DESC LIMIT 30`
  ).all();
  const blockers = await db.prepare(
    `SELECT id,severity,status,summary,details,created_at,updated_at FROM BLOCKERS
     WHERE status='open' ORDER BY created_at DESC LIMIT 30`
  ).all();
  const recentFailures = await db.prepare(
    `SELECT w.id AS job_id,w.job_type,w.status,w.error_text,w.updated_at,r.id AS roadmap_id,r.title AS roadmap_title,r.agent_role,r.result_summary
     FROM WORK_QUEUE w LEFT JOIN FACTORY_ROADMAP r ON r.work_queue_id=w.id
     WHERE w.status IN ('failed','blocked','quarantine','abandoned')
     ORDER BY w.updated_at DESC LIMIT 20`
  ).all<{job_id:string;job_type:string;status:string;error_text:string|null;updated_at:string;roadmap_id:string|null;roadmap_title:string|null;agent_role:string|null;result_summary:string|null}>();
  const operatorIssues = recentFailures.results.map(row => ({
    ...row,
    guidance: guidanceForError(row.error_text ?? row.result_summary,row.status)
  }));
  const activeRaw = await db.prepare(
    `SELECT w.id,w.job_type,w.status,w.payload_json,w.workflow_instance_id,w.started_at,w.updated_at,w.error_text,
            r.title AS roadmap_title,r.agent_role,
            (SELECT e.message FROM RUN_EVENTS e JOIN RUNS rr ON rr.id=e.run_id WHERE rr.job_id=w.id ORDER BY e.created_at DESC LIMIT 1) AS latest_event
     FROM WORK_QUEUE w LEFT JOIN FACTORY_ROADMAP r ON r.work_queue_id=w.id
     WHERE w.status IN ('running','verify') ORDER BY w.updated_at ASC LIMIT 10`
  ).all<Record<string,unknown>>();
  const activeJobs = activeRaw.results.map(row => {
    let payload: Record<string,unknown> = {};
    try { payload = JSON.parse(String(row.payload_json ?? "{}")); } catch { payload = {}; }
    const role = String(row.agent_role ?? payload.agentRole ?? "");
    const lane = laneForRole(role);
    return { ...row, payload_json:undefined, agent_role:role || null, roadmap_title:row.roadmap_title ?? payload.roadmapTitle ?? null, lane, lane_label:laneLabel(lane) };
  });
  const startingRaw = await db.prepare(
    `SELECT w.id,w.job_type,w.status,w.payload_json,w.workflow_instance_id,w.updated_at,
            r.title AS roadmap_title,r.agent_role
     FROM WORK_QUEUE w LEFT JOIN FACTORY_ROADMAP r ON r.work_queue_id=w.id
     WHERE w.status='queued' ORDER BY w.updated_at ASC LIMIT 10`
  ).all<Record<string,unknown>>();
  const startingJobs = startingRaw.results.map(row => {
    let payload: Record<string,unknown> = {};
    try { payload = JSON.parse(String(row.payload_json ?? "{}")); } catch { payload = {}; }
    const role = String(row.agent_role ?? payload.agentRole ?? "");
    const lane = laneForRole(role);
    return { ...row,payload_json:undefined,agent_role:role || null,roadmap_title:row.roadmap_title ?? payload.roadmapTitle ?? null,lane,lane_label:laneLabel(lane) };
  });

  const recentEvents = await db.prepare(
    `SELECT re.run_id,re.event_type,re.message,re.created_at,r.job_id,fr.title AS roadmap_title
     FROM RUN_EVENTS re
     LEFT JOIN RUNS r ON r.id=re.run_id
     LEFT JOIN FACTORY_ROADMAP fr ON fr.work_queue_id=r.job_id
     ORDER BY re.created_at DESC LIMIT 50`
  ).all();
  const repos = await db.prepare(
    `SELECT alias,repo_full_name,default_branch,write_mode,enabled,last_checked_at,last_error,updated_at FROM PROJECT_REPOS ORDER BY alias`
  ).all();
  const githubOperations = await db.prepare(
    `SELECT id,job_id,repo_full_name,operation,branch_name,pr_number,status,data_json,created_at,updated_at
     FROM GITHUB_OPERATIONS ORDER BY created_at DESC LIMIT 30`
  ).all();
  const impact = await db.prepare(
    `SELECT id,roadmap_id,job_id,impact_area,repo_full_name,branch_name,pr_number,pr_url,status,summary,files_json,qa_score,created_at,updated_at
     FROM PROJECT_IMPACT ORDER BY created_at DESC LIMIT 40`
  ).all();
  const todayImpact = await db.prepare(
    `SELECT id,roadmap_id,job_id,impact_area,repo_full_name,branch_name,pr_number,pr_url,status,summary,files_json,qa_score,created_at,updated_at
     FROM PROJECT_IMPACT WHERE date(created_at)=date('now') ORDER BY created_at DESC LIMIT 40`
  ).all();
  const feedLog = await db.prepare(
    `SELECT action,roadmap_id,detail_json,created_at FROM PROJECT_FEED_LOG ORDER BY created_at DESC LIMIT 30`
  ).all();
  const agents = await db.prepare(
    `SELECT id,role,provider,model,enabled,updated_at FROM AGENTS WHERE enabled=1 ORDER BY role`
  ).all();
  const todayRow = await db.prepare(
    `SELECT
       SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN status='merged' THEN 1 ELSE 0 END) AS merged,
       SUM(CASE WHEN status='waiting-human' THEN 1 ELSE 0 END) AS waiting_human,
       COUNT(*) AS total
     FROM PROJECT_IMPACT WHERE date(created_at)=date('now')`
  ).first<{completed:number|null;merged:number|null;waiting_human:number|null;total:number|null}>();
  const last6h = await db.prepare(`SELECT
      COUNT(*) AS jobs,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status='quarantine' THEN 1 ELSE 0 END) AS quarantine,
      SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END) AS blocked,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status IN ('running','verify') THEN 1 ELSE 0 END) AS active
    FROM WORK_QUEUE WHERE datetime(created_at) >= datetime('now','-6 hours')`).first<{jobs:number|null;completed:number|null;quarantine:number|null;blocked:number|null;failed:number|null;active:number|null}>();
  const last6hPr = await db.prepare(`SELECT
      SUM(CASE WHEN status='waiting-human' THEN 1 ELSE 0 END) AS waiting,
      SUM(CASE WHEN status='merged' THEN 1 ELSE 0 END) AS merged,
      COUNT(*) AS total
    FROM PROJECT_IMPACT WHERE datetime(created_at) >= datetime('now','-6 hours') AND pr_number IS NOT NULL`).first<{waiting:number|null;merged:number|null;total:number|null}>();
  const directorFeeds = await db.prepare(`SELECT action,COUNT(*) AS count FROM PROJECT_FEED_LOG
    WHERE datetime(created_at) >= datetime('now','-6 hours') AND action IN ('DIRECTOR_SEED','PROMOTE_RECON_TO_CODE') GROUP BY action`).all<{action:string;count:number}>();
  const meta = await db.prepare(`SELECT key,value FROM FACTORY_META ORDER BY key`).all<{key:string;value:string}>();
  const stateMap = Object.fromEntries(state.results.map(x=>[x.key,x.value]));
  const metaMap = Object.fromEntries(meta.results.map(x=>[x.key,x.value]));
  const laneKeys = ["research","content","code","qa","release"] as const;
  const laneSummary = laneKeys.map(lane => ({
    lane,
    label:laneLabel(lane),
    active:activeJobs.filter(x=>x.lane===lane).length,
    starting:startingJobs.filter(x=>x.lane===lane).length,
    eligible:eligibleRoadmap.filter(x=>x.lane===lane).length,
    capacity:1
  }));

  return {
    version:metaMap.factory_version ?? "0.7.0",
    state:state.results,stateMap,
    queue:queue.results,roadmap:roadmapView,eligibleRoadmap,blockedReadyRoadmap,recentReviews:recentReviews.results,blockers:blockers.results,
    activeJobs,startingJobs,recentEvents:recentEvents.results,repos:repos.results,githubOperations:githubOperations.results,
    impact:impact.results,todayImpact:todayImpact.results,feedLog:feedLog.results,agents:agents.results,
    operatorIssues,laneSummary,parallelLimit:FACTORY_MAX_PARALLEL,
    last6h:{jobs:Number(last6h?.jobs??0),completed:Number(last6h?.completed??0),quarantine:Number(last6h?.quarantine??0),blocked:Number(last6h?.blocked??0),failed:Number(last6h?.failed??0),active:Number(last6h?.active??0),prs:Number(last6hPr?.total??0),prsWaiting:Number(last6hPr?.waiting??0),prsMerged:Number(last6hPr?.merged??0),directorFeeds:Object.fromEntries(directorFeeds.results.map(x=>[x.action,Number(x.count??0)]))},
    today:{completed:Number(todayRow?.completed??0),merged:Number(todayRow?.merged??0),waitingHuman:Number(todayRow?.waiting_human??0),total:Number(todayRow?.total??0)}
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
        phase: "project-director-production-engine",
        time: new Date().toISOString(),
        meta: meta.results
      });
    }

    if (request.method === "GET" && url.pathname === "/dashboard") {
      return new Response(dashboardHtml(),{headers:{
        "content-type":"text/html; charset=utf-8","cache-control":"no-store","referrer-policy":"no-referrer",
        "x-frame-options":"DENY","x-content-type-options":"nosniff",
        "content-security-policy":"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
      }});
    }

    if (!authorized(request, env)) {
      return json({ ok:false,error:"unauthorized" }, { status:401 });
    }

    if (request.method === "GET" && (url.pathname === "/status" || url.pathname === "/dashboard/api")) {
      const snapshot = await factorySnapshot(env.DB);
      return json({ ok:true,phase:"project-director-production-engine",...snapshot });
    }

    if (request.method === "GET" && url.pathname === "/factory") {
      const snapshot = await factorySnapshot(env.DB);
      return json({ ok:true,phase:"project-director-production-engine",...snapshot });
    }

    if (request.method === "GET" && url.pathname === "/github/status") {
      const repos = await env.DB.prepare(`SELECT alias,repo_full_name,default_branch,write_mode,enabled,last_checked_at,last_error FROM PROJECT_REPOS ORDER BY alias`).all<{ alias:string; repo_full_name:string; default_branch:string|null; write_mode:string; enabled:number; last_checked_at:string|null; last_error:string|null }>();
      const secretConfigured = Boolean(String(env.GITHUB_TOKEN ?? "").trim());
      const live: Array<Record<string, unknown>> = [];
      if (secretConfigured) {
        for (const row of repos.results) {
          if (!row.enabled) continue;
          try {
            const info = await getRepo(env,row.repo_full_name);
            live.push({ alias:row.alias,repo:info.full_name,defaultBranch:info.default_branch,private:info.private,permissions:info.permissions ?? null,ok:true });
            await env.DB.prepare(`UPDATE PROJECT_REPOS SET default_branch=?,last_checked_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE alias=?`).bind(info.default_branch,row.alias).run();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            live.push({ alias:row.alias,repo:row.repo_full_name,ok:false,error:message.slice(0,900) });
            await env.DB.prepare(`UPDATE PROJECT_REPOS SET last_checked_at=CURRENT_TIMESTAMP,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE alias=?`).bind(message.slice(0,1200),row.alias).run();
          }
        }
      }
      return json({ ok:true,secretConfigured,repos:repos.results,live });
    }

    if (request.method === "POST" && url.pathname === "/admin/github/configure") {
      let body: { factoryRepo?:string; productRepo?:string };
      try { body = await request.json(); } catch { return json({ok:false,error:"invalid_json"},{status:400}); }
      const pairs = [["factory",body.factoryRepo],["product",body.productRepo]] as Array<[string,string|undefined]>;
      for (const [alias,value] of pairs) {
        if (!value) continue;
        if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) return json({ok:false,error:`invalid_repo:${alias}`},{status:400});
        await env.DB.prepare(`INSERT INTO PROJECT_REPOS(alias,repo_full_name,write_mode,enabled,updated_at) VALUES (?,?,'pr-only',1,CURRENT_TIMESTAMP) ON CONFLICT(alias) DO UPDATE SET repo_full_name=excluded.repo_full_name,default_branch=NULL,write_mode='pr-only',enabled=1,last_checked_at=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP`).bind(alias,value).run();
      }
      const rows = await env.DB.prepare(`SELECT alias,repo_full_name,write_mode,enabled FROM PROJECT_REPOS ORDER BY alias`).all();
      return json({ok:true,repos:rows.results});
    }

    if (request.method === "POST" && url.pathname === "/admin/github-smoke") {
      if (!String(env.GITHUB_TOKEN ?? "").trim()) return json({ok:false,error:"github_token_not_configured"},{status:409});
      const repo = await env.DB.prepare(`SELECT repo_full_name FROM PROJECT_REPOS WHERE alias='factory' AND enabled=1`).first<{repo_full_name:string}>();
      if (!repo) return json({ok:false,error:"factory_repo_not_configured"},{status:409});
      const jobId = crypto.randomUUID();
      const path = `docs/factory-writer-smoke/${jobId}.md`;
      const payload = {
        repoAlias:"factory",
        title:"GitHub Project Writer smoke test",
        summary:"Validates PR-only GitHub write access from the durable Zihin Factory.",
        changes:[{path,content:`# Zihin Factory GitHub Writer Smoke\n\nJob: ${jobId}\nCreated: ${new Date().toISOString()}\n\nThis draft PR proves branch + commit + PR-only write access. It may be closed after verification.\n`}]
      };
      await env.DB.prepare(`INSERT INTO WORK_QUEUE(id,job_type,status,priority,payload_json) VALUES (?,'github.project-pr','queued',5,?)`).bind(jobId,JSON.stringify(payload)).run();
      await env.JOB_QUEUE.send({kind:"job",jobId,source:"github-smoke"} satisfies QueueMessage);
      return json({ok:true,jobId,status:"queued",repo:repo.repo_full_name,path},{status:202});
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

    if (request.method === "POST" && url.pathname === "/admin/restart-roadmap-job") {
      let body: { roadmapId?: string };
      try { body = await request.json(); }
      catch { return json({ ok:false,error:"invalid_json" }, { status:400 }); }
      const roadmapId = String(body.roadmapId ?? "").trim();
      if (!roadmapId) return json({ ok:false,error:"roadmapId_required" }, { status:400 });
      const restart = await restartDispatchedRoadmapJob(env,roadmapId);
      const cycle = await governorCycle(env);
      return json({ ok:true,restart,cycle });
    }

    if (request.method === "POST" && url.pathname === "/admin/project-feed") {
      const feeder = await projectFeederCycle(env);
      const cycle = await governorCycle(env);
      return json({ok:true,feeder,cycle});
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
      phase:"project-director-production-engine",
      routes:[
        "GET /health (public)",
        "GET /dashboard (public shell; token entered in browser)",
        "GET /dashboard/api (Bearer token)",
        "GET /factory (Bearer token)",
        "GET /status (Bearer token)",
        "GET /github/status (Bearer token)",
        "GET /jobs (Bearer token)",
        "GET /jobs/:id (Bearer token)",
        "POST /jobs (Bearer token)",
        "POST /admin/seed-roadmap (Bearer token)",
        "POST /admin/start (Bearer token)",
        "POST /admin/pause (Bearer token)",
        "POST /admin/github/configure (Bearer token)",
        "POST /admin/github-smoke (Bearer token)",
        "POST /admin/restart-roadmap-job (Bearer token)",
        "POST /admin/project-feed (Bearer token)",
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
