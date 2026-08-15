import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runTr8Benchmark } from "../src/assessment/tr8-benchmark-runner.js";
import { TR8_MAIN_IDEA_FAMILY_V1, tr8DiversityPlan } from "../src/assessment/tr8-paragraph-family.js";

const stimulus = [
  "Bir okul radyosunun arşiv ekibi eski yayınları yalnız tarihlerine göre sıralamanın değişimi açıklamadığını fark etti.",
  "Aynı programın farklı yıllardaki kayıtlarında kullanılan müzikler değişirken öğrencilerin mahalle sorunlarını tartışma alışkanlığı sürüyordu.",
  "Yayın çizelgeleri bazı programların sona erdiğini gösteriyor, dinleyici mektupları ise bu programlardaki fikirlerin yeni yayınlarda yaşadığını ortaya koyuyordu.",
  "Ekip bu nedenle her kayıt türünü ayrı bir kanıt olarak değerlendirdi.",
  "Hazırlanan sergide ses kayıtları, çizelgeler ve mektuplar yan yana getirildi.",
  "Ziyaretçiler değişen yayın biçimleriyle süren katılım kültürü arasındaki ilişkiyi ancak bu karşılaştırma sayesinde kurabildi.",
  "Böylece radyo arşivi eski sesleri saklayan bir depo olmaktan çıkıp okul yaşamındaki dönüşümün farklı izlerini birlikte okutan bir çalışma alanına dönüştü."
].join(" ");

function candidate(instanceId, itemIndex = 0) {
  const diversityPlan = tr8DiversityPlan(itemIndex);
  const correctOption = "Okul yaşamındaki değişimi anlamak için farklı arşiv kanıtları birlikte değerlendirilerek dönüşüm ve süreklilik karşılaştırılmalıdır.";
  const wrongOptions = [
    { text: "Eski radyo yayınlarını tarihlerine göre sıralamak okul kültüründeki bütün değişimi tek başına açıklamaya yeterlidir.", misconceptionId: "detail-as-main-idea", supportingEvidenceIds: ["E1"], contradictionEvidenceIds: ["E3", "E4"], feedback: "Tarih sırası metinde geçer; ancak ekip bunun değişimi tek başına açıklamadığını özellikle belirtmektedir." },
    { text: "Bir programın sona ermesi öğrencilerin o programda tartıştığı bütün fikirlerin aynı anda unutulduğunu kanıtlar.", misconceptionId: "overgeneralized-main-idea", supportingEvidenceIds: ["E2"], contradictionEvidenceIds: ["E2"], feedback: "Programların sona ermesine rağmen fikirlerin yeni yayınlarda yaşaması bu kesin genellemeyi doğrudan çürütmektedir." },
    { text: "Arşiv sergisinde çizelge kullanılması dinleyici mektuplarındaki görüşlerin değerlendirilmesini bütünüyle gereksiz hâle getirir.", misconceptionId: "relation-reversal", supportingEvidenceIds: ["E3"], contradictionEvidenceIds: ["E4"], feedback: "Çizelge ve mektuplar birbirini gereksiz kılmaz; metindeki sonuç bu kaynakların birlikte okunmasına dayanmaktadır." }
  ];
  const optionRows = wrongOptions.map((row) => ({ ...row, correct: false }));
  optionRows.splice(diversityPlan.correctIndex, 0, { text: correctOption, correct: true });
  return {
    familyId: TR8_MAIN_IDEA_FAMILY_V1.familyId,
    instanceId,
    diversityPlan,
    stimulus: `${stimulus} ${itemIndex === 0 ? "Pusula, afiş, mikrofon, merdiven, kiremit, sandalye, bilet ve mühür ayrı kataloglara işlendi." : "Dürbün, nilüfer, iskele, fener, halat, yelken, çakıl ve yosun ayrı çizelgelere işlendi."}`,
    stem: "Bu parçanın ana düşüncesi aşağıdakilerden hangisidir?",
    options: optionRows.map((row) => row.text),
    correctIndex: diversityPlan.correctIndex,
    evidenceUnits: [
      { id: "E1", text: "Tarih sırası tek başına değişimi açıklamamıştır." },
      { id: "E2", text: "Yayınlar değişirken katılım alışkanlığı sürmüştür." },
      { id: "E3", text: "Çizelge ve mektuplar farklı kanıtlar sağlamıştır." },
      { id: "E4", text: "Kaynakların birlikte sunulması ilişkinin görülmesini sağlamıştır." }
    ],
    correctSupportEvidenceIds: ["E2", "E3", "E4"],
    correctFeedback: "Bu seçenek değişen yayın biçimleriyle süren katılımı, farklı arşiv kanıtlarının birlikte okunması gereğiyle birleştirir.",
    solutionSteps: [
      { id: "s1", action: "Kanıt türlerini ayır", evidenceIds: ["E1", "E3"], explanation: "Ses, çizelge ve mektup farklı bilgiler verir." },
      { id: "s2", action: "Değişim ile sürekliliği ilişkilendir", evidenceIds: ["E2"], explanation: "Yayınların değişmesi katılımın bittiği anlamına gelmez." },
      { id: "s3", action: "Kapsayıcı yargıyı seç", evidenceIds: ["E2", "E3", "E4"], explanation: "Ana düşünce farklı kanıtların birlikte yorumlanmasını kapsar." }
    ],
    hints: [
      { text: "Paragraftaki arşiv türlerini ve her birinin gösterdiği bilgiyi ayır." },
      { text: "Değişen yayın biçimleriyle süren öğrenci katılımı arasındaki ilişkiyi düşün." },
      { text: "Tek ayrıntıyı değil bütün kanıtların ortak sonucunu kapsayan seçeneği ara." }
    ],
    distractors: optionRows.map((row, optionIndex) => row.correct ? null : ({
      optionIndex,
      misconceptionId: row.misconceptionId,
      supportingEvidenceIds: row.supportingEvidenceIds,
      contradictionEvidenceIds: row.contradictionEvidenceIds,
      feedback: row.feedback
    })).filter(Boolean)
  };
}

