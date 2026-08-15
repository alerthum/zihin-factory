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

export const TR8_MICRO_AUTHOR_TASKS_V1 = Object.freeze([
  "Establish the topic and a concrete situation without stating the final main idea.",
  "Introduce the first observable evidence unit that matters to the assigned reasoning path.",
  "Add a contrast, limitation or complication required by the assigned discourse structure.",
  "Supply a second concrete evidence unit that cannot be reduced to the previous sentence.",
  "Show a change, counterexample or consequence that deepens the relationship between the evidence units.",
  "Connect at least two earlier observations while preserving their scope and uncertainty.",
  "Qualify the emerging inference so that it does not become an unsupported generalization.",
  "Close by synthesizing the paragraph without copying any answer option or announcing the answer."
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
  const candidate = parseGeneratedJsonObject(raw);
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

export function parseGeneratedJsonObject(raw) {
  const objectJson = balancedObject(raw) ?? stripFences(raw);
  const value = JSON.parse(objectJson);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("generated-json-object-invalid");
  return value;
}

export function assembleTr8MicroAuthorCore(core) {
  const sentences = Array.isArray(core?.sentences) ? core.sentences : [];
  if (sentences.length !== TR8_MICRO_AUTHOR_TASKS_V1.length) {
    throw new Error(`core-sentence-count:${sentences.length}; exactly 8 micro-author sentences are required`);
  }
  const checkedSentences = sentences.map((value, index) => {
    const sentence = text(value, `core.sentences.${index}`);
    const wordCount = sentence.split(/\s+/u).filter(Boolean).length;
    if (wordCount < 14 || wordCount > 18) {
      throw new Error(`core-sentence-${index + 1}-word-count:${wordCount}; every micro-author sentence must contain 14-18 words`);
    }
    const boundaries = sentence.match(/[.!?…](?=\s|$)/gu) || [];
    if (boundaries.length !== 1 || !/[.!?…]$/u.test(sentence)) {
      throw new Error(`core-sentence-${index + 1}-boundary; every micro-author entry must contain exactly one complete sentence`);
    }
    return sentence;
  });
  const { sentences: _sentences, stimulus: _modelStimulus, ...rest } = core;
  return { ...rest, stimulus: checkedSentences.join(" ") };
}

export function validateGeneratedCore(core, { diversityPlan } = {}) {
  const stimulus = text(core?.stimulus, "core.stimulus");
  const stimulusWords = stimulus.split(/\s+/u).filter(Boolean).length;
  if (stimulusWords < 95 || stimulusWords > 155) {
    throw new Error(`core-stimulus-word-count:${stimulusWords}; generate a new paragraph of exactly 8 sentences with 14-18 words in every sentence`);
  }
  const options = list(core?.options, "core.options", 4).map((option, index) => text(option, `core.options.${index}`));
  if (options.length !== 4) throw new Error("core-option-count-must-be-4");
  const normalizedOptions = options.map((option) => option.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9çğıöşü]+/giu, " ").trim());
  if (new Set(normalizedOptions).size !== 4) throw new Error("core-options-must-be-distinct");
  const optionCounts = options.map((option) => option.split(/\s+/u).filter(Boolean).length);
  if (optionCounts.some((count) => count < 7 || count > 18)) {
    throw new Error(`core-option-word-counts:${optionCounts.join(",")}; every option must contain 7-18 words`);
  }
  const plan = diversityPlan || tr8DiversityPlan(0);
  if (Number(core?.correctIndex) !== plan.correctIndex) throw new Error(`core-correct-index-must-be:${plan.correctIndex}`);
  const evidenceUnits = list(core?.evidenceUnits, "core.evidenceUnits", 4);
  if (evidenceUnits.length !== 4) throw new Error("core-evidence-unit-count-must-be-4");
  return core;
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
    instructionalMetadata: {
      outcomeIds: [...family.curriculum.outcomeIds],
      learningObjective: family.cognitiveModel.target,
      thinkingSkill: family.construct.primarySkill,
      cognitiveProcess: family.construct.cognitiveProcess,
      targetDifficulty: family.construct.intendedDifficultyBand,
      correctAnswerRationale: optionFeedback[candidate.correctIndex].text,
      distractorStudentMisconceptions: optionFeedback.filter((entry) => !entry.correct).map((entry) => ({
        optionId: entry.optionId,
        misconceptionId: entry.misconceptionId,
        description: family.misconceptions.find((item) => item.id === entry.misconceptionId)?.description || entry.misconceptionId
      })),
      teachingExplanation: solutionGraph.map((step) => step.evidence).join(" "),
      deterministicReplayFingerprint: `${family.familyId}@${family.version}:${expectedPlan.planId}:${text(candidate.instanceId, "instanceId")}`
    },
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
    "Do not expose hidden chain-of-thought. solutionSteps are short, student-visible verification steps.",
    "Do not abbreviate arrays: return exactly four evidenceUnits, three solutionSteps, three progressive hints, and three distractors.",
    "Every descriptive string in the JSON shape is a placeholder, not content: replace every placeholder with original, natural Turkish content.",
    "Before returning, verify that stimulus has 95-155 Turkish words, every option has 7-18 words, and no placeholder phrase remains."
  ].join(" ");
}

