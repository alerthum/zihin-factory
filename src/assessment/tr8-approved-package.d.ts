import type { HumanReviewInput } from "./tr8-human-review.js";

export type Tr8ApprovedPackageInput = {
  factoryVersion?: string;
  jobId: string;
  result: Record<string, unknown>;
  candidates: unknown[];
  reviews: HumanReviewInput[];
  exportedAt?: string;
};

export declare function buildTr8ApprovedPilotPackage(input: Tr8ApprovedPackageInput): Record<string, unknown>;
