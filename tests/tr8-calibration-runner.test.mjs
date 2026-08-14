import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  calibrationReportMarkdown,
  runTr8Calibration,
  validateCompletedCalibration
} from "../scripts/tr8-calibration-lib.mjs";

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, async json() { return structuredClone(payload); } };
}

function canonical(index) {
  return {
    schemaVersion: "3.0",
    id: `q${index + 1}`,
    curriculum: { grade: 8, courseId: "turkce", outcomeIds: ["tr.pre-tymm.g8.turkce.t-8-3-17"] },
    verifier: { verified: true },
    contentStatus: "HUMAN_REVIEW_REQUIRED",
    content: { humanReview: { gameAdaptationAllowed: false } },
    styleProfile: {
      diversityPlanId: `plan-${index + 1}`,
      discourseStructureId: `discourse-${index % 5}`,
      reasoningPathId: `reasoning-${Math.floor(index / 5)}`,
      genreId: `genre-${index % 5}`
    }
  };
}

function blindInstance(index) {
  return {
    instanceId: `calibration-item-${index + 1}`,
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

function detail({ sampleSize, engineeringPassCount = sampleSize, structuralDuplicatePairCount = 0 } = {}) {
  const calibration = sampleSize === 20;
  const result = {
    ok: true,
    kind: "assessment.tr8-paragraph-benchmark",
    batchId: calibration ? "tr8-calibration-run-50" : "tr8-smoke-run-49",
    sampleSize,
    status: "PENDING_HUMAN_REVIEW",
    engineeringPassCount,
    automatedIssues: [],
    humanReviewStatus: "NOT_MEASURED",
    pilotReady: false,
    instances: Array.from({ length: sampleSize }, (_, index) => blindInstance(index)),
    qualityEvidence: calibration ? {
      sampleSize: 20,
      duplicateRate: 0,
      longestCorrectRate: 25,
      uniqueAnswerRate: 100,
      explanationEvidenceRate: 100,
      correctPositionCounts: [5, 5, 5, 5],
      structuralDuplicatePairCount,
      distinctDiversityPlanCount: 20,
      distinctDiscourseStructureCount: 5,
      distinctReasoningPathCount: 4,
      distinctGenreCount: 5,
      maximumDiscourseStructureShare: 0.2,
      maximumReasoningPathShare: 0.25
    } : {
      sampleSize: 2,
      duplicateRate: 0,
      longestCorrectRate: 0,
      uniqueAnswerRate: 100,
      explanationEvidenceRate: 100,
      structuralDuplicatePairCount: 0,
      distinctDiversityPlanCount: 2,
      distinctDiscourseStructureCount: 2
    }
  };
  return {
    ok: true,
    job: { id: calibration ? "00000000-0000-4000-8000-000000000050" : "00000000-0000-4000-8000-000000000049", status: "completed", result_json: JSON.stringify(result) },
    artifacts: Array.from({ length: sampleSize }, (_, index) => ({
      id: `a${index + 1}`,
      kind: "assessment-candidate",
      metadata_json: JSON.stringify({ canonical: canonical(index) })
    }))
  };
}

test("calibration requires a successful smoke and starts exactly twenty planned questions", async () => {
  const calls = [];
  const replies = [
    response(200, { ok: true, version: "0.10.1" }),
    response(200, detail({ sampleSize: 2 })),
    response(202, { ok: true, jobId: "00000000-0000-4000-8000-000000000050" }),
    response(200, detail({ sampleSize: 20 }))
  ];
  const report = await runTr8Calibration({
    baseUrl: "https://factory.example",
    token: "secret",
    smokeJobId: "00000000-0000-4000-8000-000000000049",
    runId: "50",
    fetchImpl: async (url, options = {}) => { calls.push({ url, options }); return replies.shift(); },
    sleep: async () => {},
    maxPolls: 1
  });
  const request = JSON.parse(calls[2].options.body);
  assert.equal(request.jobType, "assessment.tr8-paragraph-benchmark");
  assert.equal(request.payload.sampleSize, 20);
  assert.equal(request.payload.maxAttempts, 2);
  assert.equal(request.payload.themes.length, 20);
  assert.equal(report.status, "PASS");
  assert.equal(report.blindReviewCount, 20);
  assert.equal(report.canonicalQuestionIds.length, 20);
  assert.doesNotMatch(JSON.stringify(report), /secret/);
});

test("calibration fails closed when any blind solution is missing or answer-exposed", () => {
  const missing = detail({ sampleSize: 20 });
  const missingResult = JSON.parse(missing.job.result_json);
  missingResult.instances.pop();
  missing.job.result_json = JSON.stringify(missingResult);
  assert.throws(() => validateCompletedCalibration(missing), /blind-instance-count/);

  const exposed = detail({ sampleSize: 20 });
  const exposedResult = JSON.parse(exposed.job.result_json);
  exposedResult.instances[7].blindAnswerKeyExposed = true;
  exposed.job.result_json = JSON.stringify(exposedResult);
  assert.throws(() => validateCompletedCalibration(exposed), /blind-answer-key-exposed/);
});

test("failed smoke evidence prevents creation of a calibration job", async () => {
  const calls = [];
  const replies = [
    response(200, { ok: true, version: "0.10.1" }),
    response(200, detail({ sampleSize: 2, engineeringPassCount: 1 }))
  ];
  await assert.rejects(() => runTr8Calibration({
    baseUrl: "https://factory.example",
    token: "secret",
    smokeJobId: "00000000-0000-4000-8000-000000000049",
    runId: "51",
    fetchImpl: async (url, options = {}) => { calls.push({ url, options }); return replies.shift(); }
  }), /engineering-pass-not-two/);
  assert.equal(calls.length, 2);
});

test("structural repetition keeps human review and export closed", () => {
  assert.throws(
    () => validateCompletedCalibration(detail({ sampleSize: 20, structuralDuplicatePairCount: 1 })),
    /structural-template-duplicates/
  );
});

test("calibration report explicitly leaves human review and export manual", () => {
  const markdown = calibrationReportMarkdown({
    ok: true,
    status: "PASS",
    smokeJobId: "smoke-1",
    jobId: "calibration-1",
    engineeringPassCount: 20,
    sampleSize: 20,
    blindReviewCount: 20,
    qualityEvidence: { structuralDuplicatePairCount: 0, distinctDiversityPlanCount: 20 }
  });
  assert.match(markdown, /İnsan incelemesi: \*\*0\/20 — otomatik yapılmadı\*\*/);
  assert.match(markdown, /Kör bağımsız çözüm: 20 \/ 20/);
  assert.match(markdown, /Onaylı paket exportu: \*\*otomatik yapılmadı\*\*/);
});

test("calibration workflow is manual, smoke-gated and writes only to control issue 3", () => {
  const workflow = readFileSync(new URL("../.github/workflows/tr8-paragraph-calibration.yml", import.meta.url), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /smoke_job_id:/);
  assert.match(workflow, /RUN_TR8_CALIBRATION_20/);
  assert.match(workflow, /secrets\.FACTORY_ADMIN_TOKEN/);
  assert.match(workflow, /issue_number: 3/);
  assert.doesNotMatch(workflow, /schedule:|wrangler deploy|git push|merge|approved-package/i);
});
