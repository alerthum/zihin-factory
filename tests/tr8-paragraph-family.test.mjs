import test from "node:test";
import assert from "node:assert/strict";
import {
  TR8_MAIN_IDEA_FAMILY_V1,
  compileCandidate,
  generatorPrompt,
  generatorSystemPrompt,
  parseEngineeringReview,
  parseGeneratedCandidate,
  reviewerPrompt
} from "../src/assessment/tr8-paragraph-family.js";

const stimulus = [
  "Bir kent arşivinde çalışan ekip, eski mahalle fotoğraflarını yalnız tarih sırasına dizmenin değişimi açıklamadığını fark etti.",
  "Aynı sokağın farklı yıllardaki görüntülerinde dükkân adları değişirken kapı önünde buluşma alışkanlığının sürdüğü görülüyordu.",
  "Haritalar bazı yapıların yıkıldığını gösteriyor, ses kayıtları ise kaybolan yer adlarının günlük konuşmada yaşamaya devam ettiğini ortaya koyuyordu.",
  "Ekip bu yüzden her belge türünü ayrı bir kanıt olarak değerlendirdi.",
  "Son sergide fotoğraf, harita ve tanıklıkları yan yana getirerek kentin geçmişini tek bir görüntüye indirgemedi.",
  "Ziyaretçiler de değişen yapılarla süren alışkanlıklar arasındaki ilişkiyi ancak bu karşılaştırma sayesinde kurabildi.",
  "Böylece arşiv, nesneleri saklayan bir depo olmaktan çıkıp dönüşümün farklı izlerini birlikte okutan bir çalışma alanına dönüştü."
].join(" ");

function candidate() {
  return {
    familyId: TR8_MAIN_IDEA_FAMILY_V1.familyId,
    instanceId: "batch01-item01",
    stimulus,
    stem: "Bu parçanın ana düşüncesi aşağıdakilerden hangisidir?",
    options: [
      "Kentteki değişimi anlamak için farklı belge türleri birlikte değerlendirilerek süreklilik ve dönüşüm karşılaştırılmalıdır.",
      "Eski mahalle fotoğraflarını tarih sırasına koymak kentin bütün geçmişini açıklamak için tek başına yeterlidir.",
      "Bir yapının yıkılması o mahalledeki bütün kültürel alışkanlıkların aynı anda ortadan kalktığını gösterir.",
      "Arşiv sergilerinde harita kullanılması sözlü tanıklıkların güvenilirliğini bütünüyle gereksiz hâle getirir."
    ],
    correctIndex: 0,
    evidenceUnits: [
      { id: "E1", text: "Fotoğraflar tek başına değişimi açıklamamıştır." },
      { id: "E2", text: "Yapılar değişirken bazı alışkanlıklar sürmüştür." },
      { id: "E3", text: "Harita ve ses kayıtları farklı türde kanıt sağlamıştır." },
      { id: "E4", text: "Belgelerin birlikte sunulması ziyaretçilerin ilişki kurmasını sağlamıştır." }
    ],
    correctSupportEvidenceIds: ["E2", "E3", "E4"],
    correctFeedback: "Bu seçenek değişen yapılarla süren alışkanlıkları, farklı belge türlerinin birlikte okunması gereğiyle birleştirir.",
    solutionSteps: [
      { id: "s1", action: "Kanıt türlerini ayır", evidenceIds: ["E1", "E3"], explanation: "Fotoğraf, harita ve ses kaydı farklı bilgiler verir." },
      { id: "s2", action: "Değişim ve sürekliliği ilişkilendir", evidenceIds: ["E2"], explanation: "Yapıların değişmesi bütün alışkanlıkların kaybolduğu anlamına gelmez." },
      { id: "s3", action: "Kapsayıcı yargıyı seç", evidenceIds: ["E2", "E3", "E4"], explanation: "Ana düşünce farklı kanıtların birlikte yorumlanmasını kapsar." }
    ],
    hints: [
      { text: "Paragrafta kullanılan belge türlerini ve her birinin ne gösterdiğini ayır." },
      { text: "Değişen yapılarla devam eden alışkanlıklar arasındaki karşıtlığı düşün." },
      { text: "Tek ayrıntıyı değil bütün kanıtların ortak sonucunu kapsayan seçeneği ara." }
    ],
    distractors: [
      { optionIndex: 1, misconceptionId: "detail-as-main-idea", supportingEvidenceIds: ["E1"], contradictionEvidenceIds: ["E3", "E4"], feedback: "Fotoğrafların sıralanması metinde geçer; ancak ekip bunun değişimi tek başına açıklamadığını özellikle belirtir." },
      { optionIndex: 2, misconceptionId: "overgeneralized-main-idea", supportingEvidenceIds: ["E2"], contradictionEvidenceIds: ["E2"], feedback: "Yapıların değişmesi gözlenmiştir; buna rağmen bazı alışkanlıkların sürmesi seçenekteki kesin genellemeyi çürütür." },
      { optionIndex: 3, misconceptionId: "relation-reversal", supportingEvidenceIds: ["E3"], contradictionEvidenceIds: ["E4"], feedback: "Harita ve tanıklık birbirini gereksiz kılmaz; parçadaki sonuç bu kaynakların birlikte okunmasına dayanır." }
    ],
    styleProfile: { genre: "cultural-essay", voice: "natural-expository" }
  };
}