function passingReview(correctIndex = 0) {
  return JSON.stringify({
    selectedOptionIndex: correctIndex,
    supportingEvidenceIds: ["E2", "E3", "E4"],
    decision: "PASS",
    score: 93,
    dimensions: {
      benchmarkFit: 90,
      reasoningQuality: 92,
      distractorQuality: 91,
      languageNaturalness: 88,
      answerDefensibility: 95,
      originality: 94,
      structuralPlanFidelity: 92
    },
    reasons: ["Independent evidence resolution agrees"],
    revisionInstructions: ""
  });
}

test("bounded smoke batch reaches human review only after independent engineering passes", async () => {
  const result = await runTr8Benchmark({
    sampleSize: 2,
    batchId: "smoke01",
    produce: async ({ itemIndex }) => ({ model: "producer-model", content: JSON.stringify(candidate(`smoke01-item-${itemIndex + 1}`, itemIndex)) }),
    review: async ({ itemIndex, stage }) => ({
      model: stage === "blind-resolution" ? "blind-reviewer-model" : "quality-reviewer-model",
      content: passingReview(tr8DiversityPlan(itemIndex).correctIndex)
    })
  });
  assert.equal(result.status, "PENDING_HUMAN_REVIEW");
  assert.equal(result.engineeringPassCount, 2);
  assert.equal(result.instances.every((instance) => instance.canonical.verifier.verified), true);
  assert.equal(result.instances.every((instance) => instance.producerModel !== instance.blindReviewerModel), true);
  assert.equal(result.instances.every((instance) => instance.producerModel !== instance.reviewerModel), true);
  assert.equal(result.instances.every((instance) => instance.blindReviewerModel !== instance.reviewerModel), true);
  assert.equal(result.qualityEvidence.uniqueAnswerRate, 100);
  assert.equal(result.qualityEvidence.explanationEvidenceRate, 100);
  assert.equal(result.qualityEvidence.structuralDuplicatePairCount, 0);
  assert.equal(result.qualityEvidence.distinctDiversityPlanCount, 2);
  assert.equal(result.qualityEvidence.distinctDiscourseStructureCount, 2);
});

