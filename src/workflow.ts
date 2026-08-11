import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

export type FactoryJobParams = { jobId: string };
type Env = { DB: D1Database };

export class FactoryWorkflow extends WorkflowEntrypoint<Env, FactoryJobParams> {
  async run(event: WorkflowEvent<FactoryJobParams>, step: WorkflowStep) {
    const jobId = event.payload.jobId;
    const runId = crypto.randomUUID();

    await step.do("mark job running", async () => {
      await this.env.DB.batch([
        this.env.DB.prepare(`UPDATE WORK_QUEUE SET status='running',attempts=attempts+1,started_at=COALESCE(started_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(jobId),
        this.env.DB.prepare(`INSERT INTO RUNS(id,job_id,status) VALUES (?,?,'running')`).bind(runId,jobId),
        this.env.DB.prepare(`INSERT INTO RUN_EVENTS(run_id,event_type,message) VALUES (?,'workflow_started','Factory workflow started')`).bind(runId)
      ]);
    });

    const result = await step.do("factory bootstrap execution",
      { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
      async () => ({ ok:true, phase:"bootstrap", message:"Governor + D1 + durable Workflow are operational." })
    );

    await step.do("mark job completed", async () => {
      const resultJson = JSON.stringify(result);
      await this.env.DB.batch([
        this.env.DB.prepare(`UPDATE WORK_QUEUE SET status='completed',result_json=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(resultJson,jobId),
        this.env.DB.prepare(`UPDATE RUNS SET status='completed',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(resultJson,runId),
        this.env.DB.prepare(`INSERT INTO RUN_EVENTS(run_id,event_type,message,data_json) VALUES (?,'workflow_completed','Factory workflow completed',?)`).bind(runId,resultJson)
      ]);
    });

    return { jobId, runId, result };
  }
}
