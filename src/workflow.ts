import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { runFactoryAI } from "./learning/ai";
import { defectCode, learnedPromptForRole, recordQualityLearning } from "./learning/memory";
import { sendTelegram } from "./notifications/telegram";
import { routeAgent } from "./agents/router";
import { reviewOutput, type QualityReview } from "./quality/gate";
import { createProjectDraftPr, getPullRequestCiState, getRepo, getRepoTree, getTextFile } from "./providers/github";
import { candidateRepoPaths, parsePathSelection, parseAndApplyPatchProposal, patchReviewArtifact, type AppliedPatch } from "./project/repo-tools";
import { guidanceForError, guidanceTelegramText } from "./operations/guidance";
import { applyProductDeterministicIssues, deterministicProductReview, productPatchDeterministicIssues, verificationManifestIssues } from "./quality/product-gates";
import { runTr8Benchmark } from "./assessment/tr8-benchmark-runner.js";

export type FactoryJobParams = { jobId: string };

type Env = {
  DB: D1Database;
  NVIDIA_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  GITHUB_TOKEN?: string;
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
    producerRole: string;
    producerModel: string;
    attemptNo: number;
    review: QualityReview;
  }
): Promise<void> {
  await db.batch([
    db.prepare(
      `INSERT INTO QUALITY_REVIEWS
       (id,job_id,run_id,reviewer_role,producer_model,reviewer_model,attempt_no,decision,score,reasons_json,revision_instructions,deterministic_issues_json)
       VALUES (?,?,?,'QA Supervisor',?,?,?,?,?,?,?,?)`
    ).bind(
      crypto.randomUUID(),input.jobId,input.runId,input.producerModel,input.review.reviewerModel,input.attemptNo,
      input.review.decision,input.review.score,JSON.stringify(input.review.reasons),input.review.revisionInstructions,
      JSON.stringify(input.review.deterministicIssues)
    ),
    db.prepare(
      `INSERT INTO ARTIFACTS(id,job_id,kind,name,metadata_json) VALUES (?,?,'qa-raw',?,?)`
    ).bind(
      crypto.randomUUID(),input.jobId,`QA raw response attempt ${input.attemptNo}`,
      JSON.stringify({ reviewerModel:input.review.reviewerModel,attempt:input.attemptNo,parseMode:input.review.parseMode,rawReviewText:input.review.rawReviewText })
    )
  ]);
  await recordQualityLearning(db,{jobId:input.jobId,runId:input.runId,producerRole:input.producerRole,attemptNo:input.attemptNo,review:input.review});
}

async function notifyBestEffort(env: Env, text: string, notificationKey?: string, cooldownMinutes = 0): Promise<void> {
  try {
    if (notificationKey && cooldownMinutes > 0) {
      const row = await env.DB.prepare(`SELECT last_sent_at,suppressed_count FROM NOTIFICATION_STATE WHERE notification_key=?`).bind(notificationKey).first<{last_sent_at:string|null;suppressed_count:number}>();
      const last = row?.last_sent_at ? Date.parse(row.last_sent_at.replace(" ","T")+"Z") : 0;
      if (last && Date.now()-last < cooldownMinutes*60_000) {
        await env.DB.prepare(`INSERT INTO NOTIFICATION_STATE(notification_key,suppressed_count,updated_at) VALUES (?,1,CURRENT_TIMESTAMP) ON CONFLICT(notification_key) DO UPDATE SET suppressed_count=suppressed_count+1,updated_at=CURRENT_TIMESTAMP`).bind(notificationKey).run();
        return;
      }
    }
    await sendTelegram(env, text);
    if (notificationKey) await env.DB.prepare(`INSERT INTO NOTIFICATION_STATE(notification_key,last_sent_at,suppressed_count,updated_at) VALUES (?,CURRENT_TIMESTAMP,0,CURRENT_TIMESTAMP) ON CONFLICT(notification_key) DO UPDATE SET last_sent_at=CURRENT_TIMESTAMP,suppressed_count=0,updated_at=CURRENT_TIMESTAMP`).bind(notificationKey).run();
  } catch { /* notification cannot alter job truth */ }
}

async function wakeGovernor(env: Env, source: string): Promise<void> {
  // Queue-free economy mode: never spend a Cloudflare Queue operation merely to
  // wake the governor. The minute cron is the durable scheduler. Persisting the
  // hint keeps the reason observable without creating write/read/delete queue traffic.
  try {
    await env.DB.prepare(
      `INSERT INTO PROJECT_STATE(key,value,updated_at)
       VALUES ('governor_wake_hint',?,CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`
    ).bind(source).run();
  } catch {
    // A wake hint cannot alter job truth; cron remains the durable fallback.
  }
}

