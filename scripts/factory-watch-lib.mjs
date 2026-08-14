const SEVERITY_ORDER = { info: 0, warning: 1, critical: 2 };

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function utcTimestamp(value) {
  if (!value) return null;
  const text = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  const milliseconds = Date.parse(normalized);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function finding(code, severity, summary, evidence = {}) {
  return { code, severity, summary, evidence };
}

export function evaluateFactorySnapshot({
  health,
  dashboard,
  now = new Date(),
  expectedVersion = "",
  staleMinutes = 10
}) {
  const findings = [];
  const nowMs = now.getTime();

  if (!health?.ok) {
    findings.push(finding("HEALTH_DOWN", "critical", "Public health check did not return ok=true."));
  }

  const meta = Object.fromEntries((health?.meta ?? []).map(row => [String(row.key), String(row.value)]));
  const liveVersion = String(meta.factory_version ?? dashboard?.version ?? "unknown");
  if (expectedVersion && liveVersion !== expectedVersion) {
    findings.push(finding(
      "VERSION_DRIFT",
      "warning",
      `Live version ${liveVersion} does not match expected version ${expectedVersion}.`,
      { liveVersion, expectedVersion }
    ));
  }

  if (!dashboard) {
    findings.push(finding(
      "DASHBOARD_UNAVAILABLE",
      "critical",
      "Protected dashboard snapshot could not be read; production output cannot be verified."
    ));
    return summarize(findings, { liveVersion, health, dashboard: null });
  }

  const stateMap = dashboard.stateMap ?? Object.fromEntries(
    (dashboard.state ?? []).map(row => [String(row.key), String(row.value)])
  );
  if (stateMap.continuous_enabled !== "1") {
    findings.push(finding("FACTORY_PAUSED", "warning", "Factory continuous execution is paused."));
  }
  if (stateMap.product_throughput_health === "stalled") {
    findings.push(finding(
      "THROUGHPUT_STALLED",
      "critical",
      "Factory reports stalled product throughput.",
      { product_throughput_health: stateMap.product_throughput_health }
    ));
  }

  for (const job of dashboard.activeJobs ?? []) {
    const updatedAt = utcTimestamp(job.updated_at);
    if (updatedAt !== null) {
      const ageMinutes = Math.round((nowMs - updatedAt) / 60000);
      if (ageMinutes > staleMinutes) {
        findings.push(finding(
          "STALE_ACTIVE_JOB",
          "critical",
          `Active job ${job.id ?? "unknown"} has not updated for ${ageMinutes} minutes.`,
          { jobId: job.id ?? null, ageMinutes, status: job.status ?? null }
        ));
      }
    }
  }

  const last6h = dashboard.last6h ?? {};
  if (number(last6h.failed) > 0) {
    findings.push(finding("RECENT_FAILURES", "critical", `${number(last6h.failed)} job(s) failed in the last 6 hours.`, { last6h }));
  }
  if (number(last6h.quarantine) > 0) {
    findings.push(finding("RECENT_QUARANTINE", "warning", `${number(last6h.quarantine)} job(s) entered quarantine in the last 6 hours.`, { last6h }));
  }
  if (number(last6h.blocked) > 0) {
    findings.push(finding("RECENT_BLOCKED", "warning", `${number(last6h.blocked)} job(s) were blocked in the last 6 hours.`, { last6h }));
  }
  if (number(last6h.jobs) >= 3 && number(last6h.completed) === 0) {
    findings.push(finding(
      "ACTIVITY_WITHOUT_COMPLETION",
      "warning",
      `${number(last6h.jobs)} jobs ran in the last 6 hours without a completed result.`,
      { last6h }
    ));
  }

  const humanBenchmark = dashboard.itemModel?.humanBenchmark;
  if (!humanBenchmark || number(humanBenchmark.total) === 0) {
    findings.push(finding(
      "NO_HUMAN_BENCHMARK",
      "warning",
      "No real human item-benchmark decisions are available."
    ));
  } else if (number(humanBenchmark.total) >= 10 && number(humanBenchmark.rate) < 80) {
    findings.push(finding(
      "LOW_HUMAN_ACCEPTANCE",
      "warning",
      `Human benchmark acceptance is ${number(humanBenchmark.rate)}%, below the 80% target.`,
      { humanBenchmark }
    ));
  }

  const quality = dashboard.qualityEvidence;
  const requiredQualityMetrics = [
    "sampleSize",
    "duplicateRate",
    "longestCorrectRate",
    "uniqueAnswerRate",
    "explanationEvidenceRate"
  ];
  const missingQualityMetrics = requiredQualityMetrics.filter(key => quality?.[key] === undefined);
  if (missingQualityMetrics.length) {
    findings.push(finding(
      "QUALITY_EVIDENCE_MISSING",
      "warning",
      "Dashboard does not expose enough item-level evidence to prove question quality.",
      { missingQualityMetrics }
    ));
  }

  if (!findings.length) {
    findings.push(finding("NO_ANOMALY", "info", "No configured operational anomaly was detected."));
  }

  return summarize(findings, { liveVersion, health, dashboard });
}

function summarize(findings, snapshot) {
  const highestSeverity = findings.reduce(
    (highest, row) => SEVERITY_ORDER[row.severity] > SEVERITY_ORDER[highest] ? row.severity : highest,
    "info"
  );
  return {
    observedAt: new Date().toISOString(),
    highestSeverity,
    findings,
    snapshot: {
      liveVersion: snapshot.liveVersion,
      health: snapshot.health,
      dashboard: sanitizeDashboard(snapshot.dashboard)
    }
  };
}

function sanitizeDashboard(dashboard) {
  if (!dashboard) return null;
  const stateMap = dashboard.stateMap ?? Object.fromEntries(
    (dashboard.state ?? []).map(row => [String(row.key), String(row.value)])
  );
  return {
    version: dashboard.version ?? null,
    state: {
      continuous_enabled: stateMap.continuous_enabled ?? null,
      product_throughput_health: stateMap.product_throughput_health ?? null
    },
    counts: {
      activeJobs: (dashboard.activeJobs ?? []).length,
      startingJobs: (dashboard.startingJobs ?? []).length,
      operatorIssues: (dashboard.operatorIssues ?? []).length,
      blockers: (dashboard.blockers ?? []).length
    },
    last6h: dashboard.last6h ?? {},
    today: dashboard.today ?? {},
    humanBenchmark: dashboard.itemModel?.humanBenchmark ?? null,
    qualityEvidence: dashboard.qualityEvidence ?? null
  };
}

export function renderMarkdown(report) {
  const dashboard = report.snapshot.dashboard;
  const last6h = dashboard?.last6h ?? {};
  const lines = [
    "# Zihin Factory observer report",
    "",
    `- Observed: ${report.observedAt}`,
    `- Severity: **${report.highestSeverity.toUpperCase()}**`,
    `- Live version: ${report.snapshot.liveVersion}`,
    `- Last 6h: ${number(last6h.jobs)} jobs, ${number(last6h.completed)} completed, ${number(last6h.failed)} failed, ${number(last6h.quarantine)} quarantined`,
    "",
    "## Findings",
    ""
  ];
  for (const row of report.findings) {
    lines.push(`- **${row.severity.toUpperCase()} — ${row.code}:** ${row.summary}`);
  }
  lines.push(
    "",
    "## Observer boundary",
    "",
    "This run is read-only. It did not start, pause, retry, certify, deploy, merge, or modify factory work."
  );
  return `${lines.join("\n")}\n`;
}
