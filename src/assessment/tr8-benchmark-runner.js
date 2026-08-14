import {
  TR8_MAIN_IDEA_FAMILY_V1,
  compileCandidate,
  generatorPrompt,
  generatorSystemPrompt,
  parseEngineeringReview,
  parseGeneratedCandidate,
  reviewerPrompt
} from "./tr8-paragraph-family.js";

function boundedInteger(value, minimum, maximum, field) {
  const output = Number(value);
  if (!Number.isInteger(output) || output < minimum || output > maximum) {
    throw new Error(`${field}:must-be-${minimum}-${maximum}`);
  }
  return output;
}

function publicError(error) {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}

export async function runTr8Benchmark({
  sampleSize = 2,
  maxAttempts = 2,
  batchId = "tr8-smoke",
  themes = [],
  morphologyNotes = [],
  benchmarkExcerpts = [],
  produce,
  review
} = {}) {
  const boundedSampleSize = boundedInteger(sampleSize, 1, 20, "sampleSize");
  const boundedAttempts = boundedInteger(maxAttempts, 1, 2, "maxAttempts");
  if (typeof produce !== "function") throw new Error("produce:function-required");
  if (typeof review !== "function") throw new Error("review:function-required");

  const instances = [];
  for (let itemIndex = 0; itemIndex < boundedSampleSize; itemIndex += 1) {
    const instanceId = `${batchId}-item-${String(itemIndex + 1).padStart(2, "0")}`;
    let revision = "";
    let finalInstance = null;
    for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
      try {
        const producer = await produce({
          itemIndex,
          attempt,
          system: generatorSystemPrompt(),
          prompt: generatorPrompt({
            instanceId,
            theme: themes[itemIndex % Math.max(1, themes.length)] || undefined,
            morphologyNotes,
            revision
          })
        });
        const candidate = parseGeneratedCandidate(producer.content);
        const provisional = compileCandidate(candidate, {
          producerModel: producer.model,
          benchmarkExcerpts
        });
        const deterministicIssues = provisional.audit.errors
          .filter((issue) => issue !== "independent-verification-required");
        const reviewer = await review({
          itemIndex,
          attempt,
          producerModel: producer.model,
          prompt: reviewerPrompt({
            family: TR8_MAIN_IDEA_FAMILY_V1,
            canonical: provisional.canonical,
            deterministicIssues
          })
        });
        const engineeringReview = parseEngineeringReview(reviewer.content, {
          producerModel: producer.model,
          reviewerModel: reviewer.model,
          deterministicIssues,
          expectedCorrectIndex: candidate.correctIndex,
          requiredEvidenceIds: candidate.correctSupportEvidenceIds
        });

        if (engineeringReview.decision === "PASS") {
          const compiled = compileCandidate(candidate, {
            producerModel: producer.model,
            benchmarkExcerpts,
            proof: {
              solverId: `${TR8_MAIN_IDEA_FAMILY_V1.familyId}:annotation-solver-v1`,
              independentVerifierId: `independent-model:${reviewer.model}`,
              verified: engineeringReview.independentlyResolved
            }
          });
          if (compiled.audit.ok) {
            finalInstance = Object.freeze({
              instanceId,
              status: "ENGINEERING_PASS",
              attempt,
              producerModel: producer.model,
              reviewerModel: reviewer.model,
              canonical: compiled.canonical,
              audit: compiled.audit,
              engineeringReview
            });
            break;
          }
        }

        revision = engineeringReview.revisionInstructions || engineeringReview.reasons.join("; ");
        finalInstance = Object.freeze({
          instanceId,
          status: engineeringReview.decision === "QUARANTINE" ? "QUARANTINED" : "RETRY_EXHAUSTED",
          attempt,
          producerModel: producer.model,
          reviewerModel: reviewer.model,
          audit: provisional.audit,
          engineeringReview
        });
        if (engineeringReview.decision === "QUARANTINE") break;
      } catch (error) {
        revision = publicError(error);
        finalInstance = Object.freeze({
          instanceId,
          status: "RETRY_EXHAUSTED",
          attempt,
          error: revision
        });
      }
    }
    instances.push(finalInstance);
  }

  const engineeringPassCount = instances.filter((instance) => instance?.status === "ENGINEERING_PASS").length;
  const quarantinedCount = instances.filter((instance) => instance?.status === "QUARANTINED").length;
  return Object.freeze({
    kind: "assessment.tr8-paragraph-benchmark",
    familyId: TR8_MAIN_IDEA_FAMILY_V1.familyId,
    batchId,
    sampleSize: boundedSampleSize,
    status: engineeringPassCount === boundedSampleSize ? "PENDING_HUMAN_REVIEW" : "ENGINEERING_INCOMPLETE",
    engineeringPassCount,
    engineeringPassRate: Number((engineeringPassCount / boundedSampleSize).toFixed(2)),
    quarantinedCount,
    instances: Object.freeze(instances)
  });
}
