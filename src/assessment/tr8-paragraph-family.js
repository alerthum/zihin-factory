import { auditTr8ParagraphQuestion } from "./canonical-quality-core.js";

export const TR8_MAIN_IDEA_FAMILY_V1 = Object.freeze({
  familyId: "tr8.paragraph.main-idea-synthesis.v1",
  version: "1.0.0",
  curriculum: Object.freeze({
    country: "TR",
    schoolYear: "2026-2027",
    programFamily: "PRE_TYMM",
    grade: 8,
    courseId: "turkce",
    unitId: "okuma",
    topicId: "okuma",
    outcomeIds: Object.freeze(["tr.pre-tymm.g8.turkce.t-8-3-17"]),
    sourceIds: Object.freeze(["meb-legacy-programs"])
  }),
  construct: Object.freeze({
    primarySkill: "main-idea-synthesis",
    secondarySkills: Object.freeze(["scope-control", "contrast-integration"]),
    cognitiveProcess: "analysis-and-synthesis",
    knowledgeComponents: Object.freeze(["central-claim", "qualification", "detail-vs-thesis"]),
    intendedDifficultyBand: "LGS_HIGH"
  }),
  benchmarkProfile: Object.freeze({
    stimulusWords: Object.freeze([95, 155]),
    optionWords: Object.freeze([7, 18]),
    informationUnits: Object.freeze([4, 6]),
    solutionSteps: Object.freeze([3, 5]),
    distractorCount: 3
  }),
  cognitiveModel: Object.freeze({
    target: "Birden fazla bilgi birimini birleştirerek paragrafın tamamını kapsayan, metnin sınırını aşmayan ana düşünceyi seçme.",
    publicSolverProcedure: Object.freeze([
      "Paragraftaki bağımsız kanıt birimlerini belirle.",
      "Örnek, karşıtlık, sınırlama ve sonuç ilişkilerini kur.",
      "Ayrıntı yerine paragrafın tamamını kapsayan yargıyı oluştur.",
      "Her seçeneğin kapsamını ve kesinlik düzeyini metinle karşılaştır."
    ])
  }),
  misconceptions: Object.freeze([
    Object.freeze({
      id: "detail-as-main-idea",
      description: "Metindeki dikkat çekici bir ayrıntıyı ana düşünce sanır.",
      rule: "Metinde doğru olan fakat yalnız bir bilgi birimini kapsayan seçenek üret."
    }),
    Object.freeze({
      id: "overgeneralized-main-idea",
      description: "Metnin izin verdiğinden daha geniş veya kesin bir yargıya sıçrar.",
      rule: "Metindeki eğilimi herkes, her zaman veya tek neden gibi aşırılaştır."
    }),
    Object.freeze({
      id: "relation-reversal",
      description: "İki gerçek bilgiyi korur fakat aralarındaki ilişkiyi ters veya eksik kurar.",
      rule: "Neden, sınırlama ya da karşıtlık ilişkisini bozarken konu alanını koru."
    })
  ]),
  fixedConstraints: Object.freeze([
    "Dört seçenek bulunur ve yalnız biri doğrudur.",
    "Doğru cevap en az üç kanıt biriminin sentezine dayanır.",
    "Yanlış seçeneklerin üçü de konuya bağlı ve ilk bakışta makuldür.",
    "İpuçları cevabı söylemez; kanıt kullanımını aşamalı öğretir.",
    "Benchmark kaynaklarının yalnız soru morfolojisi kullanılır; ifade kopyalanmaz."
  ]),
  copyrightGuard: Object.freeze({ maxSharedPhraseWords: 5, copiedText: false }),
  styleReferenceIds: Object.freeze(["licensed-benchmark-morphology"])
});

const DISCOURSE_STRUCTURES = Object.freeze([
  "contrast-with-qualification",
  "cause-evidence-with-limit",
  "problem-attempt-revision",
  "change-and-continuity",
  "claim-counterexample-synthesis"
]);

const REASONING_PATHS = Object.freeze([
  "multi-source-convergence",
  "exception-bounded-inference",
  "chronology-causality-separation",
  "evidence-weighting"
]);

const GENRES = Object.freeze([
  "cultural-essay",
  "science-observation",
  "reflective-critique",
  "historical-exposition",
  "daily-life-analysis"
]);

