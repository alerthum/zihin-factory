export type ProviderResult = { model: string; content: string };

export type BenchmarkInstance = {
  instanceId: string;
  status: "ENGINEERING_PASS" | "RETRY_EXHAUSTED" | "QUARANTINED";
  attempt: number;
  producerModel?: string;
  blindReviewerModel?: string;
  reviewerModel?: string;
  canonical?: unknown;
  audit?: { ok: boolean; errors: readonly string[]; metrics: unknown };
  engineeringReview?: { decision: string; score: number; reasons: readonly string[] };
  error?: string;
};

export type BenchmarkResult = {
  kind: "assessment.tr8-paragraph-benchmark";
  familyId: string;
  batchId: string;
  sampleSize: number;
  status: "PENDING_HUMAN_REVIEW" | "ENGINEERING_INCOMPLETE";
  engineeringPassCount: number;
  engineeringPassRate: number;
  quarantinedCount: number;
  automatedIssues: readonly string[];
  qualityEvidence: {
    sampleSize: number;
    duplicateRate: number;
    longestCorrectRate: number;
    uniqueAnswerRate: number;
    explanationEvidenceRate: number;
    correctPositionCounts: readonly number[];
    maximumObservedSimilarity: number;
    structuralDuplicatePairCount: number;
    distinctDiversityPlanCount: number;
    distinctDiscourseStructureCount: number;
    distinctReasoningPathCount: number;
    distinctGenreCount: number;
    maximumDiscourseStructureShare: number;
    maximumReasoningPathShare: number;
  };
  instances: readonly BenchmarkInstance[];
};

export function runTr8Benchmark(input: {
  sampleSize?: number;
  maxAttempts?: number;
  batchId?: string;
  themes?: string[];
  morphologyNotes?: string[];
  benchmarkExcerpts?: string[];
  produce(input: { itemIndex: number; attempt: number; system: string; prompt: string }): Promise<ProviderResult>;
  review(input: { itemIndex: number; attempt: number; stage: "blind-resolution" | "quality-audit"; producerModel: string; blindReviewerModel?: string; system: string; prompt: string }): Promise<ProviderResult>;
}): Promise<BenchmarkResult>;
