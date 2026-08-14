const ITEM_FORMATS = new Set([
  "single-choice",
  "multiple-select",
  "short-answer",
  "open-response",
  "ordering",
  "matching",
  "drag-drop",
  "interactive-simulation"
]);

const CONTENT_STATUSES = new Set([
  "DRAFT",
  "ENGINEERING_VERIFIED",
  "HUMAN_REVIEW_REQUIRED",
  "PILOT_READY",
  "PUBLISHED",
  "REJECTED"
]);

const REVIEW_DECISIONS = new Set(["APPROVE", "REVISE", "REJECT"]);
const HUMAN_REVIEW_DIMENSIONS = Object.freeze([
  "correctness",
  "optionOrRubricQuality",
  "ageLanguageFit",
  "hintNonLeakage",
  "feedbackTeachingValue",
  "naturalness"
]);
const PII_KEYS = new Set(["name", "fullName", "email", "phone", "address", "nationalId", "tcKimlik"]);
const TURKISH_STOP_WORDS = new Set([
  "acaba", "ancak", "baska", "bazen", "bile", "bunun", "daha", "gibi", "icin", "olan",
  "olarak", "oldugu", "sonra", "tarafindan", "uzere", "veya", "yalniz", "yerine"
]);

function requiredText(value, field, id = "canonical-question") {
  const output = String(value ?? "").trim();
  if (!output) throw new Error(`${id}: ${field} is required`);
  return output;
}

function requiredList(value, field, minimum, id) {
  if (!Array.isArray(value) || value.length < minimum) {
    throw new Error(`${id}: ${field} requires at least ${minimum}`);
  }
  return Object.freeze(value.map((entry) => typeof entry === "string"
    ? requiredText(entry, field, id)
    : Object.freeze(structuredClone(entry))));
}

function piiErrors(value, path = "") {
  if (!value || typeof value !== "object") return [];
  const errors = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (PII_KEYS.has(key)) errors.push(`pii-forbidden:${childPath}`);
    errors.push(...piiErrors(child, childPath));
  }
  return errors;
}

function reviewScore(value, field) {
  const output = Number(value);
  if (!Number.isInteger(output) || output < 1 || output > 5) {
    throw new Error(`${field}:must-be-1-5`);
  }
  return output;
}