export const TR8_DIVERSITY_PLANS_V1 = Object.freeze(Array.from({ length: 20 }, (_, itemIndex) => Object.freeze({
  planId: `tr8-main-idea-diversity-${String(itemIndex + 1).padStart(2, "0")}`,
  discourseStructureId: DISCOURSE_STRUCTURES[itemIndex % DISCOURSE_STRUCTURES.length],
  reasoningPathId: REASONING_PATHS[Math.floor(itemIndex / DISCOURSE_STRUCTURES.length)],
  genreId: GENRES[(itemIndex * 2 + Math.floor(itemIndex / 5)) % GENRES.length],
  correctIndex: itemIndex % 4
})));

export function tr8DiversityPlan(itemIndex) {
  const index = Number(itemIndex);
  if (!Number.isInteger(index) || index < 0 || index >= TR8_DIVERSITY_PLANS_V1.length) {
    throw new Error("diversity-plan-index:must-be-0-19");
  }
  return TR8_DIVERSITY_PLANS_V1[index];
}

function stripFences(value) {
  return String(value ?? "").replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
}

function balancedObject(value) {
  const text = stripFences(value);
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function text(value, field) {
  const output = String(value ?? "").trim();
  if (!output) throw new Error(`${field}:required`);
  return output;
}

function list(value, field, minimum) {
  if (!Array.isArray(value) || value.length < minimum) throw new Error(`${field}:minimum-${minimum}`);
  return value;
}

export function parseGeneratedCandidate(raw) {
  const candidateJson = balancedObject(raw) ?? stripFences(raw);
  const candidate = JSON.parse(candidateJson);
  if (!candidate || typeof candidate !== "object") throw new Error("candidate-json-invalid");
  text(candidate.instanceId, "instanceId");
  text(candidate.familyId, "familyId");
  text(candidate.stimulus, "stimulus");
  text(candidate.stem, "stem");
  list(candidate.options, "options", 4);
  list(candidate.evidenceUnits, "evidenceUnits", 4);
  list(candidate.solutionSteps, "solutionSteps", 3);
  list(candidate.hints, "hints", 3);
  list(candidate.distractors, "distractors", 3);
  text(candidate.diversityPlan?.planId, "diversityPlan.planId");
  text(candidate.diversityPlan?.discourseStructureId, "diversityPlan.discourseStructureId");
  text(candidate.diversityPlan?.reasoningPathId, "diversityPlan.reasoningPathId");
  text(candidate.diversityPlan?.genreId, "diversityPlan.genreId");
  return candidate;
}

export function compileCandidate(candidate, {
  family = TR8_MAIN_IDEA_FAMILY_V1,
  producerModel,
  proof = {},
  benchmarkExcerpts = [],
  diversityPlan
} = {}) {
  if (candidate.familyId !== family.familyId) throw new Error("family-id-mismatch");
  if (!Array.isArray(candidate.options) || candidate.options.length !== 4) throw new Error("option-count-must-be-4");
  if (!Number.isInteger(candidate.correctIndex) || candidate.correctIndex < 0 || candidate.correctIndex > 3) {
    throw new Error("correct-index-invalid");
  }
  const expectedPlan = diversityPlan || candidate.diversityPlan;
  if (!expectedPlan || typeof expectedPlan !== "object") throw new Error("diversity-plan-required");
  for (const field of ["planId", "discourseStructureId", "reasoningPathId", "genreId"]) {
    if (text(candidate.diversityPlan?.[field], `diversityPlan.${field}`) !== text(expectedPlan[field], `expectedDiversityPlan.${field}`)) {
      throw new Error(`diversity-plan-mismatch:${field}`);
    }
  }
  if (candidate.correctIndex !== Number(expectedPlan.correctIndex)) throw new Error("diversity-plan-mismatch:correctIndex");
  const optionIds = ["A", "B", "C", "D"];
  const evidenceUnits = list(candidate.evidenceUnits, "evidenceUnits", 4).map((entry, index) => ({
    id: text(entry.id || `E${index + 1}`, `evidenceUnits.${index}.id`),
    text: text(entry.text, `evidenceUnits.${index}.text`)
  }));
  const evidenceIds = new Set(evidenceUnits.map((entry) => entry.id));
  const requiredEvidenceIds = list(candidate.correctSupportEvidenceIds, "correctSupportEvidenceIds", 3).map(String);
  if (requiredEvidenceIds.some((id) => !evidenceIds.has(id))) throw new Error("correct-support-evidence-unknown");

  const distractorsByIndex = new Map();
  for (const distractor of list(candidate.distractors, "distractors", 3)) {
    if (!Number.isInteger(distractor.optionIndex) || distractor.optionIndex < 0 || distractor.optionIndex > 3) {
      throw new Error("distractor-option-index-invalid");
    }
    if (distractor.optionIndex === candidate.correctIndex) throw new Error("correct-option-marked-as-distractor");
    if (distractorsByIndex.has(distractor.optionIndex)) throw new Error("duplicate-distractor-index");
    distractorsByIndex.set(distractor.optionIndex, distractor);
  }
  if (distractorsByIndex.size !== 3) throw new Error("three-distractors-required");

  const options = candidate.options.map((entry, index) => ({ id: optionIds[index], text: text(entry, `options.${index}`) }));
  const optionFeedback = options.map((option, index) => {
    if (index === candidate.correctIndex) {
      return {
        optionId: option.id,
        correct: true,
        misconceptionId: null,
        text: text(candidate.correctFeedback, "correctFeedback"),
        supportingEvidenceIds: requiredEvidenceIds,
        contradictionEvidenceIds: []
      };
    }
    const distractor = distractorsByIndex.get(index);
    const supportingEvidenceIds = list(distractor.supportingEvidenceIds, `distractors.${index}.supportingEvidenceIds`, 1).map(String);
    const contradictionEvidenceIds = Array.isArray(distractor.contradictionEvidenceIds)
      ? distractor.contradictionEvidenceIds.map(String)
      : [];
    if ([...supportingEvidenceIds, ...contradictionEvidenceIds].some((id) => !evidenceIds.has(id))) {
      throw new Error("distractor-evidence-unknown");
    }
    return {
      optionId: option.id,
      correct: false,
      misconceptionId: text(distractor.misconceptionId, `distractors.${index}.misconceptionId`),
      text: text(distractor.feedback, `distractors.${index}.feedback`),
      supportingEvidenceIds,
      contradictionEvidenceIds
    };
  });
  const misconceptionIds = optionFeedback.filter((entry) => !entry.correct).map((entry) => entry.misconceptionId);
  const allowedMisconceptions = new Set(family.misconceptions.map((entry) => entry.id));
  if (misconceptionIds.some((id) => !allowedMisconceptions.has(id))) throw new Error("unknown-misconception-id");

  const solutionGraph = candidate.solutionSteps.map((step, index) => ({
    id: text(step.id || `s${index + 1}`, `solutionSteps.${index}.id`),
    action: text(step.action, `solutionSteps.${index}.action`),
    dependsOn: index === 0 ? [] : [String(candidate.solutionSteps[index - 1].id || `s${index}`)],
    evidenceIds: list(step.evidenceIds, `solutionSteps.${index}.evidenceIds`, 1).map(String),
    evidence: text(step.explanation, `solutionSteps.${index}.explanation`)
  }));
  if (solutionGraph.some((step) => step.evidenceIds.some((id) => !evidenceIds.has(id)))) {
    throw new Error("solution-evidence-unknown");
  }

  const canonical = {
    id: `tr8-factory-${text(candidate.instanceId, "instanceId")}`,
    curriculum: structuredClone(family.curriculum),
    construct: structuredClone(family.construct),
    content: {
      stimulus: text(candidate.stimulus, "stimulus"),
      stem: text(candidate.stem, "stem"),
      options,
      evidenceMap: evidenceUnits,
      synthesisRequirement: { requiredEvidenceIds, singleSentenceSufficient: false },
      humanReview: { status: "NOT_MEASURED", gameAdaptationAllowed: false }
    },
    itemFormat: "single-choice",
    responseModel: { optionIds, optionCount: 4 },
    answerKey: { optionId: optionIds[candidate.correctIndex], supportingEvidenceIds: requiredEvidenceIds },
    solutionGraph,
    hints: candidate.hints.map((hint, index) => ({
      level: index + 1,
      text: text(hint.text ?? hint, `hints.${index}`),
      revealsAnswer: false
    })),
    optionFeedback,
    misconceptionIds,
    verifier: {
      solverId: text(proof.solverId || "tr8-main-idea-solver-v1", "proof.solverId"),
      independentVerifierId: text(proof.independentVerifierId || "tr8-main-idea-independent-verifier-v1", "proof.independentVerifierId"),
      verified: proof.verified === true
    },
    styleProfile: {
      ...(candidate.styleProfile && typeof candidate.styleProfile === "object" ? structuredClone(candidate.styleProfile) : {}),
      genre: text(expectedPlan.genreId, "expectedDiversityPlan.genreId"),
      genreId: text(expectedPlan.genreId, "expectedDiversityPlan.genreId"),
      discourseStructureId: text(expectedPlan.discourseStructureId, "expectedDiversityPlan.discourseStructureId"),
      reasoningPathId: text(expectedPlan.reasoningPathId, "expectedDiversityPlan.reasoningPathId"),
      diversityPlanId: text(expectedPlan.planId, "expectedDiversityPlan.planId"),
      voice: text(candidate.styleProfile?.voice || "natural-age-appropriate", "styleProfile.voice")
    },
    provenance: {
      generatedFromSourceIds: [...family.curriculum.sourceIds],
      styleReferenceIds: [...family.styleReferenceIds],
      producerModel: String(producerModel || "unknown")
    },
    contentStatus: "HUMAN_REVIEW_REQUIRED"
  };
  const audit = auditTr8ParagraphQuestion(canonical, {
    stimulusWords: family.benchmarkProfile.stimulusWords,
    optionWords: family.benchmarkProfile.optionWords,
    maximumSharedBenchmarkPhraseWords: family.copyrightGuard.maxSharedPhraseWords,
    benchmarkExcerpts
  });
  return Object.freeze({ canonical: audit.question || canonical, audit });
}

export function generatorSystemPrompt() {
  return [
    "You instantiate one assessment item from an executable family; you do not freely improvise a quiz question.",
    "Return strict JSON only.",
    "Never copy benchmark wording, characters, examples or sentences.",
    "Do not expose hidden chain-of-thought. solutionSteps are short, student-visible verification steps."
  ].join(" ");
}

export function generatorPrompt({
  family = TR8_MAIN_IDEA_FAMILY_V1,
  instanceId,
  theme = "timeless science, culture, daily life or environment",
  morphologyNotes = [],
  diversityPlan,
  revision = ""
} = {}) {
  const plan = diversityPlan || tr8DiversityPlan(0);
  return `EXECUTABLE FAMILY:\n${JSON.stringify(family)}\n\nMANDATORY DIVERSITY PLAN (do not substitute another template):\n${JSON.stringify(plan)}\n\nINSTANCE ID:\n${text(instanceId, "instanceId")}\n\nTHEME:\n${theme}\n\nBENCHMARK MORPHOLOGY NOTES (structure only):\n${morphologyNotes.map((note, index) => `${index + 1}. ${note}`).join("\n") || "- Multi-evidence synthesis; plausible diagnostic distractors."}\n\n${revision ? `REVISION:\n${revision}\n\n` : ""}Return exactly one JSON object with this shape:\n${JSON.stringify({
    familyId: family.familyId,
    instanceId: "batch01-item01",
    diversityPlan: plan,
    stimulus: "95-155 original Turkish words",
    stem: "natural main-idea question stem",
    options: ["A text", "B text", "C text", "D text"],
    correctIndex: plan.correctIndex,
    evidenceUnits: [{ id: "E1", text: "concise evidence unit" }],
    correctSupportEvidenceIds: ["E1", "E2", "E3"],
    correctFeedback: "why all required evidence supports the answer",
    solutionSteps: [{ id: "s1", action: "student action", evidenceIds: ["E1"], explanation: "visible explanation" }],
    hints: [{ text: "progressive non-revealing hint" }],
    distractors: [{ optionIndex: 1, misconceptionId: "detail-as-main-idea", supportingEvidenceIds: ["E1"], contradictionEvidenceIds: ["E3"], feedback: "specific correction" }],
    styleProfile: { genre: "essay", voice: "natural" }
  })}`;
}

export function reviewerPrompt({ family = TR8_MAIN_IDEA_FAMILY_V1, canonical, deterministicIssues = [] } = {}) {
  return `Independently review this 8th-grade Turkish item. Polished prose is not evidence of quality. Check unique answer defensibility, multi-evidence synthesis, diagnostic distractors, natural Turkish, answer leakage and originality. Verify that the actual stimulus—not merely its labels—realizes styleProfile.discourseStructureId, reasoningPathId and genreId; reject cosmetic relabeling of the same template. Never provide hidden chain-of-thought. Return strict JSON only.\n\nFAMILY:\n${JSON.stringify(family)}\n\nDETERMINISTIC ISSUES:\n${JSON.stringify(deterministicIssues)}\n\nITEM:\n${JSON.stringify(canonical)}\n\nSCHEMA:\n{"selectedOptionIndex":0,"supportingEvidenceIds":["E1","E2","E3"],"decision":"PASS|RETRY|QUARANTINE","score":0,"dimensions":{"benchmarkFit":0,"reasoningQuality":0,"distractorQuality":0,"languageNaturalness":0,"answerDefensibility":0,"originality":0,"structuralPlanFidelity":0},"reasons":["specific reason"],"revisionInstructions":"specific changes"}`;
}

export function parseEngineeringReview(raw, {
  producerModel,
  reviewerModel,
  deterministicIssues = [],
  expectedCorrectIndex,
  requiredEvidenceIds = []
} = {}) {
  let parsed;
  try {
    parsed = JSON.parse(balancedObject(raw) ?? stripFences(raw));
  } catch {
    parsed = {};
  }
  const score = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const dimensions = {
    benchmarkFit: score(parsed.dimensions?.benchmarkFit),
    reasoningQuality: score(parsed.dimensions?.reasoningQuality),
    distractorQuality: score(parsed.dimensions?.distractorQuality),
    languageNaturalness: score(parsed.dimensions?.languageNaturalness),
    answerDefensibility: score(parsed.dimensions?.answerDefensibility),
    originality: score(parsed.dimensions?.originality),
    structuralPlanFidelity: score(parsed.dimensions?.structuralPlanFidelity)
  };
  const requestedDecision = String(parsed.decision || "RETRY").toUpperCase();
  const independentModel = Boolean(producerModel && reviewerModel && producerModel !== reviewerModel);
  const selectedOptionIndex = Number(parsed.selectedOptionIndex);
  const reviewerEvidenceIds = Array.isArray(parsed.supportingEvidenceIds) ? parsed.supportingEvidenceIds.map(String) : [];
  const independentlyResolved = Number.isInteger(expectedCorrectIndex)
    && selectedOptionIndex === expectedCorrectIndex
    && requiredEvidenceIds.every((id) => reviewerEvidenceIds.includes(String(id)));
  const hardPass = independentModel
    && independentlyResolved
    && deterministicIssues.length === 0
    && score(parsed.score) >= 85
    && dimensions.benchmarkFit >= 80
    && dimensions.reasoningQuality >= 85
    && dimensions.distractorQuality >= 85
    && dimensions.languageNaturalness >= 80
    && dimensions.answerDefensibility >= 90
    && dimensions.originality >= 90
    && dimensions.structuralPlanFidelity >= 85;
  const decision = requestedDecision === "QUARANTINE"
    ? "QUARANTINE"
    : requestedDecision === "PASS" && hardPass
      ? "PASS"
      : "RETRY";
  const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.map(String).slice(0, 8) : [];
  if (!independentModel) reasons.push("producer-reviewer-model-must-differ");
  if (!independentlyResolved) reasons.push("independent-answer-or-evidence-mismatch");
  if (requestedDecision === "PASS" && !hardPass) reasons.push("hard-engineering-threshold-not-met");
  return Object.freeze({
    decision,
    score: score(parsed.score),
    dimensions: Object.freeze(dimensions),
    reasons: Object.freeze([...new Set(reasons)]),
    revisionInstructions: String(parsed.revisionInstructions || "").trim(),
    producerModel: String(producerModel || ""),
    reviewerModel: String(reviewerModel || ""),
    selectedOptionIndex: Number.isInteger(selectedOptionIndex) ? selectedOptionIndex : null,
    supportingEvidenceIds: Object.freeze(reviewerEvidenceIds),
    independentlyResolved,
    deterministicIssues: Object.freeze([...deterministicIssues])
  });
}
