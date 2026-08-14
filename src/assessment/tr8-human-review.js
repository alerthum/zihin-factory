import { defineHumanReviewDecision } from "./canonical-quality-core.js";

export function normalizeTr8HumanReview(input = {}) {
  return defineHumanReviewDecision(input);
}

export function summarizeTr8HumanReviews(rows = [], expectedQuestionIds = []) {
  const expected = new Set(expectedQuestionIds.map(String));
  const reviewsByQuestion = new Map();
  const unknownQuestionIds = new Set();
  for (const input of rows) {
    const review = normalizeTr8HumanReview(input);
    if (expected.size && !expected.has(review.questionId)) unknownQuestionIds.add(review.questionId);
    const questionReviews = reviewsByQuestion.get(review.questionId) || [];
    questionReviews.push(review);
    reviewsByQuestion.set(review.questionId, questionReviews);
  }

  const expectedIds = expected.size ? [...expected] : [...reviewsByQuestion.keys()];
  const reviewedQuestionIds = expectedIds.filter((id) => reviewsByQuestion.has(id));
  const acceptedQuestionIds = reviewedQuestionIds.filter((id) =>
    reviewsByQuestion.get(id).every((review) => review.decision === "APPROVE"));
  const reviseQuestionIds = reviewedQuestionIds.filter((id) =>
    reviewsByQuestion.get(id).some((review) => review.decision === "REVISE"));
  const rejectedQuestionIds = reviewedQuestionIds.filter((id) =>
    reviewsByQuestion.get(id).some((review) => review.decision === "REJECT"));
  const pendingQuestionIds = expectedIds.filter((id) => !reviewsByQuestion.has(id));
  const total = expectedIds.length;
  const reviewed = reviewedQuestionIds.length;
  const accepted = acceptedQuestionIds.length;
  const acceptanceRate = reviewed ? accepted / reviewed : 0;
  const coverageRate = total ? reviewed / total : 0;
  const complete = total > 0 && reviewed === total && unknownQuestionIds.size === 0;

  return Object.freeze({
    total,
    reviewed,
    accepted,
    acceptanceRate: Number((acceptanceRate * 100).toFixed(1)),
    coverageRate: Number((coverageRate * 100).toFixed(1)),
    complete,
    pilotEligible: complete && acceptanceRate >= 0.8,
    acceptedQuestionIds: Object.freeze(acceptedQuestionIds),
    reviseQuestionIds: Object.freeze(reviseQuestionIds),
    rejectedQuestionIds: Object.freeze(rejectedQuestionIds),
    pendingQuestionIds: Object.freeze(pendingQuestionIds),
    unknownQuestionIds: Object.freeze([...unknownQuestionIds])
  });
}