export function generatorCoreSystemPrompt() {
  return [
    "Create the core of one difficult grade-8 Turkish main-idea question.",
    "Return one strict JSON object only; never return a schema, template, placeholder, title-only text or commentary.",
    "Return the stimulus as exactly eight independent sentence strings in a sentences array; never assemble or return a stimulus paragraph.",
    "Each sentence must contain 14-18 words of natural Turkish and end with exactly one sentence terminator; the factory will validate and assemble them.",
    "Write exactly four distinct, plausible Turkish options of 8-16 words; only the assigned index is correct.",
    "Every option must discuss the same subject, and no option may repeat the stem.",
    "Provide exactly four concise evidence units grounded in the paragraph."
  ].join(" ");
}

export function generatorCorePrompt({
  family = TR8_MAIN_IDEA_FAMILY_V1,
  instanceId,
  theme,
  morphologyNotes = [],
  diversityPlan,
  revision = ""
} = {}) {
  const plan = diversityPlan || tr8DiversityPlan(0);
  return [
    `familyId (copy exactly): ${family.familyId}`,
    `instanceId (copy exactly): ${text(instanceId, "instanceId")}`,
    `theme: ${theme || "timeless science, culture, daily life or environment"}`,
    `assigned correctIndex: ${plan.correctIndex}`,
    `genre: ${plan.genreId}`,
    `discourse structure: ${plan.discourseStructureId}`,
    `reasoning path: ${plan.reasoningPathId}`,
    `structure notes: ${morphologyNotes.join("; ") || "multi-evidence synthesis with close distractors"}`,
    revision ? `revision required after a failed audit: ${revision}` : "",
    `Eight sentence assignments, in fixed order:\n${TR8_MICRO_AUTHOR_TASKS_V1.map((task, index) => `${index + 1}. ${task}`).join("\n")}`,
    "Return these JSON keys with finished Turkish content: familyId, instanceId, sentences, stem, options, correctIndex, evidenceUnits, correctSupportEvidenceIds, styleProfile.",
    "sentences must contain exactly 8 complete Turkish sentence strings, in assignment order, with 14-18 words per string.",
    "options must contain exactly 4 strings. evidenceUnits must contain exactly 4 objects with ids E1, E2, E3, E4 and a text field.",
    "correctSupportEvidenceIds must contain at least 3 evidence ids. styleProfile must contain genre and voice.",
    "Count every sentence and option silently. Do not output counts, a combined paragraph or extra keys."
  ].filter(Boolean).join("\n");
}

export function generatorTeachingSystemPrompt() {
  return [
    "Build only the student-visible teaching layer for the supplied Turkish question core.",
    "Return one strict JSON object only, with no schema, placeholders or commentary.",
    "Do not change the paragraph, options, correct answer or evidence units.",
    "Feedback must explain the specific reasoning error and point to evidence; generic feedback is forbidden.",
    "Hints must progress from evidence detection to relation building to scope checking without revealing the answer."
  ].join(" ");
}

