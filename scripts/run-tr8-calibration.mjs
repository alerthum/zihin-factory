import { mkdir, writeFile } from "node:fs/promises";
import { calibrationReportMarkdown, runTr8Calibration } from "./tr8-calibration-lib.mjs";

const outputDirectory = "tr8-calibration-output";
await mkdir(outputDirectory, { recursive: true });

let report;
let exitCode = 0;
try {
  if (process.env.FACTORY_CALIBRATION_CONFIRM !== "RUN_TR8_CALIBRATION_20") {
    throw new Error("explicit-calibration-confirmation-required");
  }
  report = await runTr8Calibration({
    baseUrl: process.env.FACTORY_BASE_URL,
    token: process.env.FACTORY_ADMIN_TOKEN,
    smokeJobId: process.env.FACTORY_SMOKE_JOB_ID,
    expectedVersion: process.env.FACTORY_EXPECTED_VERSION ?? "0.10.1",
    runId: process.env.GITHUB_RUN_ID ?? `manual-${Date.now()}`
  });
} catch (error) {
  exitCode = 1;
  report = {
    ok: false,
    status: "FAIL",
    smokeJobId: process.env.FACTORY_SMOKE_JOB_ID ?? null,
    error: error instanceof Error ? error.message : String(error),
    nextAction: "Keep human review and approved-package export closed; inspect calibration evidence."
  };
}

const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : "";
await Promise.all([
  writeFile(`${outputDirectory}/report.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(`${outputDirectory}/report.md`, calibrationReportMarkdown(report, { runUrl }), "utf8")
]);
console.log(calibrationReportMarkdown(report, { runUrl }));
process.exitCode = exitCode;