function normalize(value) {
  return String(value ?? "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value) {
  return String(value ?? "").trim().split(/\s+/u).filter(Boolean);
}

function optionId(option, index) {
  return typeof option === "object" && option !== null && option.id != null
    ? String(option.id)
    : String.fromCharCode(65 + index);
}

function optionText(option) {
  return typeof option === "object" && option !== null ? String(option.text ?? "") : String(option ?? "");
}

function correctOptionIndex(question, options) {
  if (Number.isInteger(question.answerKey?.correctIndex)) return question.answerKey.correctIndex;
  if (question.answerKey?.optionId != null) {
    return options.findIndex((option, index) => optionId(option, index) === String(question.answerKey.optionId));
  }
  return -1;
}

function feedbackOptionIndex(feedback, options) {
  if (Number.isInteger(feedback?.optionIndex)) return feedback.optionIndex;
  if (feedback?.optionId != null) {
    return options.findIndex((option, index) => optionId(option, index) === String(feedback.optionId));
  }
  return -1;
}

function meaningfulTokens(value) {
  return new Set(normalize(value).split(" ").filter((token) => token.length >= 4 && !TURKISH_STOP_WORDS.has(token)));
}

function jaccard(left, right) {
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function questionSurface(question) {
  const options = Array.isArray(question.content?.options) ? question.content.options : [];
  return [question.content?.stimulus, question.content?.stem, ...options.map(optionText)].join(" ");
}

function longestSharedPhraseWords(left, right, upperBound = 14) {
  const leftWords = normalize(left).split(" ").filter(Boolean);
  const rightText = ` ${normalize(right)} `;
  for (let length = Math.min(upperBound, leftWords.length); length > 0; length -= 1) {
    for (let index = 0; index + length <= leftWords.length; index += 1) {
      if (rightText.includes(` ${leftWords.slice(index, index + length).join(" ")} `)) return length;
    }
  }
  return 0;
}

export function defineCanonicalQuestion(input = {}) {
  const id = requiredText(input.id, "id");
  const itemFormat = requiredText(input.itemFormat, "itemFormat", id);
  const contentStatus = requiredText(input.contentStatus || "DRAFT", "contentStatus", id);
  if (!ITEM_FORMATS.has(itemFormat)) throw new Error(`${id}: unsupported itemFormat ${itemFormat}`);
  if (!CONTENT_STATUSES.has(contentStatus)) throw new Error(`${id}: unsupported contentStatus ${contentStatus}`);

  const curriculum = Object.freeze({
    country: requiredText(input.curriculum?.country || "TR", "curriculum.country", id),
    schoolYear: requiredText(input.curriculum?.schoolYear, "curriculum.schoolYear", id),
    programFamily: requiredText(input.curriculum?.programFamily, "curriculum.programFamily", id),
    grade: Number(input.curriculum?.grade),
    courseId: requiredText(input.curriculum?.courseId, "curriculum.courseId", id),
    unitId: requiredText(input.curriculum?.unitId, "curriculum.unitId", id),
    topicId: requiredText(input.curriculum?.topicId, "curriculum.topicId", id),
    outcomeIds: requiredList(input.curriculum?.outcomeIds, "curriculum.outcomeIds", 1, id),
    sourceIds: requiredList(input.curriculum?.sourceIds, "curriculum.sourceIds", 1, id)
  });
  if (!Number.isInteger(curriculum.grade) || curriculum.grade < 1 || curriculum.grade > 12) {
    throw new Error(`${id}: curriculum.grade must be 1-12`);
  }

  const construct = Object.freeze({
    primarySkill: requiredText(input.construct?.primarySkill, "construct.primarySkill", id),
    secondarySkills: Object.freeze([...(input.construct?.secondarySkills || [])]
      .map((value) => requiredText(value, "construct.secondarySkills", id))),
    cognitiveProcess: requiredText(input.construct?.cognitiveProcess, "construct.cognitiveProcess", id),
    knowledgeComponents: requiredList(input.construct?.knowledgeComponents, "construct.knowledgeComponents", 1, id),
    intendedDifficultyBand: requiredText(input.construct?.intendedDifficultyBand, "construct.intendedDifficultyBand", id)
  });

  const optionFeedback = itemFormat === "single-choice" || itemFormat === "multiple-select"
    ? requiredList(input.optionFeedback, "optionFeedback", 2, id)
    : Object.freeze([...(input.optionFeedback || [])]);

  return Object.freeze({
    schemaVersion: "3.0",
    id,
    curriculum,
    construct,
    content: Object.freeze(structuredClone(input.content || {})),
    itemFormat,
    responseModel: Object.freeze(structuredClone(input.responseModel || {})),
    answerKey: Object.freeze(structuredClone(input.answerKey || {})),
    solutionGraph: requiredList(input.solutionGraph, "solutionGraph", 2, id),
    hints: requiredList(input.hints, "hints", 2, id),
    optionFeedback,
    misconceptionIds: requiredList(input.misconceptionIds, "misconceptionIds", 1, id),
    verifier: Object.freeze({
      solverId: requiredText(input.verifier?.solverId, "verifier.solverId", id),
      independentVerifierId: requiredText(input.verifier?.independentVerifierId, "verifier.independentVerifierId", id),
      verified: input.verifier?.verified === true
    }),
    styleProfile: Object.freeze(structuredClone(input.styleProfile || {})),
    provenance: Object.freeze({
      generatedFromSourceIds: Object.freeze([...(input.provenance?.generatedFromSourceIds || [])]),
      styleReferenceIds: Object.freeze([...(input.provenance?.styleReferenceIds || [])]),
      copiedText: false
    }),
    contentStatus,
    gameBindings: Object.freeze([])
  });
}

export function defineHumanReviewDecision(input = {}) {
  const pii = piiErrors(input);
  if (pii.length) throw new Error(pii.join(","));
  const decision = requiredText(input.decision, "decision");
  if (!REVIEW_DECISIONS.has(decision)) throw new Error("decision:unsupported");
  const reviewerAnonId = requiredText(input.reviewerAnonId, "reviewerAnonId");
  if (!/^reviewer_[a-z0-9_-]{6,80}$/i.test(reviewerAnonId)) throw new Error("reviewerAnonId:not-anonymous");
  const scores = Object.fromEntries(HUMAN_REVIEW_DIMENSIONS
    .map((dimension) => [dimension, reviewScore(input.scores?.[dimension], `scores.${dimension}`)]));
  const criticalBlockers = Object.freeze([...(input.criticalBlockers || [])].map(String).filter(Boolean));
  if (decision === "APPROVE" && (criticalBlockers.length || Object.values(scores).some((value) => value < 4))) {
    throw new Error("approve:quality-threshold-not-met");
  }
  const reviewedAt = requiredText(input.reviewedAt, "reviewedAt");
  if (!Number.isFinite(Date.parse(reviewedAt))) throw new Error("reviewedAt:invalid");
  return Object.freeze({
    schemaVersion: "1.0",
    reviewId: requiredText(input.reviewId, "reviewId"),
    batchId: requiredText(input.batchId, "batchId"),
    questionId: requiredText(input.questionId, "questionId"),
    reviewerAnonId,
    reviewerRole: requiredText(input.reviewerRole || "CONTENT_REVIEWER", "reviewerRole"),
    decision,
    scores: Object.freeze(scores),
    criticalBlockers,
    notes: String(input.notes || "").trim(),
    reviewedAt
  });
}

export function auditHumanReviewDecisions(rows = []) {
  const errors = [];
  const normalizedRows = [];
  rows.forEach((row, index) => {
    try {
      normalizedRows.push(defineHumanReviewDecision(row));
    } catch (error) {
      errors.push(`${index}:${error.message}`);
    }
  });
  if (new Set(normalizedRows.map((row) => row.reviewId)).size !== normalizedRows.length) {
    errors.push("duplicate-review-id");
  }
  const reviewerQuestionPairs = normalizedRows.map((row) => `${row.questionId}:${row.reviewerAnonId}`);
  if (new Set(reviewerQuestionPairs).size !== reviewerQuestionPairs.length) {
    errors.push("duplicate-reviewer-question");
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), rows: Object.freeze(normalizedRows) });
}

