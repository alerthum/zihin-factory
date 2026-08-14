const JOB_TYPE = "assessment.tr8-paragraph-benchmark";

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

function validateCompletedSmoke(detail) {
  const result = parseJson(detail?.job?.result_json, "job.result_json");
  const errors = [];
  if (result.kind !== JOB_TYPE) errors.push("wrong-result-kind");
  if (Number(result.sampleSize) !== 2) errors.push("sample-size-not-two");
  if (Number(result.engineeringPassCount) !== 2) errors.push("engineering-pass-not-two");
  if (result.status !== "PENDING_HUMAN_REVIEW") errors.push("wrong-result-status");
  if (result.pilotReady !== false) errors.push("smoke-must-not-be-pilot-ready");
  if (result.humanReviewStatus !== "NOT_MEASURED") errors.push("human-review-must-be-pending");
  if (!Array.isArray(result.automatedIssues) || result.automatedIssues.length) errors.push("automated-issues-present");
  const evidence = result.qualityEvidence ?? {};
  if (Number(evidence.sampleSize) !== 2) errors.push("evidence-sample-size");
  if (Number(evidence.duplicateRate) !== 0) errors.push("duplicate-rate");
  if (Number(evidence.longestCorrectRate) > 35) errors.push("longest-answer-leakage");
  if (Number(evidence.uniqueAnswerRate) !== 100) errors.push("unique-answer-rate");
  if (Number(evidence.explanationEvidenceRate) !== 100) errors.push("explanation-evidence-rate");

  const canonicalQuestions = (detail?.artifacts ?? [])
    .filter((artifact) => artifact?.kind === "assessment-candidate")
    .map((artifact) => parseJson(artifact.metadata_json, `artifact:${artifact?.id ?? "unknown"}`)?.canonical)
    .filter(Boolean);
  if (canonicalQuestions.length !== 2) errors.push(`canonical-artifact-count:${canonicalQuestions.length}`);
  for (const question of canonicalQuestions) {
    if (question.schemaVersion !== "3.0") errors.push(`canonical-schema:${question.id ?? "unknown"}`);
    if (question.curriculum?.grade !== 8 || question.curriculum?.courseId !== "turkce") errors.push(`canonical-target:${question.id ?? "unknown"}`);
    if (!question.curriculum?.outcomeIds?.includes("tr.pre-tymm.g8.turkce.t-8-3-17")) errors.push(`canonical-outcome:${question.id ?? "unknown"}`);
    if (question.verifier?.verified !== true) errors.push(`canonical-verifier:${question.id ?? "unknown"}`);
    if (question.contentStatus !== "HUMAN_REVIEW_REQUIRED") errors.push(`canonical-status:${question.id ?? "unknown"}`);
    if (question.content?.humanReview?.gameAdaptationAllowed !== false) errors.push(`canonical-game-lock:${question.id ?? "unknown"}`);
  }
  if (new Set(canonicalQuestions.map((question) => question.id)).size !== canonicalQuestions.length) errors.push("duplicate-canonical-id");
  if (errors.length) throw new Error(`tr8-smoke-failed:${[...new Set(errors)].join(",")}`);
  return { result, canonicalQuestions };
}

export async function runTr8Smoke({
  baseUrl,
  token,
  runId,
  expectedVersion = "0.10.1",
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  pollIntervalMs = 10_000,
  maxPolls = 90
} = {}) {
  const safeBaseUrl = required(baseUrl, "baseUrl").replace(/\/$/, "");
  const safeToken = required(token, "token");
  const safeRunId = required(runId, "runId").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60);
  const safeExpectedVersion = required(expectedVersion, "expectedVersion");
  const headers = { authorization: `Bearer ${safeToken}`, "content-type": "application/json" };
  const preflight = await responseJson(await fetchImpl(`${safeBaseUrl}/dashboard/api`, { headers }), "preflight");
  if (String(preflight?.version ?? "unknown") !== safeExpectedVersion) {
    throw new Error(`factory-version-mismatch:${String(preflight?.version ?? "unknown")}/${safeExpectedVersion}`);
  }
  const requestBody = {
    jobType: JOB_TYPE,
    priority: 10,
    payload: {
      sampleSize: 2,
      maxAttempts: 2,
      batchId: `tr8-smoke-${safeRunId}`,
      themes: ["kent belleği ve farklı kanıt türleri", "günlük yaşamda gözlem ve çıkarım"],
      morphologyNotes: [
        "Keep all four options plausible and comparable in length.",
        "Use three distinct diagnostic misconceptions and evidence-specific teaching feedback."
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
      const validated = validateCompletedSmoke(detail);
      return Object.freeze({
        ok: true,
        status: "PASS",
        factoryVersion: safeExpectedVersion,
        jobId,
        batchId: validated.result.batchId,
        pollCount: poll,
        engineeringPassCount: validated.result.engineeringPassCount,
        sampleSize: validated.result.sampleSize,
        qualityEvidence: validated.result.qualityEvidence,
        canonicalQuestionIds: validated.canonicalQuestions.map((question) => question.id),
        nextAction: "Review the two canonical questions; do not start the 20-question calibration automatically."
      });
    }
    if (["failed", "quarantined", "cancelled"].includes(status)) {
      throw new Error(`tr8-smoke-job-${status}:${String(detail?.job?.error_text ?? "unknown")}`);
    }
  }
  throw new Error(`tr8-smoke-timeout:${jobId}`);
}

export function smokeReportMarkdown(report, { runUrl = "" } = {}) {
  const passed = report?.ok === true && report?.status === "PASS";
  const evidence = report?.qualityEvidence ?? {};
  return `## 8. sınıf Türkçe · 2 soruluk smoke

- Sonuç: **${passed ? "PASS" : "FAIL"}**
- Job: \`${String(report?.jobId ?? "oluşturulamadı")}\`
- Engineering: ${Number(report?.engineeringPassCount ?? 0)} / ${Number(report?.sampleSize ?? 2)}
- Tekrar oranı: ${String(evidence.duplicateRate ?? "ölçülemedi")}%
- En uzun doğru şık oranı: ${String(evidence.longestCorrectRate ?? "ölçülemedi")}%
- Açıklama-kanıt oranı: ${String(evidence.explanationEvidenceRate ?? "ölçülemedi")}%
- İnsan incelemesi: **henüz yapılmadı**
- 20 soruluk calibration: **otomatik başlatılmadı**
${runUrl ? `- [GitHub Actions kanıtı](${runUrl})` : ""}

${passed ? "Sıradaki adım: Bu iki soru insan tarafından incelenir; açık onay olmadan 20 soruluk partiye geçilmez." : `Hata: \`${String(report?.error ?? "bilinmeyen")}`}
`;
}
