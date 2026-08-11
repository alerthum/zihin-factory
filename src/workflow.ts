import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { runNvidiaText } from "./providers/nvidia";
import { sendTelegram } from "./notifications/telegram";
import { routeAgent } from "./agents/router";
import { reviewOutput, type QualityReview } from "./quality/gate";

export type FactoryJobParams = { jobId: string };

type Env = {
  DB: D1Database;
  JOB_QUEUE: Queue;
  NVIDIA_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
};

type QueueRow = {
  id: string;
  job_type: string;
  payload_json: string;
};

type AutonomousPayload = {
  roadmapId?: string;
  roadmapTitle?: string;
  taskKind?: string;
  agentRole?: string;
  objective?: string;
  acceptanceCriteria?: string[];
  maxRevisionAttempts?: number;
  context?: unknown;
};

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function recordQuality(
  db: D1Database,
  input: {
    jobId: string;
    runId: string;
    producerModel: string;
    attemptNo: number;
    review: QualityReview;
  }
): Promise<void> {
  await db.prepare(
    `INSERT INTO QUALITY_REVIEWS
     (id,job_id,run_id,reviewer_role,producer_model,reviewer_model,attempt_no,decision,score,reasons_json,revision_instructions,deterministic_issues_json)
     VALUES (?,?,?,'QA Supervisor',?,?,?,?,?,?,?,?)`
  ).bind(
    crypto.randomUUID(),
    input.jobId,
    input.runId,
    input.producerModel,
    input.review.reviewerModel,
    input.attemptNo,
    input.review.decision,
    input.review.score,
    JSON.stringify(input.review.reasons),
    input.review.revisionInstructions,
    JSON.stringify(input.review.deterministicIssues)
  ).run();
}

async function notifyBestEffort(env: Env, text: string): Promise<void> {
  try { await sendTelegram(env, text); } catch { /* notification cannot alter job truth */ }
}

async function wakeGovernor(env: Env, source: string): Promise<void> {
  try {
    await env.JOB_QUEUE.send({ kind: "governor", source });
  } catch {
    // Minute cron is the durable fallback.
  }
}