export function auditTr8ParagraphQuestion(input, config = {}) {
  const limits = {
    stimulusWords: config.stimulusWords || [95, 155],
    optionWords: config.optionWords || [7, 18],
    minimumFeedbackCharacters: config.minimumFeedbackCharacters || 45,
    maximumCorrectLengthRatio: config.maximumCorrectLengthRatio || 1.4,
    maximumHintAnswerOverlap: config.maximumHintAnswerOverlap || 0.72,
    maximumSharedBenchmarkPhraseWords: config.maximumSharedBenchmarkPhraseWords || 5,
    benchmarkExcerpts: Array.isArray(config.benchmarkExcerpts) ? config.benchmarkExcerpts : []
  };
  const errors = [];
  let question;
  try {
    question = defineCanonicalQuestion(input);
  } catch (error) {
    return Object.freeze({ ok: false, errors: Object.freeze([`contract:${error.message}`]), metrics: Object.freeze({}) });
  }

  if (question.curriculum.grade !== 8) errors.push("grade-must-be-8");
  if (normalize(question.curriculum.courseId) !== "turkce") errors.push("course-must-be-turkce");
  if (question.itemFormat !== "single-choice") errors.push("item-format-must-be-single-choice");

  const diversityFields = ["diversityPlanId", "discourseStructureId", "reasoningPathId", "genreId"];
  for (const field of diversityFields) {
    if (!String(question.styleProfile?.[field] ?? "").trim()) errors.push(`structural-diversity-missing:${field}`);
  }

  const stimulusWordCount = words(question.content?.stimulus).length;
  if (stimulusWordCount < limits.stimulusWords[0] || stimulusWordCount > limits.stimulusWords[1]) {
    errors.push(`stimulus-word-count:${stimulusWordCount}`);
  }
  if (!String(question.content?.stem ?? "").trim()) errors.push("stem-required");

  const options = Array.isArray(question.content?.options) ? question.content.options : [];
  if (options.length !== 4) errors.push("option-count-must-be-4");
  const optionTexts = options.map(optionText);
  const normalizedOptions = optionTexts.map(normalize);
  if (normalizedOptions.some((value) => !value)) errors.push("empty-option");
  if (new Set(normalizedOptions).size !== normalizedOptions.length) errors.push("duplicate-options");
  const optionWordCounts = optionTexts.map((value) => words(value).length);
  optionWordCounts.forEach((count, index) => {
    if (count < limits.optionWords[0] || count > limits.optionWords[1]) errors.push(`option-${index}-word-count:${count}`);
  });

  const correctIndex = correctOptionIndex(question, options);
  if (correctIndex < 0 || correctIndex >= options.length) errors.push("correct-option-unresolved");
  const distractorLengths = optionWordCounts.filter((_, index) => index !== correctIndex).sort((a, b) => a - b);
  const distractorMedian = distractorLengths.length ? distractorLengths[Math.floor(distractorLengths.length / 2)] : 0;
  const correctLengthRatio = distractorMedian > 0 ? optionWordCounts[correctIndex] / distractorMedian : 0;
  const correctIsUniqueLongest = correctIndex >= 0
    && optionWordCounts[correctIndex] === Math.max(...optionWordCounts)
    && optionWordCounts.filter((value) => value === optionWordCounts[correctIndex]).length === 1;
  if (correctIsUniqueLongest && correctLengthRatio > limits.maximumCorrectLengthRatio) {
    errors.push("correct-option-length-giveaway");
  }

  const feedbackByOption = new Map();
  for (const feedback of question.optionFeedback) {
    const index = feedbackOptionIndex(feedback, options);
    if (index >= 0) feedbackByOption.set(index, feedback);
  }
  if (feedbackByOption.size !== 4) errors.push("feedback-must-cover-four-options");
  const distractorMisconceptions = [];
  for (let index = 0; index < options.length; index += 1) {
    const feedback = feedbackByOption.get(index);
    if (!feedback) continue;
    const shouldBeCorrect = index === correctIndex;
    if (feedback.correct !== shouldBeCorrect) errors.push(`feedback-correctness-mismatch:${index}`);
    if (!shouldBeCorrect) {
      const misconceptionId = String(feedback.misconceptionId ?? "").trim();
      if (!misconceptionId) errors.push(`distractor-misconception-missing:${index}`);
      else distractorMisconceptions.push(misconceptionId);
      if (String(feedback.text ?? "").trim().length < limits.minimumFeedbackCharacters) {
        errors.push(`distractor-feedback-too-short:${index}`);
      }
      if (!Array.isArray(feedback.supportingEvidenceIds) || feedback.supportingEvidenceIds.length === 0) {
        errors.push(`distractor-evidence-missing:${index}`);
      }
    }
  }
  if (new Set(distractorMisconceptions).size !== 3) errors.push("distractor-misconceptions-must-be-distinct");
  const declaredMisconceptions = new Set(question.misconceptionIds.map(String));
  if (distractorMisconceptions.some((value) => !declaredMisconceptions.has(value))) {
    errors.push("undeclared-distractor-misconception");
  }

  if (question.solutionGraph.length < 3) errors.push("solution-graph-needs-three-steps");
  if (question.solutionGraph.some((step) => !String(step?.evidence ?? "").trim())) {
    errors.push("solution-step-evidence-missing");
  }
  if (question.hints.length < 3) errors.push("three-progressive-hints-required");
  const normalizedHints = question.hints.map((hint) => normalize(hint?.text ?? hint));
  if (new Set(normalizedHints).size !== normalizedHints.length) errors.push("duplicate-hints");
  if (question.hints.some((hint) => hint?.revealsAnswer === true)) errors.push("hint-declares-answer-reveal");
  const correctTokens = meaningfulTokens(optionTexts[correctIndex] || "");
  const maximumHintAnswerOverlap = normalizedHints.reduce((maximum, hint) => {
    return Math.max(maximum, jaccard(meaningfulTokens(hint), correctTokens));
  }, 0);
  if (maximumHintAnswerOverlap > limits.maximumHintAnswerOverlap) errors.push("hint-answer-leakage");

  if (!question.verifier.verified) errors.push("independent-verification-required");
  if (question.verifier.solverId === question.verifier.independentVerifierId) {
    errors.push("solver-and-verifier-must-differ");
  }
  const maximumSharedBenchmarkPhraseWords = limits.benchmarkExcerpts.reduce((maximum, excerpt) => {
    return Math.max(maximum, longestSharedPhraseWords(excerpt, questionSurface(question)));
  }, 0);
  if (maximumSharedBenchmarkPhraseWords > limits.maximumSharedBenchmarkPhraseWords) {
    errors.push("benchmark-wording-overlap");
  }

  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze([...new Set(errors)]),
    question,
    metrics: Object.freeze({
      stimulusWordCount,
      optionWordCounts: Object.freeze(optionWordCounts),
      correctIndex,
      correctIsUniqueLongest,
      correctLengthRatio: Number(correctLengthRatio.toFixed(2)),
      distinctDistractorMisconceptions: new Set(distractorMisconceptions).size,
      maximumHintAnswerOverlap: Number(maximumHintAnswerOverlap.toFixed(2)),
      maximumSharedBenchmarkPhraseWords,
      diversityPlanId: String(question.styleProfile?.diversityPlanId ?? ""),
      discourseStructureId: String(question.styleProfile?.discourseStructureId ?? ""),
      reasoningPathId: String(question.styleProfile?.reasoningPathId ?? ""),
      genreId: String(question.styleProfile?.genreId ?? "")
    })
  });
}

