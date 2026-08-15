import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTr8HumanReview, summarizeTr8HumanReviews } from "../src/assessment/tr8-human-review.js";

function review(questionId, index, decision = "APPROVE") {
  const score = decision === "APPROVE" ? 4 : 3;
  return {
    reviewId: `review-${index}`,
    batchId: "tr8-batch-001",
    questionId,
    reviewerAnonId: `reviewer_teacher_${String(index).padStart(2, "0")}`,
    reviewerRole: "TURKISH_TEACHER",
    decision,
    scores: {
      correctness: score,
      optionOrRubricQuality: score,
      ageLanguageFit: score,
      hintNonLeakage: score,
      feedbackTeachingValue: score,
      naturalness: score
    },
    criticalBlockers: decision === "APPROVE" ? [] : ["revision-needed"],
    notes: "Anonim uzman incelemesi.",
    reviewedAt: "2026-08-14T15:00:00.000Z"
  };
}

test("human review contract rejects personal information", () => {
  const input = { ...review("q1", 1), email: "teacher@example.test" };
  assert.throws(() => normalizeTr8HumanReview(input), /pii-forbidden:email/);
});

test("APPROVE cannot bypass a weak review dimension", () => {
  const input = review("q1", 1);
  input.scores.feedbackTeachingValue = 3;
  assert.throws(() => normalizeTr8HumanReview(input), /approve:quality-threshold-not-met/);
});

test("full twenty-question coverage with sixteen approvals reaches the calibration threshold", () => {
  const questionIds = Array.from({ length: 20 }, (_, index) => `q${index + 1}`);
  const rows = questionIds.map((id, index) => review(id, index, index < 16 ? "APPROVE" : "REVISE"));
  const summary = summarizeTr8HumanReviews(rows, questionIds);
  assert.equal(summary.complete, true);
  assert.equal(summary.acceptanceRate, 80);
  assert.equal(summary.pilotEligible, true);
  assert.equal(summary.acceptedQuestionIds.length, 16);
});

test("missing reviews keep the batch closed even when reviewed items are all approved", () => {
  const questionIds = ["q1", "q2", "q3"];
  const summary = summarizeTr8HumanReviews([review("q1", 1), review("q2", 2)], questionIds);
  assert.equal(summary.acceptanceRate, 100);
  assert.equal(summary.coverageRate, 66.7);
  assert.equal(summary.complete, false);
  assert.equal(summary.pilotEligible, false);
  assert.deepEqual(summary.pendingQuestionIds, ["q3"]);
});

test("multiple reviewers must all approve the same question", () => {
  const rows = [review("q1", 1), { ...review("q1", 2, "REVISE"), reviewerAnonId: "reviewer_teacher_second" }];
  const summary = summarizeTr8HumanReviews(rows, ["q1"]);
  assert.equal(summary.accepted, 0);
  assert.deepEqual(summary.reviseQuestionIds, ["q1"]);
});
