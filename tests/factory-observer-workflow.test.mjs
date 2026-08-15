import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/factory-observer.yml", import.meta.url), "utf8");

test("observer runs every three hours and updates one durable control issue", () => {
  assert.match(workflow, /cron: "17 \*\/3 \* \* \*"/);
  assert.match(workflow, /const title = '\[WATCH\] Zihin Factory evidence log'/);
  assert.match(workflow, /github\.rest\.issues\.update/);
  assert.match(workflow, /node-version: 24/);
});

test("control issue keeps active draft PRs and the latest bounded smoke result", () => {
  assert.match(workflow, /github\.rest\.pulls\.list/);
  assert.match(workflow, /github\.rest\.issues\.listComments/);
  assert.match(workflow, /8\. sınıf Türkçe · 2 soruluk smoke/);
  assert.match(workflow, /## Aktif fabrika taslakları/);
  assert.match(workflow, /## Son 8\. sınıf Türkçe smoke sonucu/);
  assert.match(workflow, /20 soruluk calibration/);
  assert.match(workflow, /## Son 8\. sınıf Türkçe calibration sonucu/);
});

test("control issue remains the single operator page after every refresh", () => {
  assert.match(workflow, /Günlük izlenecek üç kayıt/);
  assert.match(workflow, /Factory PR #4/);
  assert.match(workflow, /Factory PR #12/);
  assert.match(workflow, /KuzenlerYarisiyor PR #2/);
  assert.match(workflow, /8\. sınıf Türkçe kalite zinciri/);
  assert.match(workflow, /üretici, cevap anahtarı\/ipuçları\/geri bildirim\/çözümü görmeden soruyu çözen kör değerlendirici ve son kalite denetçisi üç farklı model/);
  assert.match(workflow, /Smoke, 20 soruluk calibration, insan onaylı export ve KuzenlerYarisiyor importer/);
  assert.match(workflow, /iki sorunun ikisi de insan tarafından incelenmeli/);
  assert.match(workflow, /altı kalite boyutunda en az 4\/5/);
  assert.match(workflow, /üç aşamalı ipucunun tamamını, kanıtlı çözüm adımlarını ve dört şıkkın gerekçesini/);
  assert.match(workflow, /production\/cloudflare/);
  assert.match(workflow, /production\/vercel/);
  assert.match(workflow, /\.github\/\*/);
  assert.match(workflow, /tests\/\*/);
  assert.match(workflow, /KuzenlerYarisiyor Actions secrets/);
  assert.match(workflow, /FACTORY_ADMIN_TOKEN/);
  assert.match(workflow, /Allow GitHub Actions to create and approve pull requests/);
});

test("scheduled observer remains read-only toward the factory and deployment", () => {
  assert.doesNotMatch(workflow, /run:\s*(?:npx\s+)?wrangler\s+deploy/i);
  assert.doesNotMatch(workflow, /fetch\([^)]*\/jobs|\/admin\/start|\/admin\/cycle/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read\s*\n\s*issues: write/);
});

test("embedded GitHub script is valid JavaScript", () => {
  const normalized = workflow.replace(/\r\n/g, "\n");
  const marker = "          script: |\n";
  const start = normalized.indexOf(marker);
  assert.notEqual(start, -1);
  const embedded = normalized
    .slice(start + marker.length)
    .split("\n")
    .map((line) => line.startsWith("            ") ? line.slice(12) : line)
    .join("\n");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  assert.doesNotThrow(() => new AsyncFunction("github", "context", "core", "require", embedded));
});