export function auditTr8ParagraphBatch(inputs = [], reviews = [], config = {}) {
  const requiredSampleSize = config.requiredSampleSize ?? 20;
  const minimumHumanApprovalRate = config.minimumHumanApprovalRate ?? 0.8;
  const maximumLongestCorrectRate = config.maximumLongestCorrectRate ?? 0.35;
  const maximumSemanticSimilarity = config.maximumSemanticSimilarity ?? 0.9;
  const errors = [];
  const questionAudits = inputs.map((input) => auditTr8ParagraphQuestion(input, config));
  const questions = questionAudits.map((audit) => audit.question).filter(Boolean);
  if (inputs.length !== requiredSampleSize) errors.push(`sample-size:${inputs.length}/${requiredSampleSize}`);
  if (questionAudits.some((audit) => !audit.ok)) errors.push("question-quality-failures");
  if (new Set(questions.map((question) => question.id)).size !== questions.length) errors.push("duplicate-question-id");

  const exactFingerprints = questions.map((question) => normalize(questionSurface(question)));
  if (new Set(exactFingerprints).size !== exactFingerprints.length) errors.push("exact-question-duplicate");
  let maximumObservedSimilarity = 0;
  const semanticDuplicatePairs = [];
  for (let left = 0; left < questions.length; left += 1) {
    for (let right = left + 1; right < questions.length; right += 1) {
      const similarity = jaccard(meaningfulTokens(questionSurface(questions[left])), meaningfulTokens(questionSurface(questions[right])));
      maximumObservedSimilarity = Math.max(maximumObservedSimilarity, similarity);
      if (similarity > maximumSemanticSimilarity) semanticDuplicatePairs.push([questions[left].id, questions[right].id]);
    }
  }
  if (semanticDuplicatePairs.length) errors.push("semantic-question-duplicates");

  const diversityPlanIds = questionAudits.map((audit) => audit.metrics.diversityPlanId).filter(Boolean);
  const discourseStructureIds = questionAudits.map((audit) => audit.metrics.discourseStructureId).filter(Boolean);
  const reasoningPathIds = questionAudits.map((audit) => audit.metrics.reasoningPathId).filter(Boolean);
  const genreIds = questionAudits.map((audit) => audit.metrics.genreId).filter(Boolean);
  if (new Set(diversityPlanIds).size !== diversityPlanIds.length) errors.push("duplicate-diversity-plan");
  const structuralFingerprints = questionAudits.map((audit) => (
    `${audit.metrics.discourseStructureId}:${audit.metrics.reasoningPathId}`
  ));
  const structuralFingerprintCounts = new Map();
  for (const fingerprint of structuralFingerprints) {
    structuralFingerprintCounts.set(fingerprint, (structuralFingerprintCounts.get(fingerprint) || 0) + 1);
  }
  const structuralDuplicatePairCount = [...structuralFingerprintCounts.values()]
    .reduce((total, count) => total + count * (count - 1) / 2, 0);
  if (structuralDuplicatePairCount > 0) errors.push("structural-template-duplicates");
  const largestShare = (values) => {
    if (!values.length) return 0;
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    return Math.max(...counts.values()) / values.length;
  };
  const maximumDiscourseStructureShare = largestShare(discourseStructureIds);
  const maximumReasoningPathShare = largestShare(reasoningPathIds);
  if (inputs.length === 20) {
    if (new Set(discourseStructureIds).size < 5) errors.push("insufficient-discourse-structure-diversity");
    if (new Set(reasoningPathIds).size < 4) errors.push("insufficient-reasoning-path-diversity");
    if (new Set(genreIds).size < 5) errors.push("insufficient-genre-diversity");
    if (maximumDiscourseStructureShare > 0.3) errors.push("discourse-structure-overconcentration");
    if (maximumReasoningPathShare > 0.3) errors.push("reasoning-path-overconcentration");
  }

  const correctPositionCounts = [0, 0, 0, 0];
  for (const audit of questionAudits) {
    const index = audit.metrics.correctIndex;
    if (Number.isInteger(index) && index >= 0 && index < 4) correctPositionCounts[index] += 1;
  }
  const minimumPositionCount = Math.floor(inputs.length * 0.15);
  const maximumPositionCount = Math.ceil(inputs.length * 0.35);
  if (inputs.length >= 8 && correctPositionCounts.some((count) => count < minimumPositionCount || count > maximumPositionCount)) {
    errors.push("answer-position-imbalance");
  }
  const longestCorrectCount = questionAudits.filter((audit) => audit.metrics.correctIsUniqueLongest === true).length;
  const longestCorrectRate = inputs.length ? longestCorrectCount / inputs.length : 0;
  if (longestCorrectRate > maximumLongestCorrectRate) errors.push("longest-option-answer-leakage");

  const reviewAudit = auditHumanReviewDecisions(reviews);
  if (!reviewAudit.ok) errors.push("human-review-contract-failures");
  const questionIds = new Set(questions.map((question) => question.id));
  const reviewsByQuestion = new Map();
  for (const review of reviewAudit.rows) {
    if (!questionIds.has(review.questionId)) errors.push(`review-for-unknown-question:${review.questionId}`);
    const questionReviews = reviewsByQuestion.get(review.questionId) || [];
    questionReviews.push(review);
    reviewsByQuestion.set(review.questionId, questionReviews);
  }
  if (reviewsByQuestion.size !== inputs.length) errors.push(`human-review-coverage:${reviewsByQuestion.size}/${inputs.length}`);
  const approvedQuestionIds = questions
    .filter((question) => {
      const questionReviews = reviewsByQuestion.get(question.id) || [];
      return questionReviews.length > 0 && questionReviews.every((review) => review.decision === "APPROVE");
    })
    .map((question) => question.id);
  const humanApprovalRate = inputs.length ? approvedQuestionIds.length / inputs.length : 0;
  if (humanApprovalRate < minimumHumanApprovalRate) errors.push("human-approval-rate-below-threshold");
  const automatedPassIds = new Set(questionAudits.filter((audit) => audit.ok).map((audit) => audit.question.id));
  const exportableQuestionIds = approvedQuestionIds.filter((id) => automatedPassIds.has(id));

  return Object.freeze({
    ok: errors.length === 0,
    pilotReady: errors.length === 0,
    errors: Object.freeze([...new Set(errors)]),
    questionAudits: Object.freeze(questionAudits),
    reviewAudit,
    exportableQuestionIds: Object.freeze(exportableQuestionIds),
    metrics: Object.freeze({
      sampleSize: inputs.length,
      automatedPassCount: automatedPassIds.size,
      humanReviewCount: reviewsByQuestion.size,
      humanDecisionCount: reviewAudit.rows.length,
      humanApprovalCount: approvedQuestionIds.length,
      humanApprovalRate: Number(humanApprovalRate.toFixed(2)),
      longestCorrectRate: Number(longestCorrectRate.toFixed(2)),
      correctPositionCounts: Object.freeze(correctPositionCounts),
      semanticDuplicatePairCount: semanticDuplicatePairs.length,
      maximumObservedSimilarity: Number(maximumObservedSimilarity.toFixed(2)),
      structuralDuplicatePairCount,
      distinctDiversityPlanCount: new Set(diversityPlanIds).size,
      distinctDiscourseStructureCount: new Set(discourseStructureIds).size,
      distinctReasoningPathCount: new Set(reasoningPathIds).size,
      distinctGenreCount: new Set(genreIds).size,
      maximumDiscourseStructureShare: Number(maximumDiscourseStructureShare.toFixed(2)),
      maximumReasoningPathShare: Number(maximumReasoningPathShare.toFixed(2))
    })
  });
}

export { HUMAN_REVIEW_DIMENSIONS };