export class FactoryWorkflow extends WorkflowEntrypoint<Env, FactoryJobParams> {
  async run(event: WorkflowEvent<FactoryJobParams>, step: WorkflowStep) {
    const jobId = event.payload.jobId;
    const runId = crypto.randomUUID();

    const job = await step.do("load job", async () => {
      const row = await this.env.DB.prepare(
        `SELECT id,job_type,payload_json FROM WORK_QUEUE WHERE id=?`
      ).bind(jobId).first<QueueRow>();
      if (!row) throw new Error(`Job not found: ${jobId}`);
      return row;
    });

    await step.do("mark job running", async () => {
      await this.env.DB.batch([
        this.env.DB.prepare(
          `UPDATE WORK_QUEUE SET status='running',attempts=attempts+1,
           started_at=COALESCE(started_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?`
        ).bind(jobId),
        this.env.DB.prepare(`INSERT INTO RUNS(id,job_id,status) VALUES (?,?,'running')`).bind(runId,jobId),
        this.env.DB.prepare(
          `INSERT INTO RUN_EVENTS(run_id,event_type,message) VALUES (?,'workflow_started','Factory workflow started')`
        ).bind(runId)
      ]);
    });

    try {
      if (job.job_type === "factory.bootstrap") {
        const result = { ok:true,kind:"factory.bootstrap",message:"Governor + Queue + D1 + Workflow operational." };
        const resultJson = JSON.stringify(result);
        await step.do("complete bootstrap", async () => {
          await this.env.DB.batch([
            this.env.DB.prepare(`UPDATE WORK_QUEUE SET status='completed',result_json=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(resultJson,jobId),
            this.env.DB.prepare(`UPDATE RUNS SET status='completed',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(resultJson,runId)
          ]);
        });
        await wakeGovernor(this.env,"bootstrap-completed");
        return { jobId,runId,result };
      }

      if (job.job_type === "ai.smoke-test") {
        const payload = safeJson(job.payload_json);
        const prompt = String(payload.prompt ?? "Return ZIHIN_FACTORY_AI_OK");
        const ai = await step.do("nvidia smoke", async () => runNvidiaText(this.env,{ prompt,system:String(payload.system ?? "Be concise."),maxTokens:500 }));
        const result = { ok:true,kind:"ai.smoke-test",model:ai.model,content:ai.content,usage:ai.usage };
        const resultJson = JSON.stringify(result);
        await step.do("persist smoke", async () => {
          await this.env.DB.batch([
            this.env.DB.prepare(`INSERT INTO ARTIFACTS(id,job_id,kind,name,metadata_json) VALUES (?,?,'ai-output','NVIDIA AI output',?)`).bind(crypto.randomUUID(),jobId,JSON.stringify(result)),
            this.env.DB.prepare(`UPDATE WORK_QUEUE SET status='completed',result_json=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(resultJson,jobId),
            this.env.DB.prepare(`UPDATE RUNS SET status='completed',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(resultJson,runId)
          ]);
        });
        await notifyBestEffort(this.env,`✅ Zihin Factory AI smoke completed\nJob: ${jobId}\nModel: ${ai.model}`);
        await wakeGovernor(this.env,"smoke-completed");
        return { jobId,runId,result };
      }

      const payload = safeJson(job.payload_json) as AutonomousPayload & Record<string, unknown>;
      const objective = String(payload.objective ?? "Complete the assigned factory task with implementation-ready detail.");
      const acceptanceCriteria = Array.isArray(payload.acceptanceCriteria)
        ? payload.acceptanceCriteria.map(String)
        : [];
      const routed = routeAgent(job.job_type,payload);
      const maxRevisionAttempts = Math.max(0,Math.min(2,Number(payload.maxRevisionAttempts ?? 2)));

      let attempt = 1;
      let producer = await step.do(
        "producer attempt 1",
        { retries:{ limit:3,delay:"10 seconds",backoff:"exponential" } },
        async () => runNvidiaText(this.env,{
          system:routed.systemPrompt,
          prompt:`OBJECTIVE:\n${objective}\n\nACCEPTANCE CRITERIA:\n${acceptanceCriteria.map((x,i)=>`${i+1}. ${x}`).join("\n") || "1. Materially satisfy the objective."}\n\nCONTEXT:\n${JSON.stringify(payload.context ?? {},null,2)}\n\nProduce the artifact now.`,
          maxTokens:1800,
          temperature:0.15,
          purpose:routed.purpose
        })
      );

      await step.do("persist producer artifact 1", async () => {
        await this.env.DB.prepare(
          `INSERT INTO ARTIFACTS(id,job_id,kind,name,metadata_json) VALUES (?,?,'agent-output',?,?)`
        ).bind(
          crypto.randomUUID(),jobId,`${routed.role} output attempt 1`,
          JSON.stringify({ role:routed.role,model:producer.model,attempt,content:producer.content,usage:producer.usage })
        ).run();
      });

      let review = await step.do("independent qa 1", async () => reviewOutput(this.env,{
        objective,acceptanceCriteria,producerRole:routed.role,producerModel:producer.model,output:producer.content,attempt
      }));
      await recordQuality(this.env.DB,{ jobId,runId,producerModel:producer.model,attemptNo:attempt,review });

      while (review.decision === "RETRY" && attempt <= maxRevisionAttempts) {
        attempt++;
        const previous = producer.content;
        const instructions = review.revisionInstructions || review.reasons.join("; ");

        producer = await step.do(
          `producer revision ${attempt}`,
          { retries:{ limit:2,delay:"10 seconds",backoff:"exponential" } },
          async () => runNvidiaText(this.env,{
            system:routed.systemPrompt,
            prompt:`Revise the artifact.\n\nOBJECTIVE:\n${objective}\n\nACCEPTANCE CRITERIA:\n${acceptanceCriteria.map((x,i)=>`${i+1}. ${x}`).join("\n")}\n\nQA REVISION INSTRUCTIONS:\n${instructions}\n\nPREVIOUS ARTIFACT:\n${previous}\n\nReturn the full corrected artifact, not a commentary about changes.`,
            maxTokens:1900,temperature:0.1,purpose:routed.purpose
          })
        );

        await step.do(`persist producer artifact ${attempt}`, async () => {
          await this.env.DB.prepare(
            `INSERT INTO ARTIFACTS(id,job_id,kind,name,metadata_json) VALUES (?,?,'agent-output',?,?)`
          ).bind(
            crypto.randomUUID(),jobId,`${routed.role} output attempt ${attempt}`,
            JSON.stringify({ role:routed.role,model:producer.model,attempt,content:producer.content,usage:producer.usage })
          ).run();
        });

        review = await step.do(`independent qa ${attempt}`, async () => reviewOutput(this.env,{
          objective,acceptanceCriteria,producerRole:routed.role,producerModel:producer.model,output:producer.content,attempt
        }));
        await recordQuality(this.env.DB,{ jobId,runId,producerModel:producer.model,attemptNo:attempt,review });
      }

      if (review.decision === "RETRY") {
        review = { ...review,decision:"QUARANTINE",reasons:[...review.reasons,"revision_budget_exhausted"] };
      }

      const roadmapId = typeof payload.roadmapId === "string" ? payload.roadmapId : null;
      const result = {
        ok:review.decision === "PASS",
        kind:"factory.autonomous-task",
        roadmapId,
        agentRole:routed.role,
        producerModel:producer.model,
        output:producer.content,
        qa:review,
        attempts:attempt
      };
      const resultJson = JSON.stringify(result);

      if (review.decision === "PASS") {
        await step.do("mark autonomous task completed", async () => {
          const statements = [
            this.env.DB.prepare(`UPDATE WORK_QUEUE SET status='completed',result_json=?,error_text=NULL,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(resultJson,jobId),
            this.env.DB.prepare(`UPDATE RUNS SET status='completed',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(resultJson,runId),
            this.env.DB.prepare(`INSERT INTO RUN_EVENTS(run_id,event_type,message,data_json) VALUES (?,'qa_pass','Independent QA PASS',?)`).bind(runId,JSON.stringify(review)),
            this.env.DB.prepare(`INSERT INTO JOB_DECISIONS(job_id,decision_type,actor_role,data_json) VALUES (?,'PASS','QA Supervisor',?)`).bind(jobId,JSON.stringify(review))
          ];
          if (roadmapId) statements.push(
            this.env.DB.prepare(`UPDATE FACTORY_ROADMAP SET status='done',result_summary=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(producer.content.slice(0,1000),roadmapId)
          );
          await this.env.DB.batch(statements);
        });
        await notifyBestEffort(this.env,`✅ Zihin Factory görev tamamlandı\n${String(payload.roadmapTitle ?? routed.role)}\nQA: ${review.score}/100\nModel: ${producer.model}`);
      } else if (review.decision === "BLOCKED") {
        await step.do("mark blocked", async () => {
          const statements = [
            this.env.DB.prepare(`UPDATE WORK_QUEUE SET status='blocked',result_json=?,error_text=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(resultJson,review.reasons.join("; ").slice(0,4000),jobId),
            this.env.DB.prepare(`UPDATE RUNS SET status='blocked',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(resultJson,runId),
            this.env.DB.prepare(`INSERT INTO BLOCKERS(id,scope,severity,status,summary,details) VALUES (?,'factory','high','open',?,?)`).bind(crypto.randomUUID(),String(payload.roadmapTitle ?? "Autonomous task blocked"),review.reasons.join("\n")),
            this.env.DB.prepare(`INSERT INTO JOB_DECISIONS(job_id,decision_type,actor_role,data_json) VALUES (?,'BLOCKED','QA Supervisor',?)`).bind(jobId,JSON.stringify(review))
          ];
          if (roadmapId) statements.push(this.env.DB.prepare(`UPDATE FACTORY_ROADMAP SET status='blocked',result_summary=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(review.reasons.join("; ").slice(0,1000),roadmapId));
          await this.env.DB.batch(statements);
        });
        await notifyBestEffort(this.env,`🟠 Zihin Factory BLOCKED\n${String(payload.roadmapTitle ?? jobId)}\n${review.reasons.slice(0,3).join("\n")}`);
      } else {
        await step.do("mark quarantine", async () => {
          const statements = [
            this.env.DB.prepare(`UPDATE WORK_QUEUE SET status='quarantine',result_json=?,error_text=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(resultJson,review.reasons.join("; ").slice(0,4000),jobId),
            this.env.DB.prepare(`UPDATE RUNS SET status='quarantine',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(resultJson,runId),
            this.env.DB.prepare(`INSERT INTO JOB_DECISIONS(job_id,decision_type,actor_role,data_json) VALUES (?,'QUARANTINE','QA Supervisor',?)`).bind(jobId,JSON.stringify(review))
          ];
          if (roadmapId) statements.push(this.env.DB.prepare(`UPDATE FACTORY_ROADMAP SET status='quarantine',result_summary=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(review.reasons.join("; ").slice(0,1000),roadmapId));
          await this.env.DB.batch(statements);
        });
        await notifyBestEffort(this.env,`🟠 Zihin Factory QUARANTINE\n${String(payload.roadmapTitle ?? jobId)}\nQA: ${review.score}/100`);
      }

      await wakeGovernor(this.env,`job-${review.decision.toLowerCase()}`);
      return { jobId,runId,result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await step.do("mark job failed", async () => {
        await this.env.DB.batch([
          this.env.DB.prepare(`UPDATE WORK_QUEUE SET status='failed',error_text=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(message.slice(0,4000),jobId),
          this.env.DB.prepare(`UPDATE RUNS SET status='failed',error_text=?,completed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(message.slice(0,4000),runId),
          this.env.DB.prepare(`INSERT INTO RUN_EVENTS(run_id,event_type,message) VALUES (?,'workflow_failed',?)`).bind(runId,message.slice(0,4000))
        ]);
      });
      await notifyBestEffort(this.env,`❌ Zihin Factory işi başarısız\nJob: ${jobId}\n${message.slice(0,2000)}`);
      await wakeGovernor(this.env,"job-failed");
      throw error;
    }
  }
}
