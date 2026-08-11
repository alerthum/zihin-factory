import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { runNvidiaText } from "./providers/nvidia";
import { sendTelegram } from "./notifications/telegram";

export type FactoryJobParams = { jobId: string };

type Env = {
  DB: D1Database;
  NVIDIA_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
};

type QueueRow = {
  id: string;
  job_type: string;
  payload_json: string;
};

export class FactoryWorkflow extends WorkflowEntrypoint<Env, FactoryJobParams> {
  async run(event: WorkflowEvent<FactoryJobParams>, step: WorkflowStep) {
    const jobId = event.payload.jobId;
    const runId = crypto.randomUUID();

    const job = await step.do("load job", async () => {
      const row = await this.env.DB.prepare(
        `SELECT id, job_type, payload_json FROM WORK_QUEUE WHERE id=?`
      ).bind(jobId).first<QueueRow>();
      if (!row) throw new Error(`Job not found: ${jobId}`);
      return row;
    });

    await step.do("mark job running", async () => {
      await this.env.DB.batch([
        this.env.DB.prepare(
          `UPDATE WORK_QUEUE
           SET status='running', attempts=attempts+1,
               started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
               updated_at=CURRENT_TIMESTAMP
           WHERE id=?`
        ).bind(jobId),
        this.env.DB.prepare(
          `INSERT INTO RUNS(id,job_id,status) VALUES (?,?,'running')`
        ).bind(runId, jobId),
        this.env.DB.prepare(
          `INSERT INTO RUN_EVENTS(run_id,event_type,message)
           VALUES (?,'workflow_started','Factory workflow started')`
        ).bind(runId)
      ]);
    });

    try {
      let result: unknown;

      if (job.job_type === "ai.smoke-test") {
        const payload = JSON.parse(job.payload_json || "{}") as {
          prompt?: string;
          system?: string;
        };

        if (!payload.prompt?.trim()) {
          throw new Error("ai.smoke-test requires payload.prompt");
        }

        const ai = await step.do(
          "nvidia ai call",
          { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } },
          async () => runNvidiaText(this.env, {
            prompt: payload.prompt!,
            system: payload.system ??
              "You are the Zihin Factory infrastructure test agent. Be concise and factual.",
            maxTokens: 500
          })
        );

        result = {
          ok: true,
          kind: "ai.smoke-test",
          model: ai.model,
          content: ai.content,
          usage: ai.usage
        };

        await step.do("persist ai artifact", async () => {
          await this.env.DB.prepare(
            `INSERT INTO ARTIFACTS
             (id,job_id,kind,name,metadata_json)
             VALUES (?,?,'ai-output','JOB-002 NVIDIA smoke result',?)`
          ).bind(
            crypto.randomUUID(),
            jobId,
            JSON.stringify({ model: ai.model, content: ai.content, usage: ai.usage })
          ).run();
        });

        await step.do(
          "telegram success notification",
          { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
          async () => sendTelegram(
            this.env,
            `✅ Zihin Factory JOB-002 tamamlandı\n` +
            `Job: ${jobId}\n` +
            `Model: ${ai.model}\n\n` +
            `${ai.content.slice(0, 1200)}`
          )
        );
      } else {
        result = {
          ok: true,
          kind: "factory.bootstrap",
          message: "Governor + D1 + durable Workflow are operational."
        };
      }

      const resultJson = JSON.stringify(result);

      await step.do("mark job completed", async () => {
        await this.env.DB.batch([
          this.env.DB.prepare(
            `UPDATE WORK_QUEUE
             SET status='completed',result_json=?,
                 completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
             WHERE id=?`
          ).bind(resultJson, jobId),
          this.env.DB.prepare(
            `UPDATE RUNS
             SET status='completed',result_json=?,completed_at=CURRENT_TIMESTAMP
             WHERE id=?`
          ).bind(resultJson, runId),
          this.env.DB.prepare(
            `INSERT INTO RUN_EVENTS(run_id,event_type,message,data_json)
             VALUES (?,'workflow_completed','Factory workflow completed',?)`
          ).bind(runId, resultJson)
        ]);
      });

      return { jobId, runId, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await step.do("mark job failed", async () => {
        await this.env.DB.batch([
          this.env.DB.prepare(
            `UPDATE WORK_QUEUE
             SET status='failed',error_text=?,completed_at=CURRENT_TIMESTAMP,
                 updated_at=CURRENT_TIMESTAMP
             WHERE id=?`
          ).bind(message.slice(0, 4000), jobId),
          this.env.DB.prepare(
            `UPDATE RUNS
             SET status='failed',error_text=?,completed_at=CURRENT_TIMESTAMP
             WHERE id=?`
          ).bind(message.slice(0, 4000), runId),
          this.env.DB.prepare(
            `INSERT INTO RUN_EVENTS(run_id,event_type,message)
             VALUES (?,'workflow_failed',?)`
          ).bind(runId, message.slice(0, 4000))
        ]);
      });

      try {
        await step.do(
          "telegram failure notification",
          { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" } },
          async () => sendTelegram(
            this.env,
            `❌ Zihin Factory işi başarısız\nJob: ${jobId}\n${message.slice(0, 2500)}`
          )
        );
      } catch {
        // Notification failure must not erase the original job failure.
      }

      throw error;
    }
  }
}
