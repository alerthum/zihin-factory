import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/dashboard/html.ts", import.meta.url), "utf8");

test("dashboard exposes one human-review tab with the six required dimensions", () => {
  assert.match(source, /data-tab="human">İnsan İncelemesi/);
  assert.match(source, /scoreSelect\('correctness'/);
  assert.match(source, /scoreSelect\('optionOrRubricQuality'/);
  assert.match(source, /scoreSelect\('ageLanguageFit'/);
  assert.match(source, /scoreSelect\('hintNonLeakage'/);
  assert.match(source, /scoreSelect\('feedbackTeachingValue'/);
  assert.match(source, /scoreSelect\('naturalness'/);
});

test("dashboard review form uses the protected API and never merges or deploys", () => {
  assert.match(source, /\/admin\/tr8-benchmark\/review/);
  assert.match(source, /İnsan kararı olmadan hiçbir soru KuzenlerYarisiyor oyunlarına aktarılmaz/);
  assert.doesNotMatch(source, /data-review-form[^]*\/deploy/);
  assert.doesNotMatch(source, /data-review-form[^]*\/merge/);
});