export function generatorTeachingPrompt({ core, diversityPlan } = {}) {
  const plan = diversityPlan || tr8DiversityPlan(0);
  const distractorIndices = [0, 1, 2, 3].filter((index) => index !== plan.correctIndex);
  return [
    `QUESTION CORE:\n${JSON.stringify(core)}`,
    `The correct option index is ${plan.correctIndex}. Distractor option indices are ${distractorIndices.join(", ")}.`,
    "Return exactly these JSON keys: correctFeedback, solutionSteps, hints, distractors.",
    "correctFeedback must explain why at least three evidence units jointly support the correct option.",
    "solutionSteps: exactly 3 objects with id s1/s2/s3, action, evidenceIds and a specific explanation.",
    "hints: exactly 3 objects with a text field, progressively useful and non-revealing.",
    "distractors: exactly 3 objects, one for each listed distractor index, using misconceptionIds detail-as-main-idea, overgeneralized-main-idea and relation-reversal exactly once.",
    "Each distractor object must include optionIndex, misconceptionId, supportingEvidenceIds, contradictionEvidenceIds and feedback of at least 12 Turkish words."
  ].join("\n");
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
  const distractorIndices = [0, 1, 2, 3].filter((optionIndex) => optionIndex !== plan.correctIndex);
  return `EXECUTABLE FAMILY:\n${JSON.stringify(family)}\n\nMANDATORY DIVERSITY PLAN (do not substitute another template):\n${JSON.stringify(plan)}\n\nINSTANCE ID:\n${text(instanceId, "instanceId")}\n\nTHEME:\n${theme}\n\nBENCHMARK MORPHOLOGY NOTES (structure only):\n${morphologyNotes.map((note, index) => `${index + 1}. ${note}`).join("\n") || "- Multi-evidence synthesis; plausible diagnostic distractors."}\n\nFORBIDDEN LITERAL PLACEHOLDERS (none may appear in your output):\n- 95-155 original Turkish words\n- natural main-idea question stem\n- A text / B text / C text / D text\n- first concise evidence unit / second concise evidence unit / third concise evidence unit / fourth concise evidence unit\n- first visible verification step / second visible verification step / third visible verification step\n- first progressive non-revealing hint / second progressive non-revealing hint / third progressive non-revealing hint\n\n${revision ? `REVISION:\n${revision}\n\n` : ""}Return exactly one JSON object with this shape; replace every descriptive value with real Turkish item content:\n${JSON.stringify({
    familyId: family.familyId,
    instanceId: "batch01-item01",
    diversityPlan: plan,
    stimulus: "95-155 original Turkish words",
    stem: "natural main-idea question stem",
    options: ["A text", "B text", "C text", "D text"],
    correctIndex: plan.correctIndex,
    evidenceUnits: [
      { id: "E1", text: "first concise evidence unit" },
      { id: "E2", text: "second concise evidence unit" },
      { id: "E3", text: "third concise evidence unit" },
      { id: "E4", text: "fourth concise evidence unit" }
    ],
    correctSupportEvidenceIds: ["E1", "E2", "E3"],
    correctFeedback: "why all required evidence supports the answer",
    solutionSteps: [
      { id: "s1", action: "identify evidence units", evidenceIds: ["E1", "E2"], explanation: "first visible verification step" },
      { id: "s2", action: "connect the evidence", evidenceIds: ["E2", "E3"], explanation: "second visible verification step" },
      { id: "s3", action: "check the full scope", evidenceIds: ["E1", "E2", "E3"], explanation: "third visible verification step" }
    ],
    hints: [
      { text: "first progressive non-revealing hint" },
      { text: "second progressive non-revealing hint" },
      { text: "third progressive non-revealing hint" }
    ],
    distractors: [
      { optionIndex: distractorIndices[0], misconceptionId: "detail-as-main-idea", supportingEvidenceIds: ["E1"], contradictionEvidenceIds: ["E3"], feedback: "specific correction for the detail trap" },
      { optionIndex: distractorIndices[1], misconceptionId: "overgeneralized-main-idea", supportingEvidenceIds: ["E2"], contradictionEvidenceIds: ["E4"], feedback: "specific correction for overgeneralization" },
      { optionIndex: distractorIndices[2], misconceptionId: "relation-reversal", supportingEvidenceIds: ["E3"], contradictionEvidenceIds: ["E1", "E2"], feedback: "specific correction for the reversed relation" }
    ],
    styleProfile: { genre: "essay", voice: "natural" }
  })}`;
}