async function touchJob(db: D1Database, jobId: string, runId: string, eventType: string, message: string): Promise<void> {
  await db.batch([
    db.prepare(`UPDATE WORK_QUEUE SET updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(jobId),
    db.prepare(`INSERT INTO RUN_EVENTS(run_id,event_type,message) VALUES (?,?,?)`).bind(runId,eventType,message)
  ]);
}


async function parsePatchWithAutoRepair(
  env: Env,
  step: WorkflowStep,
  input: {
    raw: string;
    sourceMap: Map<string,string>;
    maxFiles: number;
    jobId: string;
    runId: string;
    label: string;
    patchContract: string;
    evidence: string;
    preferredModels?: string[];
  }
): Promise<{ proposal: AppliedPatch; normalizedRaw: string; repairModel?: string }> {
  try {
    return { proposal: parseAndApplyPatchProposal(input.raw,input.sourceMap,input.maxFiles), normalizedRaw: input.raw };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== "code_patch_json_parse_failed") throw error;
  }

  await step.do(`product patch json repair started ${input.label}`, async () =>
    touchJob(env.DB,input.jobId,input.runId,"product_patch_json_repair_started","Kod patch JSON formatı otomatik onarılıyor"));

  const repaired = await step.do(`product patch json repair ${input.label}`, {retries:{limit:1,delay:"5 seconds",backoff:"exponential"}}, async () => runFactoryAI(env,{
    system:`You are a strict JSON repair agent. Return JSON only. Do not invent paths or code. Preserve the intended edits. ${input.patchContract}`,
    prompt:`MALFORMED PATCH OUTPUT:
${input.raw}

AUTHORITATIVE LIVE SOURCE FILES:
${input.evidence}

Repair only the serialization/contract shape. Return one complete valid patch JSON object.`,
    maxTokens:1350,temperature:0,purpose:"coder",preferredModels:input.preferredModels,onHeartbeat:() => providerHeartbeat(env.DB,input.jobId)
  }));
  const proposal = parseAndApplyPatchProposal(repaired.content,input.sourceMap,input.maxFiles);
  await step.do(`product patch json repair completed ${input.label}`, async () =>
    touchJob(env.DB,input.jobId,input.runId,"product_patch_json_repair_completed",`Kod patch JSON formatı düzeltildi (${repaired.model})`));
  return {proposal,normalizedRaw:repaired.content,repairModel:repaired.model};
}

async function providerHeartbeat(db: D1Database, jobId: string): Promise<void> {
  await db.prepare(`UPDATE WORK_QUEUE SET updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='running'`).bind(jobId).run();
}

export class FactoryWorkflow extends WorkflowEntrypoint<Env, FactoryJobParams> {
  async run(event: WorkflowEvent<FactoryJobParams>, step: WorkflowStep) {
    const jobId = event.payload.jobId;
    // Workflows may hibernate/restart; non-deterministic state must be persisted by a step.
    const runId = await step.do("allocate run id", async () => crypto.randomUUID());

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
        const ai = await step.do("nvidia smoke", async () => runFactoryAI(this.env,{ prompt,system:String(payload.system ?? "Be concise."),maxTokens:500 }));
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

      if (job.job_type === "github.project-pr") {
        const payload = safeJson(job.payload_json) as Record<string, unknown>;
        const repoAlias = String(payload.repoAlias ?? "product");
        const repoRow = await step.do("load github repo config", async () => this.env.DB.prepare(
          `SELECT alias,repo_full_name,default_branch,write_mode,enabled FROM PROJECT_REPOS WHERE alias=?`
        ).bind(repoAlias).first<{ alias:string; repo_full_name:string; default_branch:string|null; write_mode:string; enabled:number }>());
        if (!repoRow || !repoRow.enabled) throw new Error(`github_repo_alias_unavailable:${repoAlias}`);
        if (repoRow.write_mode !== "pr-only") throw new Error(`github_write_mode_not_pr_only:${repoAlias}`);

        const title = String(payload.title ?? "Factory project change");
        const summary = String(payload.summary ?? "Autonomous factory project change prepared for human review.");
        const rawChanges = Array.isArray(payload.changes) ? payload.changes : [];
        const changes = rawChanges.map((x: any) => ({ path:String(x?.path ?? ""), content:String(x?.content ?? "") }));
        if (changes.length === 0) throw new Error("github_project_pr_changes_required");

        await step.do("github writer heartbeat", async () => touchJob(this.env.DB,jobId,runId,"github_write_started",`GitHub draft PR started for ${repoRow.repo_full_name}`));
        const pr = await step.do("github create draft pr", { retries:{ limit:1,delay:"8 seconds",backoff:"exponential" } }, async () =>
          createProjectDraftPr(this.env,{
            repo:repoRow.repo_full_name,jobId,title,summary,baseBranch:repoRow.default_branch ?? undefined,changes
          })
        );
        const result = { ok:true,kind:"github.project-pr",repoAlias,...pr };
        const resultJson = JSON.stringify(result);
        await step.do("persist github draft pr", async () => {
          await this.env.DB.batch([
            this.env.DB.prepare(`UPDATE WORK_QUEUE SET status='completed',result_json=?,error_text=NULL,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(resultJson,jobId),
            this.env.DB.prepare(`UPDATE RUNS SET status='completed',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(resultJson,runId),
            this.env.DB.prepare(`INSERT INTO ARTIFACTS(id,job_id,kind,name,uri,metadata_json) VALUES (?,?,'github-pr',?,?,?)`).bind(crypto.randomUUID(),jobId,`Draft PR #${pr.prNumber}`,pr.prUrl,JSON.stringify(pr)),
            this.env.DB.prepare(`INSERT INTO GITHUB_OPERATIONS(id,job_id,repo_full_name,operation,branch_name,pr_number,status,data_json) VALUES (?,?,?,'CREATE_DRAFT_PR',?,?,'completed',?)`).bind(crypto.randomUUID(),jobId,pr.repo,pr.branch,pr.prNumber,JSON.stringify(pr)),
            this.env.DB.prepare(`INSERT INTO RUN_EVENTS(run_id,event_type,message,data_json) VALUES (?,'github_pr_created',?,?)`).bind(runId,`Draft PR #${pr.prNumber} created`,JSON.stringify(pr))
          ]);
        });
        await notifyBestEffort(this.env,`🟣 Zihin Factory GitHub draft PR hazır\n${pr.repo} #${pr.prNumber}\n${pr.prUrl}`);
        await wakeGovernor(this.env,"github-pr-completed");
        return { jobId,runId,result };
      }

      if (job.job_type === "assessment.tr8-paragraph-benchmark") {
        const payload = safeJson(job.payload_json) as Record<string, unknown>;
        const sampleSize = Math.max(1,Math.min(20,Number(payload.sampleSize ?? 2)));
        const maxAttempts = Math.max(1,Math.min(2,Number(payload.maxAttempts ?? 2)));
        const batchId = String(payload.batchId ?? `tr8-${jobId.slice(0,8)}`).replace(/[^a-zA-Z0-9_-]/g,"-").slice(0,80);
        const themes = Array.isArray(payload.themes) ? payload.themes.map(String).filter(Boolean).slice(0,20) : [];
        const morphologyNotes = Array.isArray(payload.morphologyNotes) ? payload.morphologyNotes.map(String).filter(Boolean).slice(0,12) : [];
        const benchmarkExcerpts = Array.isArray(payload.benchmarkExcerpts) ? payload.benchmarkExcerpts.map(String).filter(Boolean).slice(0,8) : [];

        await step.do("tr8 benchmark started", async () => {
          await touchJob(this.env.DB,jobId,runId,"tr8_benchmark_started",`8. sınıf Türkçe smoke/benchmark başladı: ${sampleSize} soru`);
        });
        const benchmark = await runTr8Benchmark({
          sampleSize,
          maxAttempts,
          batchId,
          themes,
          morphologyNotes,
          benchmarkExcerpts,
          produce: async ({itemIndex,attempt,system,prompt}: {itemIndex:number;attempt:number;system:string;prompt:string}) => {
            const produced = await step.do(`tr8 producer ${itemIndex + 1}.${attempt}`, {retries:{limit:1,delay:"7 seconds",backoff:"exponential"}}, async () => {
              const ai = await runFactoryAI(this.env,{
                system,prompt,maxTokens:1200,temperature:0.18,purpose:"producer",
                preferredModels:[
                  "meta/llama-3.3-70b-instruct",
                  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
                  "meta/llama-3.1-70b-instruct",
                  "qwen/qwen2.5-72b-instruct",
                  "mistralai/mistral-small-3.1-24b-instruct-2503"
                ],
                allowedModels:[
                  "meta/llama-3.3-70b-instruct",
                  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
                  "meta/llama-3.1-70b-instruct",
                  "qwen/qwen2.5-72b-instruct",
                  "mistralai/mistral-small-3.1-24b-instruct-2503"
                ],
                initialResponseTimeoutMs:45_000,
                streamIdleTimeoutMs:45_000,
                streamTotalTimeoutMs:150_000,
                onHeartbeat:() => providerHeartbeat(this.env.DB,jobId)
              });
              return {model:ai.model,content:ai.content};
            });
            if (!produced || typeof produced !== "object" || !("model" in produced) || !("content" in produced)) {
              throw new Error("tr8_producer_result_not_serializable");
            }
            return {model:String(produced.model),content:String(produced.content)};
          },
          review: async ({itemIndex,attempt,stage,producerModel,blindReviewerModel,system,prompt}: {itemIndex:number;attempt:number;stage:"blind-resolution"|"quality-audit";producerModel:string;blindReviewerModel?:string;system:string;prompt:string}) => {
            const reviewed = await step.do(`tr8 ${stage} ${itemIndex + 1}.${attempt}`, {retries:{limit:1,delay:"7 seconds",backoff:"exponential"}}, async () => {
              const ai = await runFactoryAI(this.env,{
                system,
                prompt,maxTokens:900,temperature:0,purpose:"reviewer",
                avoidModels:[producerModel,...(blindReviewerModel ? [blindReviewerModel] : [])],
                initialResponseTimeoutMs:45_000,
                streamIdleTimeoutMs:45_000,
                streamTotalTimeoutMs:120_000,
                onHeartbeat:() => providerHeartbeat(this.env.DB,jobId)
              });
              return {model:ai.model,content:ai.content};
            });
            if (!reviewed || typeof reviewed !== "object" || !("model" in reviewed) || !("content" in reviewed)) {
              throw new Error("tr8_reviewer_result_not_serializable");
            }
            return {model:String(reviewed.model),content:String(reviewed.content)};
          }
        });

        const instanceSummary = benchmark.instances.map((instance: any) => ({
          instanceId:instance?.instanceId ?? null,
          status:instance?.status ?? "UNKNOWN",
          attempt:instance?.attempt ?? null,
          producerModel:instance?.producerModel ?? null,
          blindReviewerModel:instance?.blindReviewerModel ?? null,
          reviewerModel:instance?.reviewerModel ?? null,
          automatedIssues:instance?.audit?.errors ?? [],
          engineeringDecision:instance?.engineeringReview?.decision ?? null,
          engineeringScore:instance?.engineeringReview?.score ?? null,
          blindResolutionLocked:instance?.engineeringReview?.blindResolutionLocked === true,
          independentlyResolved:instance?.engineeringReview?.independentlyResolved === true,
          blindAnswerKeyExposed:instance?.engineeringReview?.blindAnswerKeyExposed !== false,
          error:instance?.error ?? null
        }));
        const result = {
          ok:benchmark.status==="PENDING_HUMAN_REVIEW",
          kind:benchmark.kind,
          familyId:benchmark.familyId,
          batchId:benchmark.batchId,
          sampleSize:benchmark.sampleSize,
          status:benchmark.status,
          engineeringPassCount:benchmark.engineeringPassCount,
          engineeringPassRate:benchmark.engineeringPassRate,
          quarantinedCount:benchmark.quarantinedCount,
          automatedIssues:benchmark.automatedIssues,
          qualityEvidence:benchmark.qualityEvidence,
          humanReviewStatus:"NOT_MEASURED",
          pilotReady:false,
          instances:instanceSummary
        };
        const resultJson = JSON.stringify(result);
        await step.do("persist tr8 benchmark", async () => {
          const artifactStatements = benchmark.instances.map((instance: any,index: number) => this.env.DB.prepare(
            `INSERT INTO ARTIFACTS(id,job_id,kind,name,metadata_json) VALUES (?,?,'assessment-candidate',?,?)`
          ).bind(crypto.randomUUID(),jobId,`${batchId} item ${index + 1}`,JSON.stringify(instance)));
          await this.env.DB.batch([
            ...artifactStatements,
            this.env.DB.prepare(`UPDATE WORK_QUEUE SET status='completed',result_json=?,error_text=NULL,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(resultJson,jobId),
            this.env.DB.prepare(`UPDATE RUNS SET status='completed',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(resultJson,runId),
            this.env.DB.prepare(`INSERT INTO RUN_EVENTS(run_id,event_type,message,data_json) VALUES (?,'tr8_benchmark_completed',?,?)`).bind(runId,`8. sınıf Türkçe benchmark: ${benchmark.engineeringPassCount}/${benchmark.sampleSize} engineering PASS`,JSON.stringify(result))
          ]);
        });
        await wakeGovernor(this.env,"tr8-benchmark-completed");
        return {jobId,runId,result};
      }

      if (job.job_type === "product.code-patch") {
        const payload = safeJson(job.payload_json) as AutonomousPayload & Record<string, unknown>;
        const objective = String(payload.objective ?? "Prepare the smallest safe production patch from live repository evidence.");
        const acceptanceCriteria = Array.isArray(payload.acceptanceCriteria) ? payload.acceptanceCriteria.map(String) : [];
        const repoAlias = String(payload.repoAlias ?? "product");
        const focus = String(payload.focus ?? objective);
        const impactArea = String(payload.impactArea ?? "Zihin Arenası");
        const maxFiles = Math.max(1,Math.min(2,Number(payload.maxFiles ?? 2)));
        const roadmapId = typeof payload.roadmapId === "string" ? payload.roadmapId : null;
        const roadmapTitle = String(payload.roadmapTitle ?? "Product code patch");

        const repoRow = await step.do("product patch repo config", async () => this.env.DB.prepare(
          `SELECT alias,repo_full_name,default_branch,write_mode,enabled FROM PROJECT_REPOS WHERE alias=?`
        ).bind(repoAlias).first<{alias:string;repo_full_name:string;default_branch:string|null;write_mode:string;enabled:number}>());
        if (!repoRow || !repoRow.enabled) throw new Error(`product_repo_alias_unavailable:${repoAlias}`);
        if (repoRow.write_mode !== "pr-only") throw new Error("product_repo_must_be_pr_only");

        await step.do("product patch discovery started", async () => touchJob(this.env.DB,jobId,runId,"product_patch_discovery_started",`Reading live repo evidence from ${repoRow.repo_full_name}`));
        const repoInfo = await step.do("product patch repo info", async () => getRepo(this.env,repoRow.repo_full_name));
        const base = repoRow.default_branch || repoInfo.default_branch;
        const tree = await step.do("product patch repo tree", async () => getRepoTree(this.env,repoRow.repo_full_name,base));
        const packageManifest = await step.do("product patch package manifest", async () => {
          try { return (await getTextFile(this.env,repoRow.repo_full_name,"package.json",base,80_000))?.content ?? null; }
          catch { return null; }
        });
        const candidates = candidateRepoPaths(tree,focus,140);
        if (candidates.length === 0) throw new Error("product_patch_no_candidate_paths");

        const selector = await step.do("product patch path selector", {retries:{limit:1,delay:"5 seconds",backoff:"exponential"}}, async () => runFactoryAI(this.env,{
          system:"You are a repository path selector. Return strict JSON only. Never invent paths. Select existing files most likely to contain the requested implementation/test surface.",
          prompt:`FOCUS:\n${focus}\n\nLIVE REPOSITORY PATH CANDIDATES:\n${candidates.map((x,i)=>`${i+1}. ${x}`).join("\n")}\n\nReturn exactly one JSON object: {"paths":["existing/path.ts", "existing/test.spec.ts"]}. Choose 4-8 paths.`,
          maxTokens:340,temperature:0,purpose:"coder",onHeartbeat:() => providerHeartbeat(this.env.DB,jobId)
        }));
        const allowedCandidates = new Set(candidates);
        let selected = parsePathSelection(selector.content,allowedCandidates,8);
        if (selected.length < 2) selected = candidates.slice(0,Math.min(8,candidates.length));

        const sources = await step.do("product patch read selected files", async () => {
          const out: Array<{path:string;content:string}> = [];
          let total = 0;
          for (const path of selected) {
            try {
              const file = await getTextFile(this.env,repoRow.repo_full_name,path,base,24_000);
              if (!file) continue;
              if (total + file.content.length > 70_000) break;
              total += file.content.length;
              out.push({path:file.path,content:file.content});
            } catch { /* oversized/non-text candidate is skipped */ }
          }
          return out;
        });
        if (sources.length === 0) throw new Error("product_patch_no_readable_source_files");
        const sourceMap = new Map(sources.map(x=>[x.path,x.content]));
        const evidence = sources.map(x=>`FILE ${x.path}\n<<<SOURCE\n${x.content}\nSOURCE`).join("\n\n");

        const patchContract = `Return strict JSON only with this shape:\n{"summary":"what and why","verification":["exact repo command"],"changes":[{"path":"one of the supplied files","edits":[{"search":"exact unique existing snippet","replace":"complete replacement snippet"}]}]}\nRules: at most ${maxFiles} changed files; at most 4 exact edits per file; every search must be copied exactly from supplied source and must uniquely match; do not return full files; no markdown; no invented path; preserve existing language/framework; no placeholders; smallest safe patch.`;
        const coderLessons = await step.do("load coder learning memory", async () => learnedPromptForRole(this.env.DB,"Codex Engineer"));
        const coderSystem = `You are the Codex Engineer inside Zihin Factory. Work only from live repository source supplied in this prompt. Never invent a file, API, type, import, test runner, or repository language. Preserve ECD+AIG architecture and game-as-adapter separation. Main branch is read-only; output is only a proposal until independent QA passes. ${patchContract}${coderLessons}`;

        let attempt = 1;
        await step.do("product patch producer started", async () => touchJob(this.env.DB,jobId,runId,"product_patch_producer_started","Codex Engineer patch attempt 1 started"));
        let producer = await step.do("product patch producer 1", {retries:{limit:1,delay:"7 seconds",backoff:"exponential"}}, async () => runFactoryAI(this.env,{
          system:coderSystem,
          prompt:`OBJECTIVE:\n${objective}\n\nACCEPTANCE CRITERIA:\n${acceptanceCriteria.map((x,i)=>`${i+1}. ${x}`).join("\n")}\n\nFOCUS:\n${focus}\n\nLIVE SOURCE FILES:\n${evidence}\n\nProduce the smallest concrete patch now.`,
          maxTokens:1200,temperature:0.05,purpose:"coder",onHeartbeat:() => providerHeartbeat(this.env.DB,jobId)
        }));
        let parsedPatch = await parsePatchWithAutoRepair(this.env,step,{raw:producer.content,sourceMap,maxFiles,jobId,runId,label:"1",patchContract,evidence,preferredModels:[producer.model]});
        let proposal = parsedPatch.proposal;
        let preflightIssues = [
          ...productPatchDeterministicIssues({objective,acceptanceCriteria,proposal}),
          ...verificationManifestIssues(proposal.verification,packageManifest).issues
        ];
        let reviewArtifact = patchReviewArtifact(proposal);
        await step.do("product patch proposal persisted 1", async () => this.env.DB.prepare(
          `INSERT INTO ARTIFACTS(id,job_id,kind,name,metadata_json) VALUES (?,?,'code-patch-proposal','Product code patch attempt 1',?)`
        ).bind(crypto.randomUUID(),jobId,JSON.stringify({model:producer.model,repairModel:parsedPatch.repairModel??null,attempt,summary:proposal.summary,files:proposal.changes.map(x=>({path:x.path,editCount:x.editCount})),verification:proposal.verification,rawProposal:producer.content.slice(0,9000),normalizedProposal:parsedPatch.normalizedRaw.slice(0,9000)})).run());

        await step.do("product patch qa started 1", async () => touchJob(this.env.DB,jobId,runId,"product_patch_qa_started","Independent code patch QA attempt 1 started"));
        let review = preflightIssues.length > 0
          ? deterministicProductReview(preflightIssues)
          : await step.do("product patch qa 1", {retries:{limit:1,delay:"6 seconds",backoff:"exponential"}}, async () => reviewOutput(this.env,{
              objective,acceptanceCriteria,producerRole:"Codex Engineer",producerModel:producer.model,output:reviewArtifact,attempt,onHeartbeat:() => providerHeartbeat(this.env.DB,jobId)
            }));
        review = applyProductDeterministicIssues(review,preflightIssues) as QualityReview;
        await step.do("product patch record qa 1", async () => recordQuality(this.env.DB,{jobId,runId,producerRole:"Codex Engineer",producerModel:producer.model,attemptNo:attempt,review}));
        await step.do("product patch qa completed 1", async () => touchJob(this.env.DB,jobId,runId,"product_patch_qa_completed",`Independent code patch QA: ${review.decision} ${review.score}/100`));

        if (review.decision === "RETRY") {
          attempt = 2;
          await step.do("product patch revision started", async () => touchJob(this.env.DB,jobId,runId,"product_patch_revision_started","Codex Engineer patch revision 2 started"));
          producer = await step.do("product patch producer 2", {retries:{limit:1,delay:"7 seconds",backoff:"exponential"}}, async () => runFactoryAI(this.env,{
            system:coderSystem,
            prompt:`OBJECTIVE:\n${objective}\n\nACCEPTANCE CRITERIA:\n${acceptanceCriteria.map((x,i)=>`${i+1}. ${x}`).join("\n")}\n\nQA REVISION INSTRUCTIONS:\n${review.revisionInstructions || review.reasons.join("; ")}\n\nPREVIOUS PATCH JSON:\n${producer.content}\n\nLIVE SOURCE FILES (authoritative):\n${evidence}\n\nReturn a complete corrected patch JSON.`,
            maxTokens:1200,temperature:0.03,purpose:"coder",preferredModels:[producer.model],onHeartbeat:() => providerHeartbeat(this.env.DB,jobId)
          }));
          parsedPatch = await parsePatchWithAutoRepair(this.env,step,{raw:producer.content,sourceMap,maxFiles,jobId,runId,label:"2",patchContract,evidence,preferredModels:[producer.model]});
          proposal = parsedPatch.proposal;
          preflightIssues = [
            ...productPatchDeterministicIssues({objective,acceptanceCriteria,proposal}),
            ...verificationManifestIssues(proposal.verification,packageManifest).issues
          ];
          reviewArtifact = patchReviewArtifact(proposal);
          await step.do("product patch proposal persisted 2", async () => this.env.DB.prepare(
            `INSERT INTO ARTIFACTS(id,job_id,kind,name,metadata_json) VALUES (?,?,'code-patch-proposal','Product code patch attempt 2',?)`
          ).bind(crypto.randomUUID(),jobId,JSON.stringify({model:producer.model,repairModel:parsedPatch.repairModel??null,attempt,summary:proposal.summary,files:proposal.changes.map(x=>({path:x.path,editCount:x.editCount})),verification:proposal.verification,rawProposal:producer.content.slice(0,9000),normalizedProposal:parsedPatch.normalizedRaw.slice(0,9000)})).run());
          review = preflightIssues.length > 0
            ? deterministicProductReview(preflightIssues)
            : await step.do("product patch qa 2", {retries:{limit:1,delay:"6 seconds",backoff:"exponential"}}, async () => reviewOutput(this.env,{
                objective,acceptanceCriteria,producerRole:"Codex Engineer",producerModel:producer.model,output:reviewArtifact,attempt,onHeartbeat:() => providerHeartbeat(this.env.DB,jobId)
              }));
          review = applyProductDeterministicIssues(review,preflightIssues) as QualityReview;
          await step.do("product patch record qa 2", async () => recordQuality(this.env.DB,{jobId,runId,producerRole:"Codex Engineer",producerModel:producer.model,attemptNo:attempt,review}));
          await step.do("product patch qa completed 2", async () => touchJob(this.env.DB,jobId,runId,"product_patch_qa_completed",`Independent code patch QA revision: ${review.decision} ${review.score}/100`));
        }

        if (review.decision === "PASS") {
          await step.do("product patch github heartbeat", async () => touchJob(this.env.DB,jobId,runId,"product_patch_github_started",`AI QA PASS; deterministic preflight PASS; creating Draft PR in ${repoRow.repo_full_name}; real CI still required`));
          const pr = await step.do("product patch create draft pr", {retries:{limit:1,delay:"8 seconds",backoff:"exponential"}}, async () => createProjectDraftPr(this.env,{
            repo:repoRow.repo_full_name,jobId,title:roadmapTitle,summary:`${proposal.summary}\n\nVerification:\n${proposal.verification.map(x=>`- ${x}`).join("\n")}\n\nIndependent QA: ${review.score}/100.`,baseBranch:base,
            changes:proposal.changes.map(x=>({path:x.path,content:x.content}))
          }));
          const ci = await step.do("product patch initial ci observation", {retries:{limit:1,delay:"4 seconds",backoff:"exponential"}}, async () => getPullRequestCiState(this.env,pr.repo,pr.prNumber));
          const productStatus = ci.state === "success" ? "waiting-human" : "waiting-ci";
          const result = {ok:ci.state === "success",kind:"product.code-patch",phase:productStatus,roadmapId,impactArea,qa:review,ci,summary:proposal.summary,verification:proposal.verification,files:proposal.changes.map(x=>x.path),...pr};
          const resultJson = JSON.stringify(result);
          await step.do("product patch persist pr", async () => {
            const impactId = crypto.randomUUID();
            const statements = [
              this.env.DB.prepare(`UPDATE WORK_QUEUE SET status='completed',result_json=?,error_text=NULL,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(resultJson,jobId),
              this.env.DB.prepare(`UPDATE RUNS SET status='completed',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(resultJson,runId),
              this.env.DB.prepare(`INSERT INTO GITHUB_OPERATIONS(id,job_id,repo_full_name,operation,branch_name,pr_number,status,data_json) VALUES (?,?,?,'CREATE_PRODUCT_DRAFT_PR',?,?,?,?)`).bind(crypto.randomUUID(),jobId,pr.repo,pr.branch,pr.prNumber,productStatus,JSON.stringify({...pr,ci})),
              this.env.DB.prepare(`INSERT INTO PROJECT_IMPACT(id,roadmap_id,job_id,impact_area,repo_full_name,branch_name,pr_number,pr_url,status,summary,files_json,qa_score) VALUES (?,?,?,?,?,?,?,?, ?,?,?,?)`).bind(impactId,roadmapId,jobId,impactArea,pr.repo,pr.branch,pr.prNumber,pr.prUrl,productStatus,proposal.summary,JSON.stringify(proposal.changes.map(x=>x.path)),review.score),
              this.env.DB.prepare(`INSERT INTO RUN_EVENTS(run_id,event_type,message,data_json) VALUES (?,'product_draft_pr_created',?,?)`).bind(runId,`Product Draft PR #${pr.prNumber} created; ${productStatus === 'waiting-human' ? 'real CI passed, waiting human merge' : 'AI QA passed, real CI pending'}`,JSON.stringify({...pr,ci}))
            ];
            if (roadmapId) statements.push(this.env.DB.prepare(`UPDATE FACTORY_ROADMAP SET status=?,result_summary=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(productStatus,`${productStatus === 'waiting-human' ? 'Real CI passed; human merge approval waiting' : 'AI QA passed; real GitHub CI waiting'} for Draft PR #${pr.prNumber}: ${proposal.summary}`.slice(0,1000),roadmapId));
            await this.env.DB.batch(statements);
          });
          await notifyBestEffort(this.env,ci.state === "success"
            ? `🟢 Zihin Factory gerçek CI geçti; insan merge onayı bekleniyor\n${impactArea}\nAI QA: ${review.score}/100\n${pr.prUrl}`
            : `🟡 Zihin Factory Draft PR oluşturuldu; gerçek CI doğrulaması bekleniyor\n${impactArea}\nAI QA: ${review.score}/100 (final başarı değildir)\n${pr.prUrl}`);
          await wakeGovernor(this.env,productStatus === "waiting-human" ? "product-pr-waiting-human" : "product-pr-waiting-ci");
          return {jobId,runId,result};
        }

        const finalDecision = review.decision === "BLOCKED" ? "blocked" : "quarantine";
        const finalReview = review.decision === "RETRY" ? {...review,decision:"QUARANTINE" as const,reasons:[...review.reasons,"product_patch_revision_budget_exhausted"]} : review;
        const result = {ok:false,kind:"product.code-patch",roadmapId,impactArea,qa:finalReview,summary:proposal.summary,verification:proposal.verification,files:proposal.changes.map(x=>x.path)};
        const resultJson = JSON.stringify(result);
        await step.do("product patch fail closed", async () => {
          const statements = [
            this.env.DB.prepare(`UPDATE WORK_QUEUE SET status=?,result_json=?,error_text=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(finalDecision,resultJson,finalReview.reasons.join("; ").slice(0,3000),jobId),
            this.env.DB.prepare(`UPDATE RUNS SET status=?,result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(finalDecision,resultJson,runId),
            this.env.DB.prepare(`INSERT INTO PROJECT_IMPACT(id,roadmap_id,job_id,impact_area,repo_full_name,status,summary,files_json,qa_score) VALUES (?,?,?,?,?,?,?, ?,?)`).bind(crypto.randomUUID(),roadmapId,jobId,impactArea,repoRow.repo_full_name,finalDecision,`Patch not written: ${finalReview.reasons.join("; ")}`.slice(0,1000),JSON.stringify(proposal.changes.map(x=>x.path)),finalReview.score)
          ];
          if (roadmapId) statements.push(this.env.DB.prepare(`UPDATE FACTORY_ROADMAP SET status=?,result_summary=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(finalDecision,finalReview.reasons.join("; ").slice(0,1000),roadmapId));
          await this.env.DB.batch(statements);
        });
        await notifyBestEffort(this.env,`🟠 Zihin Factory kalite kapısı ürüne yazmayı durdurdu
Görev: ${roadmapTitle}
Kalite: ${finalReview.score}/100 • Karar: ${finalReview.decision}
Ne oldu: Bağımsız kalite kapısı patch'i yayınlanacak kadar güvenli/güçlü bulmadı.
Fabrika ne yapıyor: Patch GitHub'a uygulanmadı; bağımsız diğer hatlar çalışmaya devam ediyor.
Sizin yapacağınız: Hiçbir şey. Dashboard açıkça güvenli yeniden deneme önermedikçe Retry kullanmayın.`,`quality-quarantine:Codex Engineer:${defectCode(finalReview.reasons[0] ?? "quality")}`,60);
        await wakeGovernor(this.env,"product-patch-fail-closed");
        return {jobId,runId,result};
      }

      const payload = safeJson(job.payload_json) as AutonomousPayload & Record<string, unknown>;
      let runtimeContext: unknown = payload.context ?? {};
      let reconRepoFullName: string | null = null;
      if (job.job_type === "product.repo-recon") {
        const repoAlias = String(payload.repoAlias ?? "product");
        const focus = String(payload.focus ?? payload.objective ?? "Zihin Arenası repository architecture");
        const repoRow = await step.do("recon repo config", async () => this.env.DB.prepare(
          `SELECT repo_full_name,default_branch,enabled FROM PROJECT_REPOS WHERE alias=?`
        ).bind(repoAlias).first<{repo_full_name:string;default_branch:string|null;enabled:number}>());
        if (!repoRow || !repoRow.enabled) throw new Error(`recon_repo_alias_unavailable:${repoAlias}`);
        const repoInfo = await step.do("recon repo info", async () => getRepo(this.env,repoRow.repo_full_name));
        const base = repoRow.default_branch || repoInfo.default_branch;
        reconRepoFullName = repoRow.repo_full_name;
        const tree = await step.do("recon repo tree", async () => getRepoTree(this.env,repoRow.repo_full_name,base));
        const relevantPaths = candidateRepoPaths(tree,focus,160);
        const anchorFiles = await step.do("recon anchor files", async () => {
          const out: Record<string,string> = {};
          for (const path of ["PROJECT_STATE.json","package.json","CONTINUE_CONTEXT.txt"]) {
            try { const f = await getTextFile(this.env,repoRow.repo_full_name,path,base,28_000); if (f) out[path]=f.content; } catch { /* optional anchor */ }
          }
          return out;
        });
        runtimeContext = {repo:repoRow.repo_full_name,defaultBranch:base,private:repoInfo.private,focus,relevantLivePaths:relevantPaths,anchorFiles};
        await step.do("recon evidence ready", async () => touchJob(this.env.DB,jobId,runId,"repo_recon_evidence_ready",`Live repo evidence loaded: ${relevantPaths.length} candidate paths`));
      }
      const objective = String(payload.objective ?? "Complete the assigned factory task with implementation-ready detail.");
      const acceptanceCriteria = Array.isArray(payload.acceptanceCriteria)
        ? payload.acceptanceCriteria.map(String)
        : [];
      const routed = routeAgent(job.job_type,payload);
      const roleLessons = await step.do("load role learning memory", async () => learnedPromptForRole(this.env.DB,routed.role));
      const learnedSystemPrompt = `${routed.systemPrompt}${roleLessons}`;
      const maxRevisionAttempts = Math.max(0,Math.min(2,Number(payload.maxRevisionAttempts ?? 2)));

      let attempt = 1;
      await step.do("producer heartbeat 1", async () => touchJob(this.env.DB,jobId,runId,"producer_started","Producer attempt 1 started"));
      let producer = await step.do(
        "producer attempt 1",
        { retries:{ limit:1,delay:"8 seconds",backoff:"exponential" } },
        async () => runFactoryAI(this.env,{
          system:learnedSystemPrompt,
          prompt:`OBJECTIVE:\n${objective}\n\nACCEPTANCE CRITERIA:\n${acceptanceCriteria.map((x,i)=>`${i+1}. ${x}`).join("\n") || "1. Materially satisfy the objective."}\n\nCONTEXT:\n${JSON.stringify(runtimeContext,null,2)}\n\nProduce the artifact now.`,
          maxTokens:1050,
          temperature:0.15,
          purpose:routed.purpose,
          onHeartbeat:() => providerHeartbeat(this.env.DB,jobId)
        })
      );
      const initialProducerModel = producer.model;

      await step.do("producer completed heartbeat 1", async () => touchJob(this.env.DB,jobId,runId,"producer_completed","Producer attempt 1 completed"));
      await step.do("persist producer artifact 1", async () => {
        await this.env.DB.prepare(
          `INSERT INTO ARTIFACTS(id,job_id,kind,name,metadata_json) VALUES (?,?,'agent-output',?,?)`
        ).bind(
          crypto.randomUUID(),jobId,`${routed.role} output attempt 1`,
          JSON.stringify({ role:routed.role,model:producer.model,attempt,content:producer.content,usage:producer.usage })
        ).run();
      });

      await step.do("qa heartbeat 1", async () => touchJob(this.env.DB,jobId,runId,"qa_started","Independent QA attempt 1 started"));
      let review = await step.do("independent qa 1", { retries:{ limit:1,delay:"6 seconds",backoff:"exponential" } }, async () => reviewOutput(this.env,{
        objective,acceptanceCriteria,producerRole:routed.role,producerModel:producer.model,output:producer.content,attempt,
        onHeartbeat:() => providerHeartbeat(this.env.DB,jobId)
      }));
      await step.do("qa completed heartbeat 1", async () => touchJob(this.env.DB,jobId,runId,"qa_completed",`Independent QA attempt 1 completed: ${review.decision} ${review.score}/100`));
      await step.do("record quality 1", async () => recordQuality(this.env.DB,{ jobId,runId,producerRole:routed.role,producerModel:producer.model,attemptNo:attempt,review }));

      while (review.decision === "RETRY" && attempt <= maxRevisionAttempts) {
        attempt++;
        const previous = producer.content;
        const instructions = review.revisionInstructions || review.reasons.join("; ");

        await step.do(`producer heartbeat ${attempt}`, async () => touchJob(this.env.DB,jobId,runId,"producer_revision_started",`Producer revision ${attempt} started`));
        producer = await step.do(
          `producer revision ${attempt}`,
          { retries:{ limit:1,delay:"8 seconds",backoff:"exponential" } },
          async () => runFactoryAI(this.env,{
            system:learnedSystemPrompt,
            prompt:`Revise the artifact.\n\nOBJECTIVE:\n${objective}\n\nACCEPTANCE CRITERIA:\n${acceptanceCriteria.map((x,i)=>`${i+1}. ${x}`).join("\n")}\n\nQA REVISION INSTRUCTIONS:\n${instructions}\n\nPREVIOUS ARTIFACT:\n${previous}\n\nReturn the full corrected artifact, not a commentary about changes.`,
            maxTokens:1100,temperature:0.1,purpose:routed.purpose,
            preferredModels:[initialProducerModel,"meta/llama-3.3-70b-instruct","mistralai/mistral-small-3.1-24b-instruct-2503"],
            onHeartbeat:() => providerHeartbeat(this.env.DB,jobId)
          })
        );

        await step.do(`producer completed heartbeat ${attempt}`, async () => touchJob(this.env.DB,jobId,runId,"producer_revision_completed",`Producer revision ${attempt} completed`));
        await step.do(`persist producer artifact ${attempt}`, async () => {
          await this.env.DB.prepare(
            `INSERT INTO ARTIFACTS(id,job_id,kind,name,metadata_json) VALUES (?,?,'agent-output',?,?)`
          ).bind(
            crypto.randomUUID(),jobId,`${routed.role} output attempt ${attempt}`,
            JSON.stringify({ role:routed.role,model:producer.model,attempt,content:producer.content,usage:producer.usage })
          ).run();
        });

        await step.do(`qa heartbeat ${attempt}`, async () => touchJob(this.env.DB,jobId,runId,"qa_revision_started",`Independent QA attempt ${attempt} started`));
        review = await step.do(`independent qa ${attempt}`, { retries:{ limit:1,delay:"6 seconds",backoff:"exponential" } }, async () => reviewOutput(this.env,{
          objective,acceptanceCriteria,producerRole:routed.role,producerModel:producer.model,output:producer.content,attempt,
          onHeartbeat:() => providerHeartbeat(this.env.DB,jobId)
        }));
        await step.do(`qa completed heartbeat ${attempt}`, async () => touchJob(this.env.DB,jobId,runId,"qa_revision_completed",`Independent QA attempt ${attempt} completed: ${review.decision} ${review.score}/100`));
        await step.do(`record quality ${attempt}`, async () => recordQuality(this.env.DB,{ jobId,runId,producerRole:routed.role,producerModel:producer.model,attemptNo:attempt,review }));
      }

      if (review.decision === "RETRY" && review.score >= 75 && review.deterministicIssues.length === 0) {
        attempt++;
        const previous = producer.content;
        const instructions = review.revisionInstructions || review.reasons.join("; ");
        await step.do("supervisor escalation started", async () => touchJob(this.env.DB,jobId,runId,"supervisor_escalation_started",`Senior producer escalation attempt ${attempt} started`));
        producer = await step.do(
          "supervisor escalation producer",
          { retries:{ limit:1,delay:"8 seconds",backoff:"exponential" } },
          async () => runFactoryAI(this.env,{
            system:`${learnedSystemPrompt}\nSENIOR ESCALATION: Previous revisions were close but did not pass. Produce implementation-ready evidence for every acceptance criterion. Do not merely restate requirements.`,
            prompt:`OBJECTIVE:\n${objective}\n\nACCEPTANCE CRITERIA:\n${acceptanceCriteria.map((x,i)=>`${i+1}. ${x}`).join("\n")}\n\nFINAL QA INSTRUCTIONS:\n${instructions}\n\nPREVIOUS ARTIFACT:\n${previous}\n\nReturn one complete, concrete corrected artifact.`,
            maxTokens:1200,temperature:0.08,purpose:routed.purpose,
            preferredModels:[initialProducerModel,"meta/llama-3.3-70b-instruct","mistralai/mistral-small-3.1-24b-instruct-2503"],
            onHeartbeat:() => providerHeartbeat(this.env.DB,jobId)
          })
        );
        await step.do("supervisor escalation producer completed", async () => touchJob(this.env.DB,jobId,runId,"supervisor_escalation_producer_completed",`Senior producer escalation attempt ${attempt} completed`));
        await step.do("persist supervisor escalation artifact", async () => {
          await this.env.DB.prepare(`INSERT INTO ARTIFACTS(id,job_id,kind,name,metadata_json) VALUES (?,?,'agent-output',?,?)`).bind(
            crypto.randomUUID(),jobId,`${routed.role} senior escalation attempt ${attempt}`,JSON.stringify({role:routed.role,model:producer.model,attempt,content:producer.content,usage:producer.usage})
          ).run();
        });
        review = await step.do("supervisor escalation qa", { retries:{ limit:1,delay:"6 seconds",backoff:"exponential" } }, async () => reviewOutput(this.env,{
          objective,acceptanceCriteria,producerRole:routed.role,producerModel:producer.model,output:producer.content,attempt,
          onHeartbeat:() => providerHeartbeat(this.env.DB,jobId)
        }));
        await step.do("supervisor escalation qa completed", async () => touchJob(this.env.DB,jobId,runId,"supervisor_escalation_qa_completed",`Senior escalation QA completed: ${review.decision} ${review.score}/100`));
        await step.do("record supervisor escalation quality", async () => recordQuality(this.env.DB,{jobId,runId,producerRole:routed.role,producerModel:producer.model,attemptNo:attempt,review}));
      }

      if (review.decision === "RETRY") {
        review = { ...review,decision:"QUARANTINE",reasons:[...review.reasons,"revision_budget_exhausted_after_supervisor_escalation"] };
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
          if (job.job_type === "product.repo-recon") statements.push(
            this.env.DB.prepare(`INSERT INTO PROJECT_IMPACT(id,roadmap_id,job_id,impact_area,repo_full_name,status,summary,files_json,qa_score) VALUES (?,?,?,?,?,'completed',?,?,?)`).bind(
              crypto.randomUUID(),roadmapId,jobId,String(payload.impactArea ?? "Repo Keşfi"),reconRepoFullName ?? String(payload.repoAlias ?? "product"),producer.content.slice(0,1000),JSON.stringify([]),review.score
            )
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
        await notifyBestEffort(this.env,`🔴 Zihin Factory görev engellendi
Görev: ${String(payload.roadmapTitle ?? jobId)}
Ne oldu: ${review.reasons.slice(0,3).join("; ")}
Fabrika ne yapıyor: Görev fail-closed tutuluyor; riskli çıktı ürüne uygulanmıyor.
Sizin yapacağınız: Dashboard > Sorunlar / Çözümler bölümündeki öneriyi izleyin. Güvenli yeniden dene görünmüyorsa müdahale etmeyin.`);
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
        await notifyBestEffort(this.env,`🟠 Zihin Factory kalite karantinası
Görev: ${String(payload.roadmapTitle ?? jobId)}
Kalite: ${review.score}/100
Ne oldu: Revizyonlardan sonra bazı kabul kriterleri yeterince güçlü karşılanmadı.
Fabrika ne yapıyor: Çıktıyı yayınlamıyor ve bağımsız diğer görevlerle devam ediyor.
Sizin yapacağınız: Hiçbir şey. Rastgele Retry kullanmayın.`,`quality-quarantine:${routed.role}:${defectCode(review.reasons[0] ?? "quality")}`,60);
      }

      await wakeGovernor(this.env,`job-${review.decision.toLowerCase()}`);
      return { jobId,runId,result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedPayload = safeJson(job.payload_json) as AutonomousPayload & Record<string, unknown>;
      const failedRoadmapId = typeof failedPayload.roadmapId === "string" ? failedPayload.roadmapId : null;
      const transientProviderFailure = /NVIDIA|HTTP[_ ]?(?:429|5\d\d)|524|timeout|stream_idle|stream_total|provider exhausted/i.test(message);

      await step.do("mark job failed", async () => {
        const statements = [
          this.env.DB.prepare(`UPDATE WORK_QUEUE SET status='failed',error_text=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(message.slice(0,4000),jobId),
          this.env.DB.prepare(`UPDATE RUNS SET status='failed',error_text=?,completed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(message.slice(0,4000),runId),
          this.env.DB.prepare(`INSERT INTO RUN_EVENTS(run_id,event_type,message) VALUES (?,'workflow_failed',?)`).bind(runId,message.slice(0,4000)),
          this.env.DB.prepare(`INSERT INTO JOB_DECISIONS(job_id,decision_type,actor_role,data_json) VALUES (?,'EXECUTION_FAILED','Governor',?)`).bind(jobId,JSON.stringify({ error:message.slice(0,2000) }))
        ];
        if (failedRoadmapId && transientProviderFailure) {
          const retryNotBefore = new Date(Date.now() + 90_000).toISOString();
          statements.push(
            this.env.DB.prepare(`UPDATE FACTORY_ROADMAP SET status='ready',work_queue_id=NULL,result_summary=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND work_queue_id=?`).bind(`Transient NVIDIA failure; automatic retry scheduled: ${message.slice(0,700)}`,failedRoadmapId,jobId),
            this.env.DB.prepare(`INSERT INTO PROJECT_STATE(key,value,updated_at) VALUES ('provider_retry_not_before',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(retryNotBefore),
            this.env.DB.prepare(`INSERT INTO RUN_EVENTS(run_id,event_type,message) VALUES (?,'provider_retry_scheduled',?)`).bind(runId,`Automatic provider retry after ${retryNotBefore}`)
          );
        } else if (failedRoadmapId) {
          statements.push(
            this.env.DB.prepare(`UPDATE FACTORY_ROADMAP SET status='blocked',result_summary=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND work_queue_id=?`).bind(`Execution failure: ${message.slice(0,900)}`,failedRoadmapId,jobId),
            this.env.DB.prepare(`INSERT INTO BLOCKERS(id,scope,severity,status,summary,details) VALUES (?,'factory','high','open',?,?)`).bind(crypto.randomUUID(),String(failedPayload.roadmapTitle ?? "Autonomous execution failure"),message.slice(0,3000))
          );
        }
        await this.env.DB.batch(statements);
      });
      const operatorGuidance = guidanceForError(message,transientProviderFailure ? "retry-scheduled" : "blocked");
      await notifyBestEffort(this.env, `${guidanceTelegramText(operatorGuidance,message)}\nGörev: ${String(failedPayload.roadmapTitle ?? jobId)}`,`error:${operatorGuidance.code}`,operatorGuidance.code === "provider-temporary" ? 60 : 30);
      await wakeGovernor(this.env,"job-failed");
      throw error;
    }
  }
}
