import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

test("approved pilot package is exposed only through the protected admin router", () => {
  assert.match(source, /\/admin\\\/tr8-benchmark\\\/\(\[0-9a-f-\]\+\)\\\/approved-package/);
  assert.match(source, /pilot_package_not_eligible/);
  assert.match(source, /buildTr8ApprovedPilotPackage/);
});

test("approved package route does not merge or deploy either repository", () => {
  const route = source.slice(source.indexOf("const tr8ApprovedPackageMatch"), source.indexOf("if (request.method === \"POST\" && url.pathname === \"/admin/tr8-benchmark/review\""));
  assert.doesNotMatch(route, /merge|deploy|github\.project-pr/i);
});
