import type { AppliedPatch } from "../project/repo-tools";
import type { QualityReview } from "./gate";

export type ProductPreflightResult = {
  ok: boolean;
  issues: string[];
  npmScripts: string[];
};

const TEST_PATH = /(?:^|\/)(?:tests?|e2e)(?:\/|$)|\.(?:test|spec)\.[^.\/]+$/i;
const TEST_OBJECTIVE = /\b(test|tests|testing|regression|mutation|e2e|smoke|spec|coverage|quality gate|test gate)\b/i;
const PRODUCTION_OBJECTIVE = /\b(production|runtime|engine|adapter|implementation|implement|bug|fix|native integration|product|feature|code patch)\b/i;

export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path.replace(/\\/g, "/"));
}

export function isExplicitTestObjective(objective: string, acceptanceCriteria: string[] = []): boolean {
  const text = `${objective}\n${acceptanceCriteria.join("\n")}`;
  return TEST_OBJECTIVE.test(text) && !PRODUCTION_OBJECTIVE.test(objective);
}

export function productPatchDeterministicIssues(input: {
  objective: string;
  acceptanceCriteria?: string[];
  proposal: AppliedPatch;
}): string[] {
  const issues: string[] = [];
  const paths = input.proposal.changes.map(x => x.path);
  if (paths.length > 0 && paths.every(isTestPath) && !isExplicitTestObjective(input.objective,input.acceptanceCriteria ?? [])) {
    issues.push("test_only_production_patch");
  }
  return issues;
}

export function npmScriptsFromVerification(commands: string[]): string[] {
  const scripts = new Set<string>();
  for (const command of commands) {
    const match = command.trim().match(/^npm\s+run\s+([A-Za-z0-9:_-]+)(?:\s|$)/i);
    if (match?.[1]) scripts.add(match[1]);
  }
  return [...scripts];
}

export function packageScripts(packageJsonText: string): Set<string> {
  try {
    const parsed = JSON.parse(packageJsonText) as { scripts?: Record<string,unknown> };
    if (!parsed.scripts || typeof parsed.scripts !== "object") return new Set();
    return new Set(Object.keys(parsed.scripts));
  } catch {
    return new Set();
  }
}

export function verificationManifestIssues(commands: string[], packageJsonText: string | null): ProductPreflightResult {
  const npmScripts = npmScriptsFromVerification(commands);
  const issues: string[] = [];
  if (npmScripts.length === 0) return {ok:true,issues,npmScripts};
  if (!packageJsonText) return {ok:false,issues:["package_manifest_unavailable"],npmScripts};
  const available = packageScripts(packageJsonText);
  for (const script of npmScripts) if (!available.has(script)) issues.push(`missing_npm_script:${script}`);
  return {ok:issues.length===0,issues,npmScripts};
}

export function applyProductDeterministicIssues<T extends {decision:string;deterministicIssues:string[];reasons:string[];revisionInstructions:string}>(review: T, issues: string[]): T {
  if (!issues.length) return review;
  const merged=[...new Set([...(review.deterministicIssues ?? []),...issues])];
  return {
    ...review,
    decision: review.decision === "BLOCKED" || review.decision === "QUARANTINE" ? review.decision : "RETRY",
    deterministicIssues: merged,
    reasons: [...review.reasons,...issues.map(x=>`deterministic:${x}`)].slice(0,12),
    revisionInstructions: `${review.revisionInstructions ? `${review.revisionInstructions}\n` : ""}Deterministic product gate issues must be fixed: ${issues.join(", ")}`.trim()
  };
}

export function deterministicProductReview(issues: string[]): QualityReview {
  return {
    decision:"RETRY",
    score:0,
    reasons:issues.map(x=>`deterministic:${x}`),
    revisionInstructions:`Fix deterministic product gate issues before AI QA: ${issues.join(", ")}`,
    reviewerModel:"deterministic-product-gate",
    deterministicIssues:[...issues],
    parseMode:"strict-json",
    rawReviewText:JSON.stringify({decision:"RETRY",issues})
  };
}
