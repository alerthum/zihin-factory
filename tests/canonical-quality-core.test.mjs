import test from "node:test";
import assert from "node:assert/strict";
import {
  auditTr8ParagraphBatch,
  auditTr8ParagraphQuestion,
  defineCanonicalQuestion,
  defineHumanReviewDecision
} from "../src/assessment/canonical-quality-core.js";
import { buildTr8ApprovedPilotPackage } from "../src/assessment/tr8-approved-package.js";
import { tr8DiversityPlan } from "../src/assessment/tr8-paragraph-family.js";

const paragraphWords = [
  "Bir araştırma grubundaki öğrenciler okul bahçesinde yetişen bitkileri haftalar boyunca gözlemledi.",
  "İlk günlerde yalnızca boy değişimini kaydettiler fakat bu ölçüm sonuçları açıklamaya yetmedi.",
  "Daha sonra güneş alma süresiyle toprağın nemini de aynı çizelgede göstermeye başladılar.",
  "Bazı bitkilerin az uzamasına rağmen daha çok yaprak verdiğini bu karşılaştırma sayesinde fark ettiler.",
  "Ekip tek bir sayının gelişimi anlatamayacağını ve farklı belirtilerin birlikte değerlendirilmesi gerektiğini anladı.",
  "Son raporda gözlem koşullarını da yazarak bulguların hangi sınırlar içinde yorumlanabileceğini özellikle belirttiler.",
  "Böylece ilk bakışta önemsiz görünen ayrıntılar sonuçların daha güvenilir biçimde açıklanmasına katkı sağladı."
].join(" ");

const distinctContexts = [
  "Kayıt ekibindeki Deniz, gölgede kalan fesleğenlerin geniş yapraklarını mavi etiketlerle ayırıp cuma sabahı hazırladığı krokiye işledi.",
  "Laboratuvar sorumlusu Ece, killi topraktaki menekşelerin mor tomurcuklarını büyüteçle inceleyerek salı günkü çizelgeye turuncu simgeler ekledi.",
  "Bahçe kulübünden Mert, rüzgâr alan bölümdeki papatyaların eğilen saplarını fotoğraflayıp gözlem defterinde yeşil oklarla gösterdi.",
  "Araştırmacı Selin, yağmur oluğuna yakın nanenin keskin kokusunu ve kıvrılan yapraklarını ayrı sütunlarda karşılaştırdı.",
  "Öğrenci Baran, kumlu bölümdeki lavantaların soluk renklerini öğle saatlerinde ölçerek sonuçları kırmızı dosyada sakladı.",
  "Gözlemci İpek, çam ağacının altındaki eğrelti otlarında oluşan yeni sürgünleri kareli kâğıda farklı sembollerle kaydetti.",
  "Takım lideri Arda, seranın kuzey köşesindeki domates fidelerinin çiçeklenme tarihlerini takvim üzerinde sarı noktalarla belirledi.",
  "Kulüp üyesi Ceren, taş duvar yanındaki sarmaşığın tutunma yönlerini ip, cetvel ve pusula kullanarak ayrıntılı biçimde çizdi.",
  "Öğrenci Ozan, kompost yakınındaki biberlerin gövde kalınlıklarını pazartesi akşamları ölçüp değerleri lacivert kartlara yazdı.",
  "Araştırmacı Duru, havuz kenarındaki nilüferlerin açılma saatlerini güneşli ve bulutlu günler için ayrı ayrı listeledi.",
  "Gözlem ekibinden Alp, çakıllı alandaki kekiklerin dallanma biçimini haftalık çizimlerle belgeleyerek gümüş renkli klasörde topladı.",
  "Bahçe sorumlusu Aslı, sulama vanasına uzak güllerin diken ve tomurcuk sayılarını farklı işaretlerle aynı tabloda izledi.",
  "Öğrenci Bora, doğu yamacındaki çileklerin meyve verme sürelerini sıcaklık ölçer ve gölge saati kayıtlarıyla karşılaştırdı.",
  "Kulüp başkanı Elif, akasya çevresindeki yoncaların kapladığı alanı şerit metreyle ölçüp sonuçları haftalık haritaya aktardı.",
  "Araştırmacı Kerem, pencere önündeki sardunyaların yön değiştiren dallarını sabah ve akşam çekilen görüntüler üzerinde işaretledi.",
  "Gözlemci Naz, taşınabilir saksılardaki adaçaylarının yeni filizlerini farklı sulama aralıkları için ayrı renklerle kodladı.",
  "Öğrenci Emir, kuş yemliğine yakın ayçiçeklerinin baş eğimlerini pusula dereceleriyle kaydedip çizelgede küçük üçgenler kullandı.",
  "Takım üyesi Sude, yosun tutan bölümdeki çuha çiçeklerinin renk değişimini nem göstergesi ve tarih etiketleriyle birlikte belgeledi.",
  "Araştırmacı Can, okul girişindeki taflanların budama sonrasında çıkardığı sürgünleri uzunluk ve yön bakımından haftalık karşılaştırdı.",
  "Gözlemci Ada, arka bahçedeki bezelyelerin sarılma hareketlerini farklı destek çubukları üzerinde çizerek özel bir hareket günlüğü oluşturdu."
];

