import { mkdir, writeFile } from "node:fs/promises";
import { evaluateFactorySnapshot, renderMarkdown } from "./factory-watch-lib.mjs";

const baseUrl = (process.env.FACTORY_BASE_URL ?? "https://zihin-factory-governor.alerthum.workers.dev").replace(/\/$/, "");
const adminToken = process.env.FACTORY_ADMIN_TOKEN ?? "";
const expectedVersion = process.env.FACTORY_EXPECTED_VERSION ?? "";
const outputDirectory = process.env.FACTORY_WATCH_OUTPUT ?? "factory-watch-output";

async function readJson(path, token = "") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

let health = null;
let dashboard = null;
const readErrors = [];

try {
  health = await readJson("/health");
} catch (error) {
  readErrors.push(`health: ${error instanceof Error ? error.message : String(error)}`);
}

if (!adminToken) {
  readErrors.push("dashboard: FACTORY_ADMIN_TOKEN is not configured");
} else {
  try {
    dashboard = await readJson("/dashboard/api", adminToken);
  } catch (error) {
    readErrors.push(`dashboard: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const report = evaluateFactorySnapshot({ health, dashboard, expectedVersion });
report.readErrors = readErrors;
await mkdir(outputDirectory, { recursive: true });
await writeFile(`${outputDirectory}/report.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
const markdown = renderMarkdown(report);
await writeFile(`${outputDirectory}/report.md`, markdown, "utf8");

if (process.env.GITHUB_STEP_SUMMARY) {
  await writeFile(process.env.GITHUB_STEP_SUMMARY, markdown, { encoding: "utf8", flag: "a" });
}

process.stdout.write(markdown);
if (readErrors.length) process.stderr.write(`${readErrors.join("\n")}\n`);
process.exitCode = report.highestSeverity === "critical" ? 1 : 0;
