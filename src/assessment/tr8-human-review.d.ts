export type HumanReviewInput = {
  reviewId: string;
  batchId: string;
  questionId: string;
  reviewerAnonId: string;
  reviewerRole?: string;
  decision: "APPROVE" | "REVISE" | "REJECT";
  scores: Record<string, number>;
  criticalBlockers?: string[];
  notes?: string;
  reviewedAt: string;
};

export function normalizeTr8HumanReview(input: HumanReviewInput): Readonly<HumanReviewInput & {
  schemaVersion: "1.0";
  reviewerRole: string;
  criticalBlockers: readonly string[];
  notes: string;
}>;

export function summarizeTr8HumanReviews(rows: HumanReviewInput[], expectedQuestionIds: string[]): Readonly<{
  total: number;
  reviewed: number;
  accepted: number;
  acceptanceRate: number;
  coverageRate: number;
  complete: boolean;
  pilotEligible: boolean;
  acceptedQuestionIds: readonly string[];
  reviseQuestionIds: readonly string[];
  rejectedQuestionIds: readonly string[];
  pendingQuestionIds: readonly string[];
  unknownQuestionIds: readonly string[];
}>;
