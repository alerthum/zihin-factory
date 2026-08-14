import { validateBlindReviewEvidence, validateCompletedSmoke } from "./tr8-smoke-lib.mjs";

const JOB_TYPE = "assessment.tr8-paragraph-benchmark";
const THEMES = Object.freeze([
  "kent belleğinde farklı belge türleri",
  "sulak alan gözleminde değişim ve süreklilik",
  "kütüphane kullanımında veri ve yorum",
  "mahalle bahçesinde ortak kararlar",
  "müze sergisinde nesne ve bağlam",
  "okul radyosunda yayın kültürü",
  "bisiklet yollarında güvenlik gözlemleri",
  "sahil temizliğinde kayıt ve sonuç",
  "yerel pazarda üretici ve tüketici görüşleri",
  "bilim kulübünde deney günlükleri",
  "tiyatro çalışmasında prova ve değişim",
  "yerel gazetede haber ve okur ilişkisi",
  "orman yürüyüşünde rota ve canlı çeşitliliği",
  "robotik takımında tasarım ve hata kayıtları",
  "spor şenliğinde katılım ve dayanışma",
  "müzik arşivinde ezgi ve icra karşılaştırması",
  "mahalle atölyesinde onarım ve paylaşım",
  "gökyüzü gözleminde kayıt yöntemleri",
  "okul meclisinde öneri ve gerekçe",
  "gezici sergide anlatım ve ziyaretçi deneyimi"
]);

function required(value, field) {
  const output = String(value ?? "").trim();
  if (!output) throw new Error(`${field}:required`);
  return output;
}

async function responseJson(response, label) {
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error(`${label}:invalid-json:${response.status}`); }
  if (!response.ok) throw new Error(`${label}:http-${response.status}:${String(payload?.error ?? "unknown")}`);
  return payload;
}

function parseJson(value, field) {
  try { return JSON.parse(String(value ?? "{}")); }
  catch { throw new Error(`${field}:invalid-json`); }
}