function question(index = 0, correctIndex = 0) {
  const diversityPlan = tr8DiversityPlan(index % 20);
  const baseOptions = [
    "Bir gelişimi doğru yorumlamak için farklı belirtiler ve gözlem koşulları birlikte değerlendirilmelidir.",
    "Bitkilerin gelişimini anlamanın en güvenilir yolu yalnızca haftalık boy değişimini düzenli ölçmektir.",
    "Toprak nemi uygun olduğunda bütün bitkiler aynı sürede mutlaka benzer sayıda yaprak verir.",
    "Araştırma raporunda koşulları belirtmek gözlemlerin karşılaştırılmasını gereksiz hâle getirir."
  ];
  const correct = baseOptions.shift();
  baseOptions.splice(correctIndex, 0, correct);
  const optionIds = ["A", "B", "C", "D"];
  const misconceptions = ["single-measure", "overgeneralization", "relation-reversal"];
  let wrongNumber = 0;
  const optionFeedback = baseOptions.map((_, optionIndex) => {
    if (optionIndex === correctIndex) {
      return {
        optionId: optionIds[optionIndex],
        correct: true,
        misconceptionId: null,
        text: "Paragrafın farklı ölçümleri ve koşulları birlikte değerlendiren genel sonucunu kapsar.",
        supportingEvidenceIds: ["E2", "E4", "E5"]
      };
    }
    const misconceptionId = misconceptions[wrongNumber++];
    return {
      optionId: optionIds[optionIndex],
      correct: false,
      misconceptionId,
      text: `Bu seçenek metindeki bir ayrıntıyı kullanıyor; ancak ${misconceptionId} yanılgısıyla bütün kanıtların kurduğu sonucu bozuyor.`,
      supportingEvidenceIds: [`E${optionIndex + 1}`]
    };
  });
  return {
    id: `tr8-paragraph-${index}`,
    curriculum: {
      country: "TR",
      schoolYear: "2026-2027",
      programFamily: "PRE_TYMM",
      grade: 8,
      courseId: "turkce",
      unitId: "reading",
      topicId: "paragraph-inference",
      outcomeIds: [`T.8.3.${index + 1}`],
      sourceIds: ["meb-grade8-turkish-program"]
    },
    construct: {
      primarySkill: "multi-evidence-inference",
      secondarySkills: ["scope-control"],
      cognitiveProcess: "integrate-and-evaluate",
      knowledgeComponents: ["main-idea", "evidence-boundary"],
      intendedDifficultyBand: "LGS_HIGH"
    },
    content: {
      stimulus: `${paragraphWords} ${distinctContexts[index % distinctContexts.length]}`,
      stem: "Bu parçadan çıkarılabilecek en kapsamlı yargı aşağıdakilerden hangisidir?",
      options: baseOptions.map((text, optionIndex) => ({ id: optionIds[optionIndex], text }))
    },
    itemFormat: "single-choice",
    responseModel: { optionIds },
    answerKey: { optionId: optionIds[correctIndex] },
    solutionGraph: [
      { id: "s1", action: "evidence-units", evidence: "E2, E4 ve E5 bağımsız bilgi birimleridir." },
      { id: "s2", action: "relation-check", evidence: "Ölçümlerin tek başına değil birlikte anlam kazandığı gösterilir." },
      { id: "s3", action: "scope-check", evidence: "Doğru seçenek paragrafın tamamını kapsar ve kesinlik eklemez." }
    ],
    hints: [
      { level: 1, text: "Tek bir ölçüme odaklanmak yerine paragrafta karşılaştırılan verileri belirle.", revealsAnswer: false },
      { level: 2, text: "Boy, yaprak ve gözlem koşulları arasındaki ortak ilişkiyi düşün.", revealsAnswer: false },
      { level: 3, text: "Ayrıntıyı genelleştiren ya da kesinlik bildiren seçenekleri kanıtlarla ele.", revealsAnswer: false }
    ],
    optionFeedback,
    misconceptionIds: misconceptions,
    verifier: {
      solverId: "tr8-evidence-solver-v1",
      independentVerifierId: "tr8-entailment-verifier-v1",
      verified: true
    },
    styleProfile: {
      genre: diversityPlan.genreId,
      genreId: diversityPlan.genreId,
      voice: "natural",
      diversityPlanId: diversityPlan.planId,
      discourseStructureId: diversityPlan.discourseStructureId,
      reasoningPathId: diversityPlan.reasoningPathId
    },
    provenance: {
      generatedFromSourceIds: ["meb-grade8-turkish-program"],
      styleReferenceIds: ["licensed-benchmark-morphology"]
    },
    contentStatus: "HUMAN_REVIEW_REQUIRED"
  };
}

