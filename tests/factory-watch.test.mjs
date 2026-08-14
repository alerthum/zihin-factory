import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFactorySnapshot, renderMarkdown } from "../scripts/factory-watch-lib.mjs";

function baseDashboard() {
  return {
    version: "0.10.1",
    stateMap: { continuous_enabled: "1", product_throughput_health: "active" },
    activeJobs: [],
    last6h: { jobs: 4, completed: 3, failed: 0, quarantine: 0, blocked: 0 },
    itemModel: { humanBenchmark: { total: 12, accepted: 10, rate: 83 } },
    qualityEvidence: {
      sampleSize: 20,
      duplicateRate: 0,
      longestCorrectRate: 25,
      uniqueAnswerRate: 100,
      explanationEvidenceRate: 100
    }
  };
}

test("healthy evidence-backed snapshot has no configured anomaly", () => {
  const report = evaluateFactorySnapshot({
    health: { ok: true, meta: [{ key: "factory_version", value: "0.10.1" }] },
    dashboard: baseDashboard(),
    expectedVersion: "0.10.1",
    now: new Date("2026-08-14T12:00:00Z")
  });
  assert.equal(report.highestSeverity, "info");
  assert.deepEqual(report.findings.map(row => row.code), ["NO_ANOMALY"]);
});

test("stale active job is critical", () => {
  const dashboard = baseDashboard();
  dashboard.activeJobs = [{ id: "job-1", status: "running", updated_at: "2026-08-14 11:40:00" }];
  const report = evaluateFactorySnapshot({
    health: { ok: true, meta: [] },
    dashboard,
    now: new Date("2026-08-14T12:00:00Z")
  });
  assert.equal(report.highestSeverity, "critical");
  assert.ok(report.findings.some(row => row.code === "STALE_ACTIVE_JOB"));
});

test("missing item-quality evidence is reported rather than guessed", () => {
  const dashboard = baseDashboard();
  dashboard.operatorIssues = [{ error_text: "protected provider detail" }];
  delete dashboard.qualityEvidence;
  const report = evaluateFactorySnapshot({ health: { ok: true, meta: [] }, dashboard });
  const finding = report.findings.find(row => row.code === "QUALITY_EVIDENCE_MISSING");
  assert.ok(finding);
  assert.ok(finding.evidence.missingQualityMetrics.includes("duplicateRate"));
  assert.match(renderMarkdown(report), /read-only/i);
  assert.equal(report.snapshot.dashboard.counts.operatorIssues, 1);
  assert.doesNotMatch(JSON.stringify(report), /protected provider detail/);
});

test("protected dashboard failure is critical", () => {
  const report = evaluateFactorySnapshot({ health: { ok: true, meta: [] }, dashboard: null });
  assert.equal(report.highestSeverity, "critical");
  assert.ok(report.findings.some(row => row.code === "DASHBOARD_UNAVAILABLE"));
});