export function validateCompletedCalibration(detail) {
  const result = parseJson(detail?.job?.result_json, "job.result_json");
  const errors = [];
  if (result.kind !== JOB_TYPE) errors.push("wrong-result-kind");
  if (result.ok !== true) errors.push("batch-result-not-ok");
  if (Number(result.sampleSize) !== 20) errors.push("sample-size-not-twenty");
  if (Number(result.engineeringPassCount) !== 20) errors.push("engineering-pass-not-twenty");
  if (result.status !== "PENDING_HUMAN_REVIEW") errors.push("wrong-result-status");
  if (result.pilotReady !== false) errors.push("calibration-must-not-be-pilot-ready");
  if (result.humanReviewStatus !== "NOT_MEASURED") errors.push("human-review-must-be-pending");
  if (!Array.isArray(result.automatedIssues) || result.automatedIssues.length) errors.push("automated-issues-present");
  try { validateBlindReviewEvidence(result, 20); }
  catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }

  const evidence = result.qualityEvidence ?? {};
  if (Number(evidence.sampleSize) !== 20) errors.push("evidence-sample-size");
  if (Number(evidence.duplicateRate) !== 0) errors.push("semantic-duplicate-rate");
  if (Number(evidence.structuralDuplicatePairCount) !== 0) errors.push("structural-template-duplicates");
  if (Number(evidence.distinctDiversityPlanCount) !== 20) errors.push("diversity-plan-count");
  if (Number(evidence.distinctDiscourseStructureCount) !== 5) errors.push("discourse-structure-count");
  if (Number(evidence.distinctReasoningPathCount) !== 4) errors.push("reasoning-path-count");
  if (Number(evidence.distinctGenreCount) !== 5) errors.push("genre-count");
  if (Number(evidence.maximumDiscourseStructureShare) > 0.3) errors.push("discourse-overconcentration");
  if (Number(evidence.maximumReasoningPathShare) > 0.3) errors.push("reasoning-overconcentration");
  if (Number(evidence.longestCorrectRate) > 35) errors.push("longest-answer-leakage");
  if (Number(evidence.uniqueAnswerRate) !== 100) errors.push("unique-answer-rate");
  if (Number(evidence.explanationEvidenceRate) !== 100) errors.push("explanation-evidence-rate");
  if (JSON.stringify(evidence.correctPositionCounts) !== JSON.stringify([5, 5, 5, 5])) errors.push("answer-position-balance");

  const canonicalQuestions = (detail?.artifacts ?? [])
    .filter((artifact) => artifact?.kind === "assessment-candidate")
    .map((artifact) => parseJson(artifact.metadata_json, `artifact:${artifact?.id ?? "unknown"}`)?.canonical)
    .filter(Boolean);
  if (canonicalQuestions.length !== 20) errors.push(`canonical-artifact-count:${canonicalQuestions.length}`);
  const questionIds = canonicalQuestions.map((question) => String(question.id ?? ""));
  if (new Set(questionIds).size !== canonicalQuestions.length) errors.push("duplicate-canonical-id");
  const planIds = canonicalQuestions.map((question) => String(question.styleProfile?.diversityPlanId ?? ""));
  if (planIds.some((id) => !id) || new Set(planIds).size !== 20) errors.push("canonical-diversity-plans");
  for (const question of canonicalQuestions) {
    if (question.schemaVersion !== "3.0") errors.push(`canonical-schema:${question.id ?? "unknown"}`);
    if (question.curriculum?.grade !== 8 || question.curriculum?.courseId !== "turkce") errors.push(`canonical-target:${question.id ?? "unknown"}`);
    if (!question.curriculum?.outcomeIds?.includes("tr.pre-tymm.g8.turkce.t-8-3-17")) errors.push(`canonical-outcome:${question.id ?? "unknown"}`);
    if (question.verifier?.verified !== true) errors.push(`canonical-verifier:${question.id ?? "unknown"}`);
    if (question.contentStatus !== "HUMAN_REVIEW_REQUIRED") errors.push(`canonical-status:${question.id ?? "unknown"}`);
    if (question.content?.humanReview?.gameAdaptationAllowed !== false) errors.push(`canonical-game-lock:${question.id ?? "unknown"}`);
  }
  if (errors.length) throw new Error(`tr8-calibration-failed:${[...new Set(errors)].join(",")}`);
  return { result, canonicalQuestions };
}