function review(questionId, index, decision = "APPROVE") {
  return {
    reviewId: `review-${index}`,
    batchId: "tr8-pilot-001",
    questionId,
    reviewerAnonId: `reviewer_pilot_${String(index).padStart(2, "0")}`,
    reviewerRole: "TURKISH_TEACHER",
    decision,
    scores: {
      correctness: decision === "APPROVE" ? 5 : 3,
      optionOrRubricQuality: decision === "APPROVE" ? 4 : 3,
      ageLanguageFit: decision === "APPROVE" ? 5 : 3,
      hintNonLeakage: decision === "APPROVE" ? 4 : 3,
      feedbackTeachingValue: decision === "APPROVE" ? 5 : 3,
      naturalness: decision === "APPROVE" ? 4 : 3
    },
    criticalBlockers: decision === "APPROVE" ? [] : ["revision-needed"],
    notes: decision === "APPROVE" ? "Kanıt ve seçenekler uygundur." : "Seçenek dengesi yeniden kurulmalı.",
    reviewedAt: "2026-08-14T12:00:00.000Z"
  };
}

test("factory contract stays compatible with KuzenlerYarisiyor schema 3.0", () => {
  const canonical = defineCanonicalQuestion(question());
  assert.equal(canonical.schemaVersion, "3.0");
  assert.deepEqual(canonical.gameBindings, []);
  assert.equal(canonical.provenance.copiedText, false);
});

test("a valid grade 8 paragraph item proves distractors, hints, feedback and verification", () => {
  const audit = auditTr8ParagraphQuestion(question());
  assert.equal(audit.ok, true, `${audit.errors.join(", ")} ${JSON.stringify(audit.metrics)}`);
  assert.equal(audit.metrics.distinctDistractorMisconceptions, 3);
  assert.equal(audit.metrics.correctIndex, 0);
});

