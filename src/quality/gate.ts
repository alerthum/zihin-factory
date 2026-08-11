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

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    const direct = JSON.parse(cleaned);
    return direct && typeof direct === "object" ? direct as Record<string, unknown> : null;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const sliced = JSON.parse(cleaned.slice(start, end + 1));
        return sliced && typeof sliced === "object" ? sliced as Record<string, unknown> : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeDecision(value: unknown): QualityDecision {
  const upper = String(value ?? "").toUpperCase();
  if (upper === "PASS" || upper === "RETRY" || upper === "QUARANTINE" || upper === "BLOCKED") {
    return upper;
  }
  return "RETRY";
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

Return ONLY valid JSON with this exact shape:
{
  "decision": "PASS|RETRY|QUARANTINE|BLOCKED",
  "score": 0,
  "reasons": ["specific reason"],
  "revisionInstructions": "specific revision instructions or empty string"
}

Decision rules:
- PASS: all acceptance criteria are substantively met and no serious deterministic issue remains.
- RETRY: fixable quality problem; a revision can plausibly pass.
- QUARANTINE: output is unsafe/unreliable/structurally invalid or still weak after retries; preserve for inspection, do not publish.
- BLOCKED: task cannot be completed without missing external data/access/decision. State exactly what is missing.
`;

  const response = await runNvidiaText(env, {
    system: qaSystemPrompt(),
    prompt,
    maxTokens: 700,
    temperature: 0.05,
    purpose: "reviewer",
    avoidModels: [input.producerModel]
  });

  const parsed = parseJsonObject(response.content);
  if (!parsed) {
    return {
      decision: "RETRY",
      score: 0,
      reasons: ["qa_json_parse_failed"],
      revisionInstructions: "Return a more explicit, complete artifact matching every acceptance criterion.",
      reviewerModel: response.model,
      deterministicIssues
    };
  }

  const scoreRaw = Number(parsed.score);
  const reasons = Array.isArray(parsed.reasons)
    ? parsed.reasons.map(String).slice(0, 8)
    : [String(parsed.reasons ?? "No reasons supplied")];

  let decision = normalizeDecision(parsed.decision);
  const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, scoreRaw)) : 0;

  if (deterministicIssues.length > 0 && decision === "PASS") decision = "RETRY";
  if (score < 70 && decision === "PASS") decision = "RETRY";

  return {
    decision,
    score,
    reasons,
    revisionInstructions: String(parsed.revisionInstructions ?? ""),
    reviewerModel: response.model,
    deterministicIssues
  };
}