export async function runTr8Calibration({
  baseUrl,
  token,
  smokeJobId,
  runId,
  expectedVersion = "0.10.1",
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  pollIntervalMs = 15_000,
  maxPolls = 320
} = {}) {
  const safeBaseUrl = required(baseUrl, "baseUrl").replace(/\/$/, "");
  const safeToken = required(token, "token");
  const safeSmokeJobId = required(smokeJobId, "smokeJobId");
  const safeRunId = required(runId, "runId").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60);
  const safeExpectedVersion = required(expectedVersion, "expectedVersion");
  const headers = { authorization: `Bearer ${safeToken}`, "content-type": "application/json" };

  const preflight = await responseJson(await fetchImpl(`${safeBaseUrl}/dashboard/api`, { headers }), "preflight");
  if (String(preflight?.version ?? "unknown") !== safeExpectedVersion) {
    throw new Error(`factory-version-mismatch:${String(preflight?.version ?? "unknown")}/${safeExpectedVersion}`);
  }
  const smokeDetail = await responseJson(await fetchImpl(`${safeBaseUrl}/jobs/${safeSmokeJobId}`, { headers }), "smoke-evidence");
  if (String(smokeDetail?.job?.status ?? "unknown") !== "completed") throw new Error("smoke-evidence:not-completed");
  validateCompletedSmoke(smokeDetail);

  const requestBody = {
    jobType: JOB_TYPE,
    priority: 15,
    payload: {
      sampleSize: 20,
      maxAttempts: 2,
      batchId: `tr8-calibration-${safeRunId}`,
      themes: [...THEMES],
      morphologyNotes: [
        "Realize the assigned discourse structure and reasoning path in the actual paragraph; labels alone are insufficient.",
        "Keep four options plausible, diagnostic and comparable in length.",
        "Teach the misconception through evidence-specific option feedback and three non-revealing hints."
      ]
    }
  };
  const started = await responseJson(await fetchImpl(`${safeBaseUrl}/jobs`, {
    method: "POST", headers, body: JSON.stringify(requestBody)
  }), "start");
  const jobId = required(started.jobId, "start.jobId");

  for (let poll = 1; poll <= maxPolls; poll += 1) {
    if (poll > 1) await sleep(pollIntervalMs);
    const detail = await responseJson(await fetchImpl(`${safeBaseUrl}/jobs/${jobId}`, { headers }), "poll");
    const status = String(detail?.job?.status ?? "unknown");
    if (status === "completed") {
      const validated = validateCompletedCalibration(detail);
      return Object.freeze({
        ok: true,
        status: "PASS",
        factoryVersion: safeExpectedVersion,
        smokeJobId: safeSmokeJobId,
        jobId,
        batchId: validated.result.batchId,
        pollCount: poll,
        engineeringPassCount: validated.result.engineeringPassCount,
        sampleSize: validated.result.sampleSize,
        qualityEvidence: validated.result.qualityEvidence,
        blindReviewCount: validated.result.instances.length,
        canonicalQuestionIds: validated.canonicalQuestions.map((question) => question.id),
        nextAction: "Complete human review for all twenty questions; do not export or import automatically."
      });
    }
    if (["failed", "quarantined", "cancelled"].includes(status)) {
      throw new Error(`tr8-calibration-job-${status}:${String(detail?.job?.error_text ?? "unknown")}`);
    }
  }
  throw new Error(`tr8-calibration-timeout:${jobId}`);
}

export function calibrationReportMarkdown(report, { runUrl = "" } = {}) {
  const passed = report?.ok === true && report?.status === "PASS";
  const evidence = report?.qualityEvidence ?? {};
  return `## 8. sınıf Türkçe · 20 soruluk calibration

- Sonuç: **${passed ? "PASS" : "FAIL"}**
- Önkoşul smoke job: \`${String(report?.smokeJobId ?? "doğrulanamadı")}\`
- Calibration job: \`${String(report?.jobId ?? "oluşturulamadı")}\`
- Engineering: ${Number(report?.engineeringPassCount ?? 0)} / ${Number(report?.sampleSize ?? 20)}
- Kör bağımsız çözüm: ${Number(report?.blindReviewCount ?? 0)} / ${Number(report?.sampleSize ?? 20)}
- Semantik tekrar oranı: ${String(evidence.duplicateRate ?? "ölçülemedi")}%
- Yapısal kalıp tekrar çifti: ${String(evidence.structuralDuplicatePairCount ?? "ölçülemedi")}
- Çeşitlilik: ${String(evidence.distinctDiversityPlanCount ?? "?")} plan · ${String(evidence.distinctDiscourseStructureCount ?? "?")} söylem · ${String(evidence.distinctReasoningPathCount ?? "?")} akıl yürütme · ${String(evidence.distinctGenreCount ?? "?")} tür
- Doğru cevap konumları: ${JSON.stringify(evidence.correctPositionCounts ?? [])}
- İnsan incelemesi: **0/20 — otomatik yapılmadı**
- Onaylı paket exportu: **otomatik yapılmadı**
${runUrl ? `- [GitHub Actions kanıtı](${runUrl})` : ""}

${passed ? "Sıradaki adım: Dashboard'da 20/20 insan incelemesi tamamlanır; en az 16 kabul olmadan export kapalı kalır." : `Hata: \`${String(report?.error ?? "bilinmeyen")}\``}
`;
}