test("an obviously longer correct option is rejected as an answer giveaway", () => {
  const candidate = question();
  candidate.content.options[0].text += " Bu ek cümle yalnız doğru seçeneği belirgin biçimde uzatarak öğrencinin metni okumadan cevap vermesine yol açar.";
  const audit = auditTr8ParagraphQuestion(candidate);
  assert.equal(audit.ok, false);
  assert.equal(audit.errors.includes("correct-option-length-giveaway"), true);
});

test("a hint that repeats the answer is rejected", () => {
  const candidate = question();
  candidate.hints[2].text = candidate.content.options[0].text;
  const audit = auditTr8ParagraphQuestion(candidate);
  assert.equal(audit.ok, false);
  assert.equal(audit.errors.includes("hint-answer-leakage"), true);
});

test("benchmark wording may shape morphology but cannot be copied", () => {
  const candidate = question();
  const copiedExcerpt = "öğrenciler okul bahçesinde yetişen bitkileri haftalar boyunca gözlemledi";
  const audit = auditTr8ParagraphQuestion(candidate, { benchmarkExcerpts: [copiedExcerpt] });
  assert.equal(audit.ok, false);
  assert.equal(audit.errors.includes("benchmark-wording-overlap"), true);
  assert.equal(audit.metrics.maximumSharedBenchmarkPhraseWords > 5, true);
});

test("APPROVE requires all human review dimensions to be at least four", () => {
  const candidate = review("tr8-paragraph-0", 0);
  candidate.scores.naturalness = 3;
  assert.throws(() => defineHumanReviewDecision(candidate), /approve:quality-threshold-not-met/);
});

test("a 20-item batch passes only with balanced answers, no repetition and at least 80% approval", () => {
  const questions = Array.from({ length: 20 }, (_, index) => question(index, index % 4));
  const reviews = questions.map((item, index) => review(item.id, index, index < 16 ? "APPROVE" : "REVISE"));
  const audit = auditTr8ParagraphBatch(questions, reviews);
  assert.equal(audit.ok, true, `${audit.errors.join(", ")} ${JSON.stringify(audit.metrics)}`);
  assert.deepEqual(audit.metrics.correctPositionCounts, [5, 5, 5, 5]);
  assert.equal(audit.metrics.humanApprovalRate, 0.8);
  assert.equal(audit.exportableQuestionIds.length, 16);
});

test("the batch gate detects template repetition even when identifiers differ", () => {
  const questions = Array.from({ length: 20 }, (_, index) => question(index, index % 4));
  questions[1].content = structuredClone(questions[0].content);
  questions[1].answerKey = structuredClone(questions[0].answerKey);
  questions[1].optionFeedback = structuredClone(questions[0].optionFeedback);
  const reviews = questions.map((item, index) => review(item.id, index));
  const audit = auditTr8ParagraphBatch(questions, reviews);
  assert.equal(audit.ok, false);
  assert.equal(audit.errors.includes("exact-question-duplicate"), true);
});

test("the batch gate rejects the same structural plan even when words and identifiers differ", () => {
  const questions = Array.from({ length: 20 }, (_, index) => question(index, index % 4));
  questions[1].styleProfile = structuredClone(questions[0].styleProfile);
  const reviews = questions.map((item, index) => review(item.id, index));
  const audit = auditTr8ParagraphBatch(questions, reviews);
  assert.equal(audit.ok, false);
  assert.equal(audit.errors.includes("duplicate-diversity-plan"), true);
  assert.equal(audit.errors.includes("structural-template-duplicates"), true);
});

