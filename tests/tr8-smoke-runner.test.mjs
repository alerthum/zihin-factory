import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runTr8Smoke, smokeReportMarkdown } from "../scripts/tr8-smoke-lib.mjs";

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, async json() { return structuredClone(payload); } };
}

function canonical(id) {
  const index = id === "q1" ? 1 : 2;
  return {
    schemaVersion: "3.0", id,
    curriculum: { grade: 8, courseId: "turkce", outcomeIds: ["tr.pre-tymm.g8.turkce.t-8-3-17"] },
    verifier: { verified: true },
    contentStatus: "HUMAN_REVIEW_REQUIRED",
    content: { humanReview: { gameAdaptationAllowed: false } },
    styleProfile: {
      diversityPlanId: `plan-${index}`,
      discourseStructureId: `discourse-${index}`,
      reasoningPathId: "multi-source-convergence",
      genreId: `genre-${index}`
    }
  };
}

function blindInstance(index) {
  return {
    instanceId: `smoke-item-${index + 1}`,
    status: "ENGINEERING_PASS",
    producerModel: `producer-${index + 1}`,
    blindReviewerModel: `blind-reviewer-${index + 1}`,
    reviewerModel: `quality-reviewer-${index + 1}`,
    engineeringDecision: "PASS",
    engineeringScore: 93,
    blindResolutionLocked: true,
    independentlyResolved: true,
    blindAnswerKeyExposed: false,
    error: null
  };
}

function completedDetail(overrides = {}) {
  const result = {
    kind: "assessment.tr8-paragraph-benchmark", batchId: "tr8-smoke-run-42", sampleSize: 2,
    status: "PENDING_HUMAN_REVIEW", engineeringPassCount: 2, automatedIssues: [],
    humanReviewStatus: "NOT_MEASURED", pilotReady: false,
    instances: [blindInstance(0), blindInstance(1)],
    qualityEvidence: {
      sampleSize: 2, duplicateRate: 0, longestCorrectRate: 0, uniqueAnswerRate: 100, explanationEvidenceRate: 100,
      structuralDuplicatePairCount: 0, distinctDiversityPlanCount: 2, distinctDiscourseStructureCount: 2
    },
    ...overrides
  };
  return {
    ok: true,
    job: { id: "00000000-0000-4000-8000-000000000042", status: "completed", result_json: JSON.stringify(result) },
    artifacts: [canonical("q1"), canonical("q2")].map((question, index) => ({
      id: `a${index + 1}`, kind: "assessment-candidate", metadata_json: JSON.stringify({ canonical: question })
    }))
  };
}

test("cloud smoke starts exactly two questions, polls and proves canonical artifacts", async () => {
  const calls = [];
  const replies = [
    response(200, { ok: true, version: "0.10.1" }),
    response(202, { ok: true, jobId: "00000000-0000-4000-8000-000000000042" }),
    response(200, { ok: true, job: { status: "running" } }),
    response(200, completedDetail())
  ];
  const report = await runTr8Smoke({
    baseUrl: "https://factory.example", token: "secret", runId: "42",
    fetchImpl: async (url, options = {}) => { calls.push({ url, options }); return replies.shift(); },
    sleep: async () => {}, pollIntervalMs: 0, maxPolls: 3
  });
  const request = JSON.parse(calls[1].options.body);
  assert.equal(request.jobType, "assessment.tr8-paragraph-benchmark");
  assert.equal(request.payload.sampleSize, 2);
  assert.equal(request.payload.maxAttempts, 2);
  assert.equal(report.status, "PASS");
  assert.equal(report.blindReviewCount, 2);
  assert.deepEqual(report.canonicalQuestionIds, ["q1", "q2"]);
  assert.doesNotMatch(JSON.stringify(report), /secret/);
});

test("smoke rejects a reviewer record that saw the answer key", async () => {
  const unsafe = completedDetail();
  const result = JSON.parse(unsafe.job.result_json);
  result.instances[0].blindAnswerKeyExposed = true;
  unsafe.job.result_json = JSON.stringify(result);
  const replies = [
    response(200, { ok: true, version: "0.10.1" }),
    response(202, { ok: true, jobId: "00000000-0000-4000-8000-000000000045" }),
    response(200, unsafe)
  ];
  await assert.rejects(() => runTr8Smoke({
    baseUrl: "https://factory.example", token: "secret", runId: "45",
    fetchImpl: async () => replies.shift(), sleep: async () => {}, maxPolls: 1
  }), /blind-answer-key-exposed/);
});

test("engineering shortfall keeps the smoke and twenty-question calibration closed", async () => {
  const replies = [
    response(200, { ok: true, version: "0.10.1" }),
    response(202, { ok: true, jobId: "00000000-0000-4000-8000-000000000043" }),
    response(200, completedDetail({ engineeringPassCount: 1 }))
  ];
  await assert.rejects(() => runTr8Smoke({
    baseUrl: "https://factory.example", token: "secret", runId: "43",
    fetchImpl: async () => replies.shift(), sleep: async () => {}, maxPolls: 1
  }), /engineering-pass-not-two/);
});

test("old live factory version is rejected before a smoke job can be created", async () => {
  const calls = [];
  await assert.rejects(() => runTr8Smoke({
    baseUrl: "https://factory.example", token: "secret", runId: "44",
    fetchImpl: async (url) => { calls.push(url); return response(200, { ok: true, version: "0.9.0" }); }
  }), /factory-version-mismatch:0\.9\.0\/0\.10\.1/);
  assert.deepEqual(calls, ["https://factory.example/dashboard/api"]);
});

test("smoke report tells the operator that human review and calibration remain closed", () => {
  const markdown = smokeReportMarkdown({
    ok: true, status: "PASS", jobId: "job-1", engineeringPassCount: 2, sampleSize: 2,
    blindReviewCount: 2,
    qualityEvidence: { duplicateRate: 0, longestCorrectRate: 0, explanationEvidenceRate: 100 }
  });
  assert.match(markdown, /İnsan incelemesi: \*\*henüz yapılmadı\*\*/);
  assert.match(markdown, /Kör bağımsız çözüm: 2 \/ 2/);
  assert.match(markdown, /20 soruluk calibration: \*\*otomatik başlatılmadı\*\*/);
});

test("workflow is manual, bounded, secret-backed and writes only to control issue 3", () => {
  const workflow = readFileSync(new URL("../.github/workflows/tr8-paragraph-smoke.yml", import.meta.url), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /RUN_TR8_SMOKE/);
  assert.match(workflow, /secrets\.FACTORY_ADMIN_TOKEN/);
  assert.match(workflow, /issue_number: 3/);
  assert.doesNotMatch(workflow, /schedule:|wrangler deploy|git push|merge/i);
});
