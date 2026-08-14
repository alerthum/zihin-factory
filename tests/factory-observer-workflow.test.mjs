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
});

test("scheduled observer remains read-only toward the factory and deployment", () => {
  assert.doesNotMatch(workflow, /run:\s*(?:npx\s+)?wrangler\s+deploy/i);
  assert.doesNotMatch(workflow, /fetch\([^)]*\/jobs|\/admin\/start|\/admin\/cycle/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read\s*\n\s*issues: write/);
});