function completedBenchmarkResult() {
  return {
    kind: "assessment.tr8-paragraph-benchmark",
    familyId: "tr8.paragraph.main-idea-synthesis.v1",
    batchId: "tr8-pilot-001",
    sampleSize: 20,
    status: "PENDING_HUMAN_REVIEW",
    engineeringPassCount: 20,
    automatedIssues: [],
    instances: Array.from({ length: 20 }, (_, index) => ({
      instanceId: `tr8-pilot-item-${index + 1}`,
      status: "ENGINEERING_PASS",
      producerModel: `producer-${index + 1}`,
      blindReviewerModel: `blind-reviewer-${index + 1}`,
      reviewerModel: `quality-reviewer-${index + 1}`,
      engineeringDecision: "PASS",
      engineeringScore: 93,
      blindResolutionLocked: true,
      independentlyResolved: true,
      blindAnswerKeyExposed: false
    })),
    qualityEvidence: { duplicateRate: 0, explanationEvidenceRate: 100 }
  };
}

test("approved export contains only human-approved questions and no reviewer identity", () => {
  const questions = Array.from({ length: 20 }, (_, index) => question(index, index % 4));
  const reviews = questions.map((item, index) => review(item.id, index, index < 16 ? "APPROVE" : "REVISE"));
  const packageArtifact = buildTr8ApprovedPilotPackage({
    factoryVersion: "0.10.1",
    jobId: "00000000-0000-4000-8000-000000000001",
    result: completedBenchmarkResult(),
    candidates: questions,
    reviews,
    exportedAt: "2026-08-14T18:00:00.000Z"
  });
  assert.equal(packageArtifact.releaseGate.pilotEligible, true);
  assert.equal(packageArtifact.releaseGate.blindReviewCount, 20);
  assert.equal(packageArtifact.releaseGate.exportableQuestionCount, 16);
  assert.equal(packageArtifact.questions.length, 16);
  assert.equal(packageArtifact.questions.every((item) => item.contentStatus === "PILOT_READY"), true);
  assert.equal(packageArtifact.questions.every((item) => item.content.humanReview.gameAdaptationAllowed === true), true);
  assert.doesNotMatch(JSON.stringify(packageArtifact.reviewEvidence), /reviewer_pilot|notes/i);
});

test("approved export rejects missing, reused or answer-exposed blind review evidence", () => {
  const questions = Array.from({ length: 20 }, (_, index) => question(index, index % 4));
  const reviews = questions.map((item, index) => review(item.id, index));
  for (const mutate of [
    (result) => { result.instances.pop(); },
    (result) => { result.instances[1].instanceId = result.instances[0].instanceId; },
    (result) => { result.instances[2].blindAnswerKeyExposed = true; },
    (result) => { result.instances[3].reviewerModel = result.instances[3].blindReviewerModel; }
  ]) {
    const result = structuredClone(completedBenchmarkResult());
    mutate(result);
    assert.throws(() => buildTr8ApprovedPilotPackage({
      jobId: "00000000-0000-4000-8000-000000000099",
      result,
      candidates: questions,
      reviews
    }), /twenty-blind-review-evidence-required/);
  }
});

test("two-question smoke can never become an approved export package", () => {
  assert.throws(() => buildTr8ApprovedPilotPackage({
    jobId: "00000000-0000-4000-8000-000000000002",
    result: { ...completedBenchmarkResult(), sampleSize: 2, engineeringPassCount: 2 },
    candidates: [question(0, 0), question(1, 1)],
    reviews: []
  }), /twenty-question-calibration-required/);
});

test("missing human coverage keeps approved export fail-closed", () => {
  const questions = Array.from({ length: 20 }, (_, index) => question(index, index % 4));
  assert.throws(() => buildTr8ApprovedPilotPackage({
    jobId: "00000000-0000-4000-8000-000000000003",
    result: completedBenchmarkResult(),
    candidates: questions,
    reviews: questions.slice(0, 19).map((item, index) => review(item.id, index))
  }), /human-review-coverage/);
});
