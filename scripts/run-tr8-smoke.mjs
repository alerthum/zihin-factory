import { mkdir, writeFile } from "node:fs/promises";
import { runTr8Smoke, smokeReportMarkdown } from "./tr8-smoke-lib.mjs";

const outputDirectory = "tr8-smoke-output";
await mkdir(outputDirectory, { recursive: true });

let report;
let exitCode = 0;
try {
  if (process.env.FACTORY_SMOKE_CONFIRM !== "RUN_TR8_SMOKE") {
    throw new Error("explicit-smoke-confirmation-required");
  }
  report = await runTr8Smoke({
    baseUrl: process.env.FACTORY_BASE_URL,
    token: process.env.FACTORY_ADMIN_TOKEN,
    expectedVersion: process.env.FACTORY_EXPECTED_VERSION ?? "0.10.1",
    runId: process.env.GITHUB_RUN_ID ?? `manual-${Date.now()}`
  });
} catch (error) {
  exitCode = 1;
  report = {
    ok: false,
    status: "FAIL",
    error: error instanceof Error ? error.message : String(error),
    nextAction: "Keep the 20-question calibration closed and inspect the smoke evidence."
  };
}

const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : "";
await Promise.all([
  writeFile(`${outputDirectory}/report.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(`${outputDirectory}/report.md`, smokeReportMarkdown(report, { runUrl }), "utf8")
]);
console.log(smokeReportMarkdown(report, { runUrl }));
process.exitCode = exitCode;
