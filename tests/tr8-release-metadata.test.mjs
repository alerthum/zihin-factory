import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const schema = readFileSync(new URL("../src/schema.ts", import.meta.url), "utf8");
const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0012_tr8_pilot_release.sql", import.meta.url), "utf8");
const observer = readFileSync(new URL("../.github/workflows/factory-observer.yml", import.meta.url), "utf8");
const smoke = readFileSync(new URL("../.github/workflows/tr8-paragraph-smoke.yml", import.meta.url), "utf8");

test("release metadata, live dashboard and observer agree on factory 0.10.1", () => {
  assert.equal(packageJson.version, "0.10.1");
  assert.match(schema, /\["factory_version","0\.10\.1"\]/);
  assert.match(schema, /\["schema_version","12"\]/);
  assert.match(index, /version:metaMap\.factory_version \?\? "0\.10\.1"/);
  assert.match(observer, /FACTORY_EXPECTED_VERSION: 0\.10\.1/);
  assert.match(smoke, /FACTORY_EXPECTED_VERSION: 0\.10\.1/);
});

test("migration 0012 changes metadata without starting, merging or deploying anything", () => {
  assert.match(migration, /factory_version','0\.10\.1/);
  assert.match(migration, /schema_version','12/);
  const executableSql = migration.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
  assert.doesNotMatch(executableSql, /WORK_QUEUE|RUNS|ARTIFACTS|deploy|merge/i);
});

test("release surface advertises the protected approved-package endpoint", () => {
  assert.match(index, /GET \/admin\/tr8-benchmark\/:jobId\/approved-package \(Bearer token\)/);
});
