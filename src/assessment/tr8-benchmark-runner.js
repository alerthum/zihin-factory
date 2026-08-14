import {
  TR8_MAIN_IDEA_FAMILY_V1,
  blindReviewerPrompt,
  compileCandidate,
  generatorPrompt,
  generatorSystemPrompt,
  parseEngineeringReview,
  parseBlindResolution,
  parseGeneratedCandidate,
  reviewerPrompt,
  tr8DiversityPlan
} from "./tr8-paragraph-family.js";
import { auditTr8ParagraphBatch } from "./canonical-quality-core.js";

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
    const diversityPlan = tr8DiversityPlan(itemIndex);
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
            diversityPlan,
            revision
          })
        });
        const candidate = parseGeneratedCandidate(producer.content);
        const provisional = compileCandidate(candidate, {
          producerModel: producer.model,
          benchmarkExcerpts,
          diversityPlan
        });
        const deterministicIssues = provisional.audit.errors
          .filter((issue) => issue !== "independent-verification-required");
        const blindReviewer = await review({
          itemIndex,
          attempt,
          stage: "blind-resolution",
          producerModel: producer.model,
          system: "You are the independent blind assessment solver. You have not seen the author answer or rationale. Return strict JSON only.",
          prompt: blindReviewerPrompt({
            family: TR8_MAIN_IDEA_FAMILY_V1,
            canonical: provisional.canonical,
            deterministicIssues
          })
        });
        const blindResolution = parseBlindResolution(blindReviewer.content, {
          producerModel: producer.model,
          reviewerModel: blindReviewer.model
        });
        const reviewer = await review({
          itemIndex,
          attempt,
          stage: "quality-audit",
          producerModel: producer.model,
          blindReviewerModel: blindReviewer.model,
          system: "You are the independent assessment authoring-quality reviewer. The blind resolution is locked. Return strict JSON only.",
          prompt: reviewerPrompt({
            family: TR8_MAIN_IDEA_FAMILY_V1,
            canonical: provisional.canonical,
            deterministicIssues,
            blindResolution
          })
        });
        const engineeringReview = parseEngineeringReview(reviewer.content, {
          producerModel: producer.model,
          reviewerModel: reviewer.model,
          deterministicIssues,
          expectedCorrectIndex: candidate.correctIndex,
          requiredEvidenceIds: candidate.correctSupportEvidenceIds,
          blindResolution
        });

        if (engineeringReview.decision === "PASS") {
          const compiled = compileCandidate(candidate, {
            producerModel: producer.model,
            benchmarkExcerpts,
            diversityPlan,
            proof: {
              solverId: `${TR8_MAIN_IDEA_FAMILY_V1.familyId}:annotation-solver-v1`,
              independentVerifierId: `blind-model:${blindReviewer.model}|quality-model:${reviewer.model}`,
              verified: engineeringReview.independentlyResolved
            }
          });
          if (compiled.audit.ok) {
            finalInstance = Object.freeze({
              instanceId,
              status: "ENGINEERING_PASS",
              attempt,
              producerModel: producer.model,
              blindReviewerModel: blindReviewer.model,
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
          blindReviewerModel: blindReviewer.model,
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
  const canonicalQuestions = instances.map((instance) => instance?.canonical).filter(Boolean);
  const automatedBatchAudit = auditTr8ParagraphBatch(canonicalQuestions, [], { requiredSampleSize: boundedSampleSize });
  const possiblePairs = boundedSampleSize * (boundedSampleSize - 1) / 2;
  const uniqueAnswerCount = automatedBatchAudit.questionAudits
    .filter((audit) => Number.isInteger(audit.metrics.correctIndex) && audit.metrics.correctIndex >= 0).length;
  const explanationEvidenceCount = canonicalQuestions
    .filter((question) => Array.isArray(question.solutionGraph)
      && question.solutionGraph.length >= 3
      && question.solutionGraph.every((step) => String(step?.evidence ?? "").trim())).length;
  const automatedIssues = automatedBatchAudit.errors.filter((issue) =>
    !issue.startsWith("human-")
    && issue !== "human-review-contract-failures"
    && !issue.startsWith("review-for-unknown-question"));
  return Object.freeze({
    kind: "assessment.tr8-paragraph-benchmark",
    familyId: TR8_MAIN_IDEA_FAMILY_V1.familyId,
    batchId,
    sampleSize: boundedSampleSize,
    status: engineeringPassCount === boundedSampleSize && automatedIssues.length === 0
      ? "PENDING_HUMAN_REVIEW"
      : "ENGINEERING_INCOMPLETE",
    engineeringPassCount,
    engineeringPassRate: Number((engineeringPassCount / boundedSampleSize).toFixed(2)),
    quarantinedCount,
    automatedIssues: Object.freeze(automatedIssues),
    qualityEvidence: Object.freeze({
      sampleSize: boundedSampleSize,
      duplicateRate: possiblePairs
        ? Number((automatedBatchAudit.metrics.semanticDuplicatePairCount / possiblePairs * 100).toFixed(1))
        : 0,
      longestCorrectRate: Number((automatedBatchAudit.metrics.longestCorrectRate * 100).toFixed(1)),
      uniqueAnswerRate: Number((uniqueAnswerCount / boundedSampleSize * 100).toFixed(1)),
      explanationEvidenceRate: Number((explanationEvidenceCount / boundedSampleSize * 100).toFixed(1)),
      correctPositionCounts: automatedBatchAudit.metrics.correctPositionCounts,
      maximumObservedSimilarity: automatedBatchAudit.metrics.maximumObservedSimilarity,
      structuralDuplicatePairCount: automatedBatchAudit.metrics.structuralDuplicatePairCount,
      distinctDiversityPlanCount: automatedBatchAudit.metrics.distinctDiversityPlanCount,
      distinctDiscourseStructureCount: automatedBatchAudit.metrics.distinctDiscourseStructureCount,
      distinctReasoningPathCount: automatedBatchAudit.metrics.distinctReasoningPathCount,
      distinctGenreCount: automatedBatchAudit.metrics.distinctGenreCount,
      maximumDiscourseStructureShare: automatedBatchAudit.metrics.maximumDiscourseStructureShare,
      maximumReasoningPathShare: automatedBatchAudit.metrics.maximumReasoningPathShare
    }),
    instances: Object.freeze(instances)
  });
}
