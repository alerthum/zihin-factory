import { auditTr8ParagraphBatch, HUMAN_REVIEW_DIMENSIONS } from "./canonical-quality-core.js";

function text(value, field) {
  const output = String(value ?? "").trim();
  if (!output) throw new Error(`${field}:required`);
  return output;
}

function deepFreeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreeze));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, deepFreeze(entry)]))
    );
  }
  return value;
}

function approvedQuestion(question, batchId) {
  const cloned = structuredClone(question);
  return deepFreeze({
    ...cloned,
    content: {
      ...cloned.content,
      humanReview: {
        status: "APPROVED",
        batchId,
        gameAdaptationAllowed: true
      }
    },
    contentStatus: "PILOT_READY"
  });
}

function publicReviewEvidence(questionId, normalizedReviews) {
  const rows = normalizedReviews.filter((review) => review.questionId === questionId);
  const minimumScores = Object.fromEntries(HUMAN_REVIEW_DIMENSIONS.map((dimension) => [
    dimension,
    Math.min(...rows.map((review) => review.scores[dimension]))
  ]));
  return deepFreeze({
    questionId,
    reviewerCount: rows.length,
    reviewerRoles: [...new Set(rows.map((review) => review.reviewerRole))],
    decisions: [...new Set(rows.map((review) => review.decision))],
    minimumScores
  });
}

export function buildTr8ApprovedPilotPackage({
  factoryVersion = "unknown",
  jobId,
  result = {},
  candidates = [],
  reviews = [],
  exportedAt = new Date().toISOString()
} = {}) {
  const safeJobId = text(jobId, "jobId");
  const batchId = text(result.batchId, "result.batchId");
  const blockers = [];
  if (result.kind !== "assessment.tr8-paragraph-benchmark") blockers.push("wrong-job-kind");
  if (Number(result.sampleSize) !== 20) blockers.push("twenty-question-calibration-required");
  if (result.status !== "PENDING_HUMAN_REVIEW") blockers.push("engineering-status-not-reviewable");
  if (Number(result.engineeringPassCount) !== 20) blockers.push("engineering-pass-count-not-twenty");
  if (Array.isArray(result.automatedIssues) && result.automatedIssues.length) blockers.push("automated-issues-present");
  if (!Array.isArray(candidates) || candidates.length !== 20) blockers.push("twenty-canonical-candidates-required");
  if (blockers.length) throw new Error(`pilot-export-blocked:${blockers.join(",")}`);

  const audit = auditTr8ParagraphBatch(candidates, reviews, { requiredSampleSize: 20 });
  if (!audit.ok || !audit.pilotReady) {
    throw new Error(`pilot-export-blocked:${audit.errors.join(",")}`);
  }

  const acceptedIds = new Set(audit.exportableQuestionIds);
  const questions = audit.questionAudits
    .map((questionAudit) => questionAudit.question)
    .filter((question) => question && acceptedIds.has(question.id))
    .map((question) => approvedQuestion(question, batchId));
  if (questions.length < 16 || questions.length !== acceptedIds.size) {
    throw new Error("pilot-export-blocked:accepted-question-materialization-mismatch");
  }

  const reviewEvidence = questions.map((question) => publicReviewEvidence(question.id, audit.reviewAudit.rows));
  return deepFreeze({
    schemaVersion: "1.0",
    kind: "zihin-factory-approved-tr8-paragraph-pilot",
    source: {
      repository: "alerthum/zihin-factory",
      factoryVersion: String(factoryVersion),
      jobId: safeJobId,
      batchId
    },
    target: {
      repository: "alerthum/KuzenlerYarisiyor",
      grade: 8,
      courseId: "turkce",
      gameId: "paragraph-detective",
      familyId: String(result.familyId ?? "tr8-turkish-main-idea-v1")
    },
    releaseGate: {
      engineeringPassCount: Number(result.engineeringPassCount),
      humanReviewCount: audit.metrics.humanReviewCount,
      humanDecisionCount: audit.metrics.humanDecisionCount,
      humanApprovalCount: audit.metrics.humanApprovalCount,
      humanApprovalRate: audit.metrics.humanApprovalRate,
      exportableQuestionCount: questions.length,
      completeCoverage: audit.metrics.humanReviewCount === 20,
      pilotEligible: true
    },
    qualityEvidence: {
      ...(result.qualityEvidence && typeof result.qualityEvidence === "object" ? result.qualityEvidence : {}),
      correctPositionCounts: audit.metrics.correctPositionCounts,
      longestCorrectRate: audit.metrics.longestCorrectRate,
      semanticDuplicatePairCount: audit.metrics.semanticDuplicatePairCount,
      maximumObservedSimilarity: audit.metrics.maximumObservedSimilarity
    },
    approvedQuestionIds: [...audit.exportableQuestionIds],
    reviewEvidence,
    questions,
    exportedAt: new Date(exportedAt).toISOString()
  });
}
