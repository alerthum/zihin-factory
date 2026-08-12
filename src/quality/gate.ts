import { runNvidiaText } from "../providers/nvidia";
import { qaSystemPrompt } from "../agents/router";

export type QualityDecision = "PASS" | "RETRY" | "QUARANTINE" | "BLOCKED";

export type QualityReview = {
  decision: QualityDecision;
  score: number;
  reasons: string[];
  revisionInstructions: string;
  reviewerModel: string;
  deterministicIssues: string[];
  parseMode: "strict-json" | "repaired-json" | "field-fallback" | "unreadable";
  rawReviewText: string;
};

type QualityEnv = { NVIDIA_API_KEY: string };

function deterministicChecks(output: string): string[] {
  const issues: string[] = [];
  const trimmed = output.trim();
  if (trimmed.length < 180) issues.push("output_too_short");
  if (!/Outcome/i.test(trimmed)) issues.push("missing_outcome_section");
  if (!/Verification/i.test(trimmed)) issues.push("missing_verification_section");
  if (/\bI cannot\b|\bI can't\b|unable to assist/i.test(trimmed)) issues.push("refusal_or_non_delivery");
  if (/lorem ipsum/i.test(trimmed)) issues.push("placeholder_text");
  return issues;
}

function stripReasoningAndFences(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json|javascript|js)?/gi, "")
    .replace(/```/g, "")
    .trim();
}

function extractBalancedObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch as '"' | "'"; continue; }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function tryJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function repairJsonCandidate(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/([{,]\s*)(decision|score|reasons|revisionInstructions)\s*:/g, '$1"$2":');
}

function parseReviewObject(text: string): { parsed: Record<string, unknown> | null; mode: QualityReview["parseMode"] } {
  const cleaned = stripReasoningAndFences(text);
  const direct = tryJson(cleaned);
  if (direct) return { parsed: direct, mode: "strict-json" };

  const balanced = extractBalancedObject(cleaned);
  if (balanced) {
    const exact = tryJson(balanced);
    if (exact) return { parsed: exact, mode: "strict-json" };
    const repaired = tryJson(repairJsonCandidate(balanced));
    if (repaired) return { parsed: repaired, mode: "repaired-json" };
  }

  const decisionMatch = cleaned.match(/(?:"?decision"?|karar)\s*[:=\-]\s*["']?(PASS|RETRY|QUARANTINE|BLOCKED)\b/i)
    ?? cleaned.match(/\b(PASS|RETRY|QUARANTINE|BLOCKED)\b/i);
  const scoreMatch = cleaned.match(/(?:"?score"?|puan)\s*[:=\-]\s*["']?(\d+(?:\.\d+)?)/i);
  const revisionMatch = cleaned.match(/(?:"?revisionInstructions"?|revision instructions?|düzeltme(?: talimat(?:ı|ları)?)?)\s*[:=\-]\s*["']?([^\n\r}]{1,1000})/i);
  const reasonsMatch = cleaned.match(/(?:"?reasons"?|neden(?:ler)?)\s*[:=\-]\s*([^\n\r]{1,1200})/i);

  if (decisionMatch) {
    return {
      mode: "field-fallback",
      parsed: {
        decision: decisionMatch[1],
        score: scoreMatch ? Number(scoreMatch[1]) : 0,
        reasons: reasonsMatch ? [reasonsMatch[1].replace(/^\s*[\["']+|[\]"']+\s*$/g, "").trim()] : ["Reviewer response recovered from non-JSON format"],
        revisionInstructions: revisionMatch ? revisionMatch[1].replace(/["']+$/g, "").trim() : ""
      }
    };
  }

  return { parsed: null, mode: "unreadable" };
}

function normalizeDecision(value: unknown): QualityDecision {
  const upper = String(value ?? "").toUpperCase();
  if (upper === "PASS" || upper === "RETRY" || upper === "QUARANTINE" || upper === "BLOCKED") return upper;
  return "RETRY";
}

function normalizeScore(value: unknown): number {
  let score = Number(value);
  if (!Number.isFinite(score)) return 0;
  if (score > 0 && score <= 1) score *= 100;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export async function reviewOutput(
  env: QualityEnv,
  input: {
    objective: string;
    acceptanceCriteria: string[];
    producerRole: string;
    producerModel: string;
    output: string;
    attempt: number;
    onHeartbeat?: () => Promise<void> | void;
  }
): Promise<QualityReview> {
  const deterministicIssues = deterministicChecks(input.output);

  const prompt = `
Independently review the following factory artifact.

OBJECTIVE:
${input.objective}

ACCEPTANCE CRITERIA:
${input.acceptanceCriteria.map((x, i) => `${i + 1}. ${x}`).join("\n") || "1. Must materially satisfy the objective."}

PRODUCER ROLE: ${input.producerRole}
PRODUCER MODEL: ${input.producerModel}
ATTEMPT: ${input.attempt}
DETERMINISTIC ISSUES: ${JSON.stringify(deterministicIssues)}

ARTIFACT:
---
${input.output}
---

Do not explain your reasoning. Do not use markdown. Your entire response must be ONE JSON object and nothing else:
{"decision":"PASS|RETRY|QUARANTINE|BLOCKED","score":0,"reasons":["specific reason"],"revisionInstructions":"specific revision instructions or empty string"}

Score rule: score MUST be an integer from 0 to 100, never a 0-1 fraction.
Decision rules:
- PASS: all acceptance criteria are substantively met and no serious deterministic issue remains.
- RETRY: fixable quality problem; a revision can plausibly pass.
- QUARANTINE: unsafe/unreliable/structurally invalid or still weak after retries; preserve but do not publish.
- BLOCKED: cannot be completed without missing external data/access/decision; state exactly what is missing.
`;

  const response = await runNvidiaText(env, {
    system: `${qaSystemPrompt()}\nOUTPUT CONTRACT: Never emit chain-of-thought, <think> tags, markdown fences, or prose outside the requested JSON object.`,
    prompt,
    maxTokens: 360,
    temperature: 0,
    purpose: "reviewer",
    avoidModels: [input.producerModel],
    onHeartbeat: input.onHeartbeat
  });

  const parsedResult = parseReviewObject(response.content);
  const parsed = parsedResult.parsed;
  if (!parsed) {
    return {
      decision: "RETRY",
      score: 0,
      reasons: ["qa_json_parse_failed"],
      revisionInstructions: "Address every acceptance criterion explicitly and return a concise complete artifact; the independent reviewer response itself was not machine-readable.",
      reviewerModel: response.model,
      deterministicIssues,
      parseMode: "unreadable",
      rawReviewText: response.content.slice(0, 5000)
    };
  }

  const reasons = Array.isArray(parsed.reasons)
    ? parsed.reasons.map(String).filter(Boolean).slice(0, 8)
    : [String(parsed.reasons ?? "No reasons supplied")];

  let decision = normalizeDecision(parsed.decision);
  const score = normalizeScore(parsed.score);
  if (deterministicIssues.length > 0 && decision === "PASS") decision = "RETRY";
  if (score < 70 && decision === "PASS") decision = "RETRY";

  return {
    decision,
    score,
    reasons,
    revisionInstructions: String(parsed.revisionInstructions ?? ""),
    reviewerModel: response.model,
    deterministicIssues,
    parseMode: parsedResult.mode,
    rawReviewText: response.content.slice(0, 5000)
  };
}