test("same producer and reviewer model cannot certify an item", async () => {
  const result = await runTr8Benchmark({
    sampleSize: 1,
    maxAttempts: 1,
    produce: async () => ({ model: "same-model", content: JSON.stringify(candidate("same-model-item")) }),
    review: async () => ({ model: "same-model", content: passingReview() })
  });
  assert.equal(result.status, "ENGINEERING_INCOMPLETE");
  assert.equal(result.engineeringPassCount, 0);
  assert.equal(result.instances[0].engineeringReview.reasons.includes("blind-resolution-missing-or-changed"), true);
  assert.equal(result.instances[0].engineeringReview.reasons.includes("producer-quality-reviewer-model-must-differ"), true);
});

test("same blind solver and quality reviewer model cannot certify an item", async () => {
  const result = await runTr8Benchmark({
    sampleSize: 1,
    maxAttempts: 1,
    produce: async () => ({ model: "producer-model", content: JSON.stringify(candidate("same-reviewer-item")) }),
    review: async () => ({ model: "reviewer-model", content: passingReview() })
  });
  assert.equal(result.status, "ENGINEERING_INCOMPLETE");
  assert.equal(result.engineeringPassCount, 0);
  assert.equal(result.instances[0].engineeringReview.reasons.includes("blind-and-quality-reviewer-models-must-differ"), true);
});

test("runner revises at most once and then stops", async () => {
  let producerCalls = 0;
  let reviewerCalls = 0;
  const retryReview = JSON.stringify({
    selectedOptionIndex: 1,
    supportingEvidenceIds: ["E1"],
    decision: "RETRY",
    score: 60,
    dimensions: {},
    reasons: ["Answer is not independently defensible"],
    revisionInstructions: "Rebuild the option evidence."
  });
  const result = await runTr8Benchmark({
    sampleSize: 1,
    maxAttempts: 2,
    produce: async () => ({ model: "producer-model", content: JSON.stringify(candidate(`retry-${++producerCalls}`)) }),
    review: async ({ attempt, stage }) => {
      reviewerCalls += 1;
      return {
        model: stage === "blind-resolution" ? "blind-reviewer-model" : "quality-reviewer-model",
        content: attempt === 1 ? retryReview : passingReview()
      };
    }
  });
  assert.equal(producerCalls, 2);
  assert.equal(reviewerCalls, 4);
  assert.equal(result.engineeringPassCount, 1);
  assert.equal(result.instances[0].attempt, 2);
});

test("sample size is deliberately capped at twenty", async () => {
  await assert.rejects(() => runTr8Benchmark({ sampleSize: 21, produce() {}, review() {} }), /sampleSize:must-be-1-20/);
});

test("workflow success follows the complete batch gate, not only individual pass count", () => {
  const workflow = readFileSync(new URL("../src/workflow.ts", import.meta.url), "utf8");
  assert.match(workflow, /ok:benchmark\.status==="PENDING_HUMAN_REVIEW"/);
  assert.doesNotMatch(workflow, /ok:benchmark\.engineeringPassCount===benchmark\.sampleSize/);
  assert.match(workflow, /avoidModels:\[producerModel,\.\.\.\(blindReviewerModel \? \[blindReviewerModel\] : \[\]\)\]/);
  assert.match(workflow, /allowedModels:\[/);
  assert.match(workflow, /tr8 core producer/);
  assert.match(workflow, /tr8 teaching producer/);
  assert.match(workflow, /maxTokens:1050/);
  assert.match(workflow, /maxTokens:1300/);
  assert.match(workflow, /validateGeneratedCore\(\s*assembleTr8MicroAuthorCore/);
  assert.doesNotMatch(workflow, /riva-translate/);
  assert.match(workflow, /streamTotalTimeoutMs:150_000/);
  assert.ok(workflow.indexOf("nemotron-super-49b") < workflow.indexOf("llama-3.1-8b"));
});