function blindReviewItem(canonical = {}) {
  return {
    id: canonical.id,
    curriculum: canonical.curriculum,
    construct: canonical.construct,
    content: {
      stimulus: canonical.content?.stimulus,
      stem: canonical.content?.stem,
      options: canonical.content?.options,
      evidenceMap: canonical.content?.evidenceMap
    },
    itemFormat: canonical.itemFormat,
    responseModel: canonical.responseModel,
    styleProfile: canonical.styleProfile,
    provenance: canonical.provenance
  };
}

export function blindReviewerPrompt({ family = TR8_MAIN_IDEA_FAMILY_V1, canonical, deterministicIssues = [] } = {}) {
  return `Solve this 8th-grade Turkish item independently before seeing any author answer, hint, feedback or solution. Select exactly one option and cite the evidence-unit ids that support it. Reject ambiguity: if two options are defensible, return RETRY. Verify that the actual stimulus—not merely its labels—realizes styleProfile.discourseStructureId, reasoningPathId and genreId. Never provide hidden chain-of-thought. Return strict JSON only.\n\nFAMILY CONSTRUCT (no answer key):\n${JSON.stringify({ familyId: family.familyId, curriculum: family.curriculum, construct: family.construct })}\n\nDETERMINISTIC ISSUES:\n${JSON.stringify(deterministicIssues)}\n\nBLIND ITEM:\n${JSON.stringify(blindReviewItem(canonical))}\n\nSCHEMA:\n{"selectedOptionIndex":0,"supportingEvidenceIds":["E1","E2","E3"],"decision":"PASS|RETRY|QUARANTINE","reasons":["specific answer-defensibility reason"]}`;
}

export function parseBlindResolution(raw, { producerModel, reviewerModel } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(balancedObject(raw) ?? stripFences(raw));
  } catch {
    parsed = {};
  }
  const selectedOptionIndex = Number(parsed.selectedOptionIndex);
  const supportingEvidenceIds = Array.isArray(parsed.supportingEvidenceIds)
    ? [...new Set(parsed.supportingEvidenceIds.map(String).filter(Boolean))]
    : [];
  const requestedDecision = String(parsed.decision || "RETRY").toUpperCase();
  const independentModel = Boolean(producerModel && reviewerModel && producerModel !== reviewerModel);
  const validSelection = Number.isInteger(selectedOptionIndex) && selectedOptionIndex >= 0 && selectedOptionIndex <= 3;
  const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.map(String).slice(0, 8) : [];
  if (!independentModel) reasons.push("producer-blind-reviewer-model-must-differ");
  if (!validSelection) reasons.push("blind-selected-option-invalid");
  if (!supportingEvidenceIds.length) reasons.push("blind-supporting-evidence-required");
  return Object.freeze({
    decision: requestedDecision === "QUARANTINE" ? "QUARANTINE" : requestedDecision === "PASS" && independentModel && validSelection && supportingEvidenceIds.length ? "PASS" : "RETRY",
    selectedOptionIndex: validSelection ? selectedOptionIndex : null,
    supportingEvidenceIds: Object.freeze(supportingEvidenceIds),
    reasons: Object.freeze([...new Set(reasons)]),
    producerModel: String(producerModel || ""),
    reviewerModel: String(reviewerModel || ""),
    independentModel,
    answerKeyExposed: false
  });
}