const proof = {
  solverId: "tr8-main-idea-score-v1",
  independentVerifierId: "tr8-main-idea-constraint-v1",
  verified: true
};

test("compiler emits the KuzenlerYarisiyor canonical contract and passes the quality core", () => {
  const result = compileCandidate(candidate(), { producerModel: "producer-a", proof });
  assert.equal(result.audit.ok, true, result.audit.errors.join(", "));
  assert.equal(result.canonical.schemaVersion, "3.0");
  assert.equal(result.canonical.curriculum.outcomeIds[0], "tr.pre-tymm.g8.turkce.t-8-3-17");
  assert.equal(result.canonical.content.humanReview.gameAdaptationAllowed, false);
});

test("AI output cannot mark itself independently verified", () => {
  const result = compileCandidate(candidate(), { producerModel: "producer-a" });
  assert.equal(result.audit.ok, false);
  assert.equal(result.audit.errors.includes("independent-verification-required"), true);
});

test("parser extracts one balanced JSON object from fenced provider output", () => {
  const parsed = parseGeneratedCandidate(`Provider preface\n\`\`\`json\n${JSON.stringify(candidate())}\n\`\`\`\nignored`);
  assert.equal(parsed.instanceId, "batch01-item01");
});

test("producer instructions preserve the family and prohibit copying and hidden reasoning", () => {
  const system = generatorSystemPrompt();
  const prompt = generatorPrompt({ instanceId: "batch01-item02", morphologyNotes: ["Four close options"] });
  assert.match(system, /strict JSON/i);
  assert.match(system, /Never copy/i);
  assert.match(system, /chain-of-thought/i);
  assert.match(prompt, new RegExp(TR8_MAIN_IDEA_FAMILY_V1.familyId.replaceAll(".", "\\.")));
});

test("engineering reviewer is independent and cannot override deterministic failures", () => {
  const passingReview = JSON.stringify({
    decision: "PASS",
    score: 93,
    dimensions: {
      benchmarkFit: 90,
      reasoningQuality: 92,
      distractorQuality: 91,
      languageNaturalness: 88,
      answerDefensibility: 95,
      originality: 94
    },
    reasons: ["All evidence gates pass"],
    revisionInstructions: ""
  });
  const sameModel = parseEngineeringReview(passingReview, { producerModel: "model-a", reviewerModel: "model-a" });
  assert.equal(sameModel.decision, "RETRY");
  const deterministicFailure = parseEngineeringReview(passingReview, {
    producerModel: "model-a",
    reviewerModel: "model-b",
    deterministicIssues: ["duplicate-options"]
  });
  assert.equal(deterministicFailure.decision, "RETRY");
  const independentPass = parseEngineeringReview(passingReview, { producerModel: "model-a", reviewerModel: "model-b" });
  assert.equal(independentPass.decision, "PASS");
});

test("review prompt treats prose quality as insufficient evidence", () => {
  const compiled = compileCandidate(candidate(), { producerModel: "producer-a", proof });
  const prompt = reviewerPrompt({ canonical: compiled.canonical, deterministicIssues: [] });
  assert.match(prompt, /Polished prose is not evidence/i);
  assert.match(prompt, /unique answer defensibility/i);
});