export function reviewerPrompt({ family = TR8_MAIN_IDEA_FAMILY_V1, canonical, deterministicIssues = [], blindResolution } = {}) {
  const locked = {
    selectedOptionIndex: blindResolution?.selectedOptionIndex ?? null,
    supportingEvidenceIds: blindResolution?.supportingEvidenceIds ?? [],
    reviewerModel: blindResolution?.reviewerModel ?? ""
  };
  return `Audit the complete authoring package for this 8th-grade Turkish item. The blind answer resolution below was committed before the answer key, hints, feedback and solution were revealed; do not change it. Polished prose is not evidence of quality. Check diagnostic distractors, option-specific teaching feedback, progressive non-leaking hints, visible solution evidence, natural Turkish, originality, answer defensibility and structural-plan fidelity. Reject cosmetic relabeling of the same template. Never provide hidden chain-of-thought. Return strict JSON only.\n\nLOCKED BLIND RESOLUTION:\n${JSON.stringify(locked)}\n\nFAMILY:\n${JSON.stringify(family)}\n\nDETERMINISTIC ISSUES:\n${JSON.stringify(deterministicIssues)}\n\nCOMPLETE ITEM:\n${JSON.stringify(canonical)}\n\nSCHEMA:\n{"selectedOptionIndex":${locked.selectedOptionIndex ?? 0},"supportingEvidenceIds":["E1","E2","E3"],"decision":"PASS|RETRY|QUARANTINE","score":0,"dimensions":{"benchmarkFit":0,"reasoningQuality":0,"distractorQuality":0,"languageNaturalness":0,"answerDefensibility":0,"originality":0,"structuralPlanFidelity":0},"reasons":["specific reason"],"revisionInstructions":"specific changes"}`;
}

export function parseEngineeringReview(raw, {
  producerModel,
  reviewerModel,
  deterministicIssues = [],
  expectedCorrectIndex,
  requiredEvidenceIds = [],
  blindResolution
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
  const committedBlindResolution = blindResolution && typeof blindResolution === "object" ? blindResolution : null;
  const qualityReviewerIndependentFromProducer = Boolean(
    producerModel && reviewerModel && producerModel !== reviewerModel
  );
  const qualityReviewerIndependentFromBlind = Boolean(
    reviewerModel
      && committedBlindResolution?.reviewerModel
      && reviewerModel !== committedBlindResolution.reviewerModel
  );
  const qualityReviewerIndependent = qualityReviewerIndependentFromProducer
    && qualityReviewerIndependentFromBlind;
  const selectedOptionIndex = Number(committedBlindResolution?.selectedOptionIndex);
  const reviewerEvidenceIds = Array.isArray(committedBlindResolution?.supportingEvidenceIds)
    ? committedBlindResolution.supportingEvidenceIds.map(String)
    : [];
  const qualitySelectedOptionIndex = Number(parsed.selectedOptionIndex);
  const qualityEvidenceIds = Array.isArray(parsed.supportingEvidenceIds) ? parsed.supportingEvidenceIds.map(String) : [];
  const blindResolutionLocked = Boolean(committedBlindResolution)
    && committedBlindResolution.decision === "PASS"
    && committedBlindResolution.independentModel === true
    && committedBlindResolution.answerKeyExposed === false
    && (!Number.isInteger(qualitySelectedOptionIndex) || qualitySelectedOptionIndex === selectedOptionIndex)
    && (!qualityEvidenceIds.length || reviewerEvidenceIds.every((id) => qualityEvidenceIds.includes(id)));
  const independentlyResolved = Number.isInteger(expectedCorrectIndex)
    && selectedOptionIndex === expectedCorrectIndex
    && requiredEvidenceIds.every((id) => reviewerEvidenceIds.includes(String(id)));
  const hardPass = qualityReviewerIndependent
    && blindResolutionLocked
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
  if (!qualityReviewerIndependentFromProducer) reasons.push("producer-quality-reviewer-model-must-differ");
  if (!qualityReviewerIndependentFromBlind) reasons.push("blind-and-quality-reviewer-models-must-differ");
  if (!blindResolutionLocked) reasons.push("blind-resolution-missing-or-changed");
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
    blindReviewerModel: String(committedBlindResolution?.reviewerModel || ""),
    blindAnswerKeyExposed: committedBlindResolution?.answerKeyExposed !== false,
    blindResolutionLocked,
    independentlyResolved,
    deterministicIssues: Object.freeze([...deterministicIssues])
  });
}
